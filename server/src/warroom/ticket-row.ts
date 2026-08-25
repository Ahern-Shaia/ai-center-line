// tickets 的共用查詢與列映射
//
// 從 warroom-tasks.service.ts 抽出來的（純搬移，沒有行為變更）。
// 抽的理由：存查頁要**自己的**分頁查詢，不能再吃看板那份「先撈 500 筆再用 JS 分堆」。
// 若各寫各的 SELECT，兩邊的 join、逾時判準、displayState 遲早會各自漂移 ——
// 而漂移的症狀是「同一張票在看板和存查顯示不同狀態」，沒人會第一時間想到是兩份 SQL。
//
// ⚠️ 這裡只放**查詢與映射**。分堆、篩選、分頁各自留在呼叫端。
import { sql, type SQL } from "drizzle-orm";
import { displayState, type ConfirmStatus } from "../warroom-task-board/ticket-lane.js";

/** index signature 是 drizzle `tx.execute<T>` 的型別約束要的 */
export interface TicketRow extends Record<string, unknown> {
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
  group_name: string | null;
  category_name: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  work_status: "open" | "closed" | "record";
  work_outcome: string | null;
  work_closed_via: string | null;
  work_closed_by_name: string | null;
  work_last_report_at: string | null;
  work_last_report_note: string | null;
  work_asked_at: string | null;
}

/**
 * SELECT ... FROM tickets ... 的共用前半段。呼叫端自己接 WHERE / ORDER BY / LIMIT。
 *
 * ⚠️ `su`（analysis_upload）沒有 RLS，但 join 的是本 ticket 自己的 upload_id，不跨租戶。
 * ⚠️ category_registry 用 slug 不用 category_id：prod 實查 category_id 100% 為 null。
 */
export const TICKET_SELECT: SQL = sql`
  SELECT t.ticket_id, t.category, t.category_id::text,
         t.summary, t.confidence, t.confirm_status, t.status,
         t.assignee_display_name, t.assignee_user_id::text, t.assign_status,
         au.display_name AS assignee_account_name,
         t.due_at::text,
         t.source_upload_id, t.source_record_index,
         t.created_at::text,
         t.department_id::text, d.department_name,
         lg.display_name AS group_name,
         cr.category_name AS category_name,
         u.display_name AS confirmed_by_name,
         t.confirmed_at::text,
         t.work_status, t.work_outcome, t.work_closed_via,
         wu.display_name AS work_closed_by_name,
         t.work_last_report_at::text, t.work_last_report_note,
         t.work_asked_at::text
    FROM tickets t
    LEFT JOIN departments d ON d.department_id = t.department_id
    LEFT JOIN analysis_upload su ON su.id = t.source_upload_id
    LEFT JOIN line_group lg ON lg.group_id = su.group_id
    LEFT JOIN category_registry cr ON cr.tenant_id = t.tenant_id AND cr.category_slug = t.category
    LEFT JOIN users u ON u.user_id = t.confirmed_by
    LEFT JOIN users au ON au.user_id = t.assignee_user_id
    LEFT JOIN users wu ON wu.user_id = t.work_closed_by
`;

/** 只有 FROM/JOIN（給 count(*) 用）—— 跟 TICKET_SELECT 走同一組 join，條件才會一致 */
export const TICKET_FROM: SQL = sql`
  FROM tickets t
  LEFT JOIN analysis_upload su ON su.id = t.source_upload_id
  LEFT JOIN line_group lg ON lg.group_id = su.group_id
`;

/**
 * 列 → WarroomTicket。graceDays 與 now 由呼叫端給，同一次請求內所有卡片共用同一個 now
 * （每張各自呼叫 Date.now() 的話，跨秒時同一批資料會算出不同天數）。
 *
 * 泛型回傳：型別定義留在 warroom-tasks.service.ts（那是它的公開契約），
 * 這裡不重複宣告一份會漂移的複本。
 */
export function makeTicketMapper(graceDays: number, now: number) {
  const daysSince = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 86_400_000);

  /** 卡住＝已核對、工作還開著、且超過寬限期。「卡住 N 天」的 N 是持續多久（duration）*/
  const isStuck = (r: TicketRow) =>
    r.work_status === "open" && r.confirm_status === "已簽核"
    && daysSince(r.created_at) > graceDays;

  /** 逾時 N 天是「超出多少」（excess），跟卡住的語意不同，所以要減掉寬限期 */
  const overdueDaysOf = (dueAt: string | null, createdAt: string): number | null => {
    const d = dueAt ? daysSince(dueAt) : daysSince(createdAt) - graceDays;
    return d >= 1 ? d : null;
  };

  return (r: TicketRow) => ({
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
    groupName: r.group_name,
    categoryName: r.category_name,
    confirmedByName: r.confirmed_by_name,
    confirmedAt: r.confirmed_at,
    workStatus: r.work_status,
    workOutcome: r.work_outcome,
    workClosedVia: r.work_closed_via,
    workClosedByName: r.work_closed_by_name,
    workLastReportAt: r.work_last_report_at,
    workLastReportNote: r.work_last_report_note,
    stuckDays: isStuck(r) ? daysSince(r.created_at) : null,
    stuckKind: isStuck(r)
      ? (r.assign_status === "assigned" ? "no_report" as const : "unassigned" as const)
      : null,
    overdueDays: overdueDaysOf(r.due_at, r.created_at),
    displayState: displayState({
      workStatus: r.work_status,
      workOutcome: r.work_outcome,
      workLastReportAt: r.work_last_report_at,
      workAskedAt: r.work_asked_at,
      confirmStatus: r.confirm_status,
      assignStatus: r.assign_status,
      status: r.status,
    }),
  });
}
