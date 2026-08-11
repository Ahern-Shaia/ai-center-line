import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export interface PersonalDailyReportItem {
  time?: string;         // e.g. "08:30" or "08:30-10:00"
  title: string;         // 事項標題
  detail?: string;       // 內容摘要
  followup?: string;     // 追蹤事項
}

export interface PersonalDailyReportRow {
  reportId: string;
  tenantId: string;
  userId: string;
  reportDate: string;
  uploadId: number | null;
  aiItems: PersonalDailyReportItem[];
  finalItems: PersonalDailyReportItem[] | null;
  messageCount: number;
  status: "draft" | "confirmed" | "sent" | "empty" | "failed";
  aiGeneratedAt: string | null;
  confirmedAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

/**
 * PersonalDailyReportRepository · PDR-M2
 * 對照 docs/modules/personal-daily-report.md §5.3
 * · 冪等 UPSERT · (user_id, report_date) UNIQUE
 * · RLS 已於 migration 0018 定義（員工 own + 部門主管 + tenant_admin + aiproot）
 */
@Injectable()
export class PersonalDailyReportRepository {
  // 今日該員工的私訊訊息數 · empty state 用來顯「已私訊 N 則 · 按重新生成」
  async countPersonalMessagesForDate(tx: Db, userId: string, reportDate: string): Promise<number> {
    const res = await tx.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM line_message
      WHERE sender_user_id = ${userId}::uuid
        AND chat_context = 'personal'
        AND (sent_at AT TIME ZONE 'Asia/Taipei')::date = ${reportDate}::date
    `);
    return Number(res.rows[0]?.count ?? 0);
  }

  // 今日該員工的原始私訊 list · empty state 展開顯給使用者確認 bot 有收到什麼
  // 上限 50 則 · 避免 payload 過大 · 依 sent_at 升序
  async listPersonalMessagesForDate(tx: Db, userId: string, reportDate: string): Promise<Array<{
    messageId: string;
    messageType: string;
    textContent: string | null;
    sentAt: string;
  }>> {
    const res = await tx.execute<{
      message_id: string;
      message_type: string;
      text_content: string | null;
      sent_at: string;
    }>(sql`
      SELECT message_id, message_type, text_content, sent_at::text
      FROM line_message
      WHERE sender_user_id = ${userId}::uuid
        AND chat_context = 'personal'
        AND (sent_at AT TIME ZONE 'Asia/Taipei')::date = ${reportDate}::date
      ORDER BY sent_at ASC
      LIMIT 50
    `);
    return res.rows.map((r) => ({
      messageId: r.message_id,
      messageType: r.message_type,
      textContent: r.text_content,
      sentAt: r.sent_at,
    }));
  }

  async getByUserDate(tx: Db, userId: string, reportDate: string): Promise<PersonalDailyReportRow | null> {
    const res = await tx.execute<PersonalDailyReportRow>(sql`
      SELECT report_id AS "reportId",
             tenant_id::text AS "tenantId",
             user_id::text AS "userId",
             report_date::text AS "reportDate",
             upload_id AS "uploadId",
             ai_items AS "aiItems",
             final_items AS "finalItems",
             message_count AS "messageCount",
             status,
             ai_generated_at::text AS "aiGeneratedAt",
             confirmed_at::text AS "confirmedAt",
             sent_at::text AS "sentAt",
             error_message AS "errorMessage",
             created_at::text AS "createdAt",
             updated_at::text AS "updatedAt"
      FROM personal_daily_report
      WHERE user_id = ${userId}::uuid AND report_date = ${reportDate}::date
      LIMIT 1
    `);
    return res.rows[0] ?? null;
  }

  async upsertDraft(tx: Db, args: {
    tenantId: string;
    userId: string;
    reportDate: string;
    uploadId: number | null;
    aiItems: PersonalDailyReportItem[];
    messageCount: number;
  }): Promise<{ reportId: string }> {
    const res = await tx.execute<{ report_id: string }>(sql`
      INSERT INTO personal_daily_report
        (tenant_id, user_id, report_date, upload_id, ai_items, message_count, status, ai_generated_at)
      VALUES
        (${args.tenantId}::uuid, ${args.userId}::uuid, ${args.reportDate}::date,
         ${args.uploadId}, ${JSON.stringify(args.aiItems)}::jsonb, ${args.messageCount},
         'draft', now())
      ON CONFLICT (user_id, report_date) DO UPDATE SET
        upload_id = EXCLUDED.upload_id,
        ai_items = EXCLUDED.ai_items,
        message_count = EXCLUDED.message_count,
        status = CASE WHEN personal_daily_report.status = 'sent' THEN 'sent' ELSE 'draft' END,
        ai_generated_at = now(),
        updated_at = now()
      RETURNING report_id
    `);
    return { reportId: res.rows[0].report_id };
  }

  /**
   * 沒有日報列就開一列（給「自己手動加項目」用）· four-features-reflection.md §5
   *
   * 為什麼需要：原本 save 遇到沒有日報列一律擋，訊息是「請先傳訊息給 bot」。
   * 但同仁可能今天沒私訊 bot，卻有打卡、有被指派任務 ——
   * 那些都是可以加進日報的東西。加得進去卻送不出，使用者就走到死路了。
   *
   * ai_items 留空：這一列不是 AI 產的，是本人自己開的。
   */
  async ensureRow(tx: Db, args: { tenantId: string; userId: string; reportDate: string }): Promise<{ reportId: string }> {
    const res = await tx.execute<{ report_id: string }>(sql`
      INSERT INTO personal_daily_report (tenant_id, user_id, report_date, ai_items, status)
      VALUES (${args.tenantId}::uuid, ${args.userId}::uuid, ${args.reportDate}::date, '[]'::jsonb, 'draft')
      ON CONFLICT (user_id, report_date) DO UPDATE SET updated_at = now()
      RETURNING report_id
    `);
    return { reportId: res.rows[0].report_id };
  }

  async markEmpty(tx: Db, args: { tenantId: string; userId: string; reportDate: string }): Promise<void> {
    await tx.execute(sql`
      INSERT INTO personal_daily_report (tenant_id, user_id, report_date, ai_items, status, ai_generated_at)
      VALUES (${args.tenantId}::uuid, ${args.userId}::uuid, ${args.reportDate}::date, '[]'::jsonb, 'empty', now())
      ON CONFLICT (user_id, report_date) DO UPDATE SET
        status = CASE WHEN personal_daily_report.status IN ('sent', 'confirmed') THEN personal_daily_report.status ELSE 'empty' END,
        ai_generated_at = now(),
        updated_at = now()
    `);
  }

  async markFailed(tx: Db, args: { tenantId: string; userId: string; reportDate: string; errorMessage: string }): Promise<void> {
    await tx.execute(sql`
      INSERT INTO personal_daily_report (tenant_id, user_id, report_date, ai_items, status, ai_generated_at, error_message)
      VALUES (${args.tenantId}::uuid, ${args.userId}::uuid, ${args.reportDate}::date, '[]'::jsonb, 'failed', now(), ${args.errorMessage})
      ON CONFLICT (user_id, report_date) DO UPDATE SET
        status = 'failed',
        error_message = EXCLUDED.error_message,
        updated_at = now()
    `);
  }

  async saveFinal(tx: Db, args: {
    reportId: string;
    finalItems: PersonalDailyReportItem[];
    action: "save_draft" | "send";
  }): Promise<void> {
    const isSend = args.action === "send";
    await tx.execute(sql`
      UPDATE personal_daily_report SET
        final_items = ${JSON.stringify(args.finalItems)}::jsonb,
        status = ${isSend ? "sent" : "confirmed"},
        confirmed_at = COALESCE(confirmed_at, now()),
        sent_at = CASE WHEN ${isSend} THEN now() ELSE sent_at END,
        updated_at = now()
      WHERE report_id = ${args.reportId}::uuid
    `);
  }

  /**
   * 設 RLS 上下文 · 平台角色看指定租戶時必須先設。
   * `departments` 的 policy 是 AND-only（沒有 aiproot_admin 逃生門），
   * 不設的話 listByRange 的 LEFT JOIN 會整個被濾掉 → 部門一律顯示未分派。
   */
  async setTenantContext(tx: Db, tenantId: string): Promise<void> {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
  }

  /**
   * 主管看部門日報 / tenant_admin 看全 tenant · RLS 已處理
   */
  async listByRange(tx: Db, args: {
    fromDate: string;
    toDate: string;
    limit?: number;
  }): Promise<Array<PersonalDailyReportRow & { userDisplayName: string | null; departmentName: string | null }>> {
    const res = await tx.execute<PersonalDailyReportRow & {
      user_display_name: string | null;
      department_name: string | null;
    }>(sql`
      SELECT pdr.report_id AS "reportId",
             pdr.tenant_id::text AS "tenantId",
             pdr.user_id::text AS "userId",
             pdr.report_date::text AS "reportDate",
             pdr.upload_id AS "uploadId",
             pdr.ai_items AS "aiItems",
             pdr.final_items AS "finalItems",
             pdr.message_count AS "messageCount",
             pdr.status,
             pdr.ai_generated_at::text AS "aiGeneratedAt",
             pdr.confirmed_at::text AS "confirmedAt",
             pdr.sent_at::text AS "sentAt",
             pdr.error_message AS "errorMessage",
             pdr.created_at::text AS "createdAt",
             pdr.updated_at::text AS "updatedAt",
             u.display_name AS user_display_name,
             d.department_name
      FROM personal_daily_report pdr
      JOIN users u ON u.user_id = pdr.user_id
      LEFT JOIN departments d ON d.department_id = u.department_id
      WHERE pdr.report_date BETWEEN ${args.fromDate}::date AND ${args.toDate}::date
      ORDER BY pdr.report_date DESC, pdr.updated_at DESC
      LIMIT ${args.limit ?? 200}
    `);
    return res.rows.map((r) => ({
      ...r,
      userDisplayName: r.user_display_name,
      departmentName: r.department_name,
    }));
  }
}
