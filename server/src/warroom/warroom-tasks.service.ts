import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";

/**
 * WarroomTasksService · WTB-M3
 * 對照 docs/modules/warroom-task-board.md §6-§7
 *
 * · 任務看板 (Kanban) · list tickets grouped by confirm_status
 * · 日誌 view · list daily_reports by day
 * · role-scoped filter · RLS 已處理 group_owner 限 own department
 */

export interface WarroomTicket {
  ticketId: string;
  category: string | null;
  categoryId: string | null;
  summary: string;
  confidence: "high" | "medium" | "low" | null;
  confirmStatus: "待簽核" | "已簽核" | "逾時警示";
  assigneeDisplayName: string | null;
  dueAt: string | null;
  sourceUploadId: number | null;
  sourceRecordIndex: number | null;
  createdAt: string;
  departmentId: string;
  departmentName: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
}

export interface WarroomDaily {
  uploadId: number;
  groupId: string;
  groupName: string | null;
  departmentName: string | null;
  batchDate: string;
  dailyReports: Array<Record<string, unknown>>;
  status: string;
  uploadedAt: string;
}

@Injectable()
export class WarroomTasksService {
  /**
   * List tickets · Kanban 用 · RLS 已 tenant + department 隔離
   * · 依 confirm_status 分組回傳
   * · 逾時判定 (OQ-WTB-6 A+C 混合)：due_at 過期 · 或 due_at null 且 建立 > 7 天
   */
  async listTasks(args: { includeSignedOff?: boolean } = {}): Promise<{
    kanban: {
      pending: WarroomTicket[];      // 待簽核
      signed: WarroomTicket[];       // 已簽核 (limit 30 · 最近的)
      overdue: WarroomTicket[];      // 逾時 · due_at 過期 or 建立 > 7d 且待簽
    };
    counts: { pending: number; signed: number; overdue: number };
  }> {
    const tx = currentTx();
    const includeSigned = args.includeSignedOff !== false;

    // 統一 query · 拿全部 · 前端分 · 保 SQL 簡單
    const rows = await tx.execute<{
      ticket_id: string;
      category: string | null;
      category_id: string | null;
      summary: string | null;
      confidence: "high" | "medium" | "low" | null;
      confirm_status: "待簽核" | "已簽核" | "逾時警示";
      assignee_display_name: string | null;
      due_at: string | null;
      source_upload_id: number | null;
      source_record_index: number | null;
      created_at: string;
      department_id: string;
      department_name: string | null;
      confirmed_by_name: string | null;
      confirmed_at: string | null;
    }>(sql`
      SELECT t.ticket_id, t.category, t.category_id::text,
             t.summary, t.confidence, t.confirm_status,
             t.assignee_display_name, t.due_at::text,
             t.source_upload_id, t.source_record_index,
             t.created_at::text,
             t.department_id::text, d.department_name,
             u.display_name AS confirmed_by_name,
             t.confirmed_at::text
      FROM tickets t
      LEFT JOIN departments d ON d.department_id = t.department_id
      LEFT JOIN users u ON u.user_id = t.confirmed_by
      ORDER BY t.created_at DESC
      LIMIT 500
    `);

    const now = Date.now();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    const all = rows.rows.map<WarroomTicket>((r) => ({
      ticketId: r.ticket_id,
      category: r.category,
      categoryId: r.category_id,
      summary: r.summary ?? "",
      confidence: r.confidence,
      confirmStatus: r.confirm_status,
      assigneeDisplayName: r.assignee_display_name,
      dueAt: r.due_at,
      sourceUploadId: r.source_upload_id,
      sourceRecordIndex: r.source_record_index,
      createdAt: r.created_at,
      departmentId: r.department_id,
      departmentName: r.department_name,
      confirmedByName: r.confirmed_by_name,
      confirmedAt: r.confirmed_at,
    }));

    const overdue = all.filter((t) => {
      if (t.confirmStatus !== "待簽核") return false;
      if (t.dueAt) return new Date(t.dueAt).getTime() < now;
      return now - new Date(t.createdAt).getTime() > SEVEN_DAYS;
    });
    const overdueSet = new Set(overdue.map((t) => t.ticketId));
    const pending = all.filter((t) => t.confirmStatus === "待簽核" && !overdueSet.has(t.ticketId));
    const signed = includeSigned
      ? all.filter((t) => t.confirmStatus === "已簽核").slice(0, 30)
      : [];

    return {
      kanban: { pending, signed, overdue },
      counts: {
        pending: pending.length,
        signed: all.filter((t) => t.confirmStatus === "已簽核").length,
        overdue: overdue.length,
      },
    };
  }

  /**
   * List daily reports · 日誌 view
   * · 按天列 · 每 upload 一 card · limit 30 天
   */
  async listDailyReports(args: { fromDate?: string; toDate?: string }): Promise<{
    days: Array<{
      batchDate: string;
      uploads: WarroomDaily[];
    }>;
  }> {
    const tx = currentTx();
    const fromDate = args.fromDate ?? sqlDaysAgo(7);
    const toDate = args.toDate ?? sqlToday();

    const rows = await tx.execute<{
      id: number;
      group_id: string | null;
      batch_date: string | null;
      status: string;
      uploaded_at: string;
      daily_reports: unknown;
      group_name: string | null;
      department_name: string | null;
    }>(sql`
      SELECT au.id, au.group_id, au.batch_date::text, au.status,
             au.uploaded_at::text,
             ar.daily_reports,
             lg.display_name AS group_name,
             d.department_name
      FROM analysis_upload au
      LEFT JOIN analysis_result ar ON ar.upload_id = au.id
      LEFT JOIN line_group lg ON lg.group_id = au.group_id
      LEFT JOIN departments d ON d.department_id = lg.department_id
      WHERE au.batch_date IS NOT NULL
        AND au.batch_date::date BETWEEN ${fromDate}::date AND ${toDate}::date
        AND au.status = 'done'
        -- Bug fix · 私訊佔位 group 不進群組日誌
        AND au.group_id NOT LIKE '\\_\\_personal\\_\\_%' ESCAPE '\\'
      ORDER BY au.batch_date DESC, au.uploaded_at DESC
      LIMIT 200
    `);

    const byDay = new Map<string, WarroomDaily[]>();
    for (const r of rows.rows) {
      if (!r.batch_date) continue;
      const list = byDay.get(r.batch_date) ?? [];
      list.push({
        uploadId: r.id,
        groupId: r.group_id ?? "",
        groupName: r.group_name,
        departmentName: r.department_name,
        batchDate: r.batch_date,
        dailyReports: (r.daily_reports as Array<Record<string, unknown>>) ?? [],
        status: r.status,
        uploadedAt: r.uploaded_at,
      });
      byDay.set(r.batch_date, list);
    }

    const days = Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([batchDate, uploads]) => ({ batchDate, uploads }));

    return { days };
  }

  /**
   * 撈指定 group + 日期的原始訊息 · tenant_admin 想看「bot 收到什麼」用
   * · 對照 PDR empty state pattern · 讓使用者確認訊息確實進 DB · 只是 AI 抽不出
   * · RLS 已擋跨 tenant (line_message tenant scope)
   * · 上限 100 則 · 避免 payload 爆
   */
  async listGroupMessages(args: { groupId: string; batchDate: string }): Promise<{
    messages: Array<{
      messageId: string;
      senderName: string | null;
      senderLineId: string | null;
      messageType: string;
      textContent: string | null;
      sentAt: string;
    }>;
    total: number;
  }> {
    const tx = currentTx();
    const res = await tx.execute<{
      message_id: string;
      sender_line_id: string | null;
      sender_name: string | null;
      message_type: string;
      text_content: string | null;
      sent_at: string;
    }>(sql`
      SELECT lm.message_id,
             lm.sender_line_id,
             u.display_name AS sender_name,
             lm.message_type,
             lm.text_content,
             lm.sent_at::text
      FROM line_message lm
      LEFT JOIN users u ON u.user_id = lm.sender_user_id
      WHERE lm.group_id = ${args.groupId}
        AND (lm.sent_at AT TIME ZONE 'Asia/Taipei')::date = ${args.batchDate}::date
        AND lm.chat_context = 'group'
      ORDER BY lm.sent_at ASC
      LIMIT 100
    `);
    const messages = res.rows.map((r) => ({
      messageId: r.message_id,
      senderName: r.sender_name,
      senderLineId: r.sender_line_id,
      messageType: r.message_type,
      textContent: r.text_content,
      sentAt: r.sent_at,
    }));
    // 也回 total (避免使用者以為 100 是全部)
    const countRes = await tx.execute<{ total: string }>(sql`
      SELECT count(*)::text AS total
      FROM line_message lm
      WHERE lm.group_id = ${args.groupId}
        AND (lm.sent_at AT TIME ZONE 'Asia/Taipei')::date = ${args.batchDate}::date
        AND lm.chat_context = 'group'
    `);
    return { messages, total: parseInt(countRes.rows[0]?.total ?? "0", 10) };
  }
}

function sqlToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function sqlDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
