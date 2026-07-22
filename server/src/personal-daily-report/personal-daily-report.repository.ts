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
