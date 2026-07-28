import { Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx, withSystemTx } from "../db/client.js";
import type { ConfirmStatus } from "../warroom-task-board/ticket-lane.js";

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
  confirmStatus: ConfirmStatus;
  /** 記錄本身的狀態 open/in_progress/resolved/info · 存查區用來標「公告」還是「已完成」 */
  status: string | null;
  assigneeDisplayName: string | null;
  /** 對到的系統帳號 · null 表示尚未歸屬 */
  assigneeUserId: string | null;
  assigneeAccountName: string | null;
  /** none=AI 沒抽到人名 / unclaimed=有人名但對不到（導入期正常）/ assigned=已對到帳號 */
  assignStatus: "none" | "unclaimed" | "assigned";
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
  records: Array<Record<string, unknown>>;    // AI 抽的分類記錄 · 業務對話 (無工廠報工) 情境當 fallback 顯示
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
      unconfirmed: WarroomTicket[];  // 待確認 · 中信心 · 等主管決定要不要收為任務
      archived: WarroomTicket[];     // 未列入待辦 · 公告/已完成/已忽略 (limit 50)
    };
    counts: { pending: number; signed: number; overdue: number; unconfirmed: number; archived: number };
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
      confirm_status: ConfirmStatus;
      status: string | null;
      assignee_display_name: string | null;
      assignee_user_id: string | null;
      assignee_account_name: string | null;
      assign_status: string;
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
             t.summary, t.confidence, t.confirm_status, t.status,
             t.assignee_display_name, t.assignee_user_id::text, t.assign_status,
             au.display_name AS assignee_account_name,
             t.due_at::text,
             t.source_upload_id, t.source_record_index,
             t.created_at::text,
             t.department_id::text, d.department_name,
             u.display_name AS confirmed_by_name,
             t.confirmed_at::text
      FROM tickets t
      LEFT JOIN departments d ON d.department_id = t.department_id
      LEFT JOIN users u ON u.user_id = t.confirmed_by
      LEFT JOIN users au ON au.user_id = t.assignee_user_id
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
      status: r.status,
      assigneeDisplayName: r.assignee_display_name,
      assigneeUserId: r.assignee_user_id,
      assigneeAccountName: r.assignee_account_name,
      assignStatus: (r.assign_status ?? "none") as "none" | "unclaimed" | "assigned",
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
    // 中信心 · 還沒被主管認定是不是任務。不放進待簽核，也不讓它悄悄消失
    const unconfirmed = all.filter((t) => t.confirmStatus === "待確認");
    // 未列入待辦：公告、已完成、以及主管標「不用追」的。留著可查、可改回待辦。
    // 標了不用追就從畫面上徹底消失的話，按錯了沒有任何補救途徑（同 doc §2.1 的理由）
    const notTracked = all.filter((t) => t.confirmStatus === "存查" || t.confirmStatus === "已忽略");
    const archived = notTracked.slice(0, 50);

    return {
      kanban: { pending, signed, overdue, unconfirmed, archived },
      counts: {
        pending: pending.length,
        signed: all.filter((t) => t.confirmStatus === "已簽核").length,
        overdue: overdue.length,
        unconfirmed: unconfirmed.length,
        archived: notTracked.length,
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
      records: unknown;
      group_name: string | null;
      department_name: string | null;
    }>(sql`
      SELECT au.id, au.group_id, au.batch_date::text, au.status,
             au.uploaded_at::text,
             ar.daily_reports,
             ar.records,
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
        records: (r.records as Array<Record<string, unknown>>) ?? [],
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
  /**
   * 某張任務卡的「來源原文」——AI 抽出的內容 vs 當時的原始訊息。
   *
   * 為什麼簽核的人一定要看得到：AI 只是輔助，主管簽下去是要負責的。
   * 看不到原文的話，簽核等於幫 AI 背書，審核就沒有意義（R11 可溯源的用意也在此）。
   *
   * 不需要新權限：**看得到這張 ticket 就看得到它的來源**。
   * ticket 走 currentTx()，RLS 已經把範圍切好（group_owner 只看得到自己部門的），
   * 查不到就代表無權查看 → 回 404，不另外做一套判斷。
   */
  async ticketSource(ticketId: string): Promise<{
    summary: string;
    extracted: Record<string, unknown> | null;
    messages: Array<{ id: number; time: string; sender: string; text: string; kind: string }>;
    unavailableReason: string | null;
  }> {
    const tx = currentTx();
    const t = await tx.execute<{ summary: string; source_upload_id: number | null; source_record_index: number | null }>(sql`
      SELECT summary, source_upload_id, source_record_index
      FROM tickets WHERE ticket_id = ${ticketId}::uuid LIMIT 1
    `);
    const ticket = t.rows[0];
    if (!ticket) throw new NotFoundException("找不到這張任務，或你沒有權限查看");

    const empty = (reason: string) => ({
      summary: ticket.summary, extracted: null, messages: [], unavailableReason: reason,
    });
    if (ticket.source_upload_id == null || ticket.source_record_index == null) {
      return empty("這張任務沒有對應的來源分析（可能是手動建立，或來源分析已被刪除）");
    }

    // analysis_result 無 RLS · 前一步已用 ticket 授權過
    const r = await withSystemTx((stx) => stx.execute<{ messages: unknown; records: unknown }>(sql`
      SELECT messages, records FROM analysis_result WHERE upload_id = ${ticket.source_upload_id}
    `));
    const row = r.rows[0];
    if (!row) return empty("來源分析結果已不存在");

    const records = (row.records as Array<Record<string, unknown>> | null) ?? [];
    const rec = records[ticket.source_record_index];
    if (!rec) return empty("來源分析結果的內容已變動，對不到原本那一筆");

    const sourceIds = new Set((rec.source_ids as number[] | undefined) ?? []);
    const all = (row.messages as Array<{ id: number; time: string; sender: string; text: string; kind: string }> | null) ?? [];
    const messages = all.filter((m) => sourceIds.has(m.id));

    return {
      summary: ticket.summary,
      extracted: rec,
      messages,
      // 抽取結果有標 source_ids 卻對不到訊息 → 要說出來，不能讓人以為「本來就沒有原文」
      unavailableReason: sourceIds.size > 0 && messages.length === 0
        ? "這筆抽取有標記來源訊息，但在分析結果中找不到對應內容" : null,
    };
  }

  /**
   * 主管手動派發任務給某人。
   *
   * 這是導入期的**主要**流程，不是自動歸屬失敗時的退路 ——
   * 手動派發本來就是「AI 可能認錯」時的確認機制；員工陸續綁定 LINE 後，
   * 自動歸屬才逐步接手（doc §2 / §3.3）。
   *
   * 權限走 RLS：tickets policy 已限本租戶、group_owner 再限本部門，
   * 查不到就是無權操作 → 404，不另做一套判斷。
   */
  async assignTicket(ticketId: string, assigneeUserId: string | null, actorUserId: string): Promise<{
    ticketId: string; assignStatus: string; assigneeUserId: string | null; assigneeName: string | null;
  }> {
    const tx = currentTx();
    if (assigneeUserId) {
      // 只能派給同租戶的人 —— RLS 已限 tickets，這裡再擋 users（避免跨租戶指派）
      const ok = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM users WHERE user_id = ${assigneeUserId}::uuid
      `);
      if ((ok.rows[0]?.n ?? 0) === 0) throw new NotFoundException("找不到這個成員，或不屬於貴公司");
    }
    const status = assigneeUserId ? "assigned" : "unclaimed";
    const res = await tx.execute<{ ticket_id: string; name: string | null }>(sql`
      UPDATE tickets t
         SET assignee_user_id = ${assigneeUserId}::uuid,
             assign_status    = ${status},
             assigned_by      = ${actorUserId}::uuid,
             assigned_at      = now(),
             updated_at       = now()
       WHERE t.ticket_id = ${ticketId}::uuid
      RETURNING t.ticket_id::text,
                (SELECT display_name FROM users WHERE user_id = ${assigneeUserId}::uuid) AS name
    `);
    if (res.rows.length === 0) throw new NotFoundException("找不到這張任務，或你沒有權限操作");
    return {
      ticketId, assignStatus: status, assigneeUserId,
      assigneeName: res.rows[0].name,
    };
  }

  /**
   * 待確認的票 · 主管定奪：收為任務 或 不用追。
   *
   * 為什麼決定要落到 DB 而不是前端隱藏：群組會重新分析（手動重跑、排程補跑），
   * 「不用追」的東西如果下次又冒出來，主管第二次就不會再點了（doc F-3）。
   * 已忽略屬於「人的決定」，materializer 重跑時不會被覆寫。
   */
  async decideTicket(ticketId: string, accept: boolean, actorUserId: string): Promise<{
    ticketId: string; confirmStatus: string;
  }> {
    const tx = currentTx();
    const next = accept ? "待簽核" : "已忽略";
    const res = await tx.execute<{ ticket_id: string }>(sql`
      UPDATE tickets
         SET confirm_status = ${next},
             confirmed_by   = ${accept ? null : actorUserId}::uuid,
             updated_at     = now()
       WHERE ticket_id = ${ticketId}::uuid
         -- accept 時也允許把先前標「不用追」的改回來 —— 按錯了要救得回來
         -- 用 string_to_array 而非把 JS 陣列丟進 ANY()：Drizzle 會展成 tuple
         --    ANY(($1,$2))，Postgres 直接 42809。tsc 全綠、要 runtime 才炸
         AND confirm_status = ANY(string_to_array(${accept ? "待確認,已忽略" : "待確認"}, ','))
      RETURNING ticket_id::text
    `);
    // 改到 0 列＝不存在、已經被別人處理過、或不在權限範圍。不透露是哪一種。
    if (res.rows.length === 0) throw new NotFoundException("找不到這張任務，或它已經被處理了");
    return { ticketId, confirmStatus: next };
  }

  /** 可被指派的成員（同租戶）· 手動派發下拉用 */
  async assignableMembers(): Promise<Array<{ userId: string; name: string; hasLineBinding: boolean }>> {
    const res = await currentTx().execute<{ user_id: string; name: string | null; bound: boolean }>(sql`
      SELECT u.user_id::text, u.display_name AS name,
             EXISTS(SELECT 1 FROM user_line_binding b
                     WHERE b.user_id = u.user_id AND b.status = 'active') AS bound
        FROM users u
       WHERE u.role <> 'aiproot_admin'
       ORDER BY u.display_name NULLS LAST
    `);
    return res.rows.map((r) => ({
      userId: r.user_id, name: r.name ?? "（未命名）", hasLineBinding: r.bound,
    }));
  }

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
