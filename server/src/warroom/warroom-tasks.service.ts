import { Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx, withSystemTx } from "../db/client.js";
import { displayState, type ConfirmStatus } from "../warroom-task-board/ticket-lane.js";
import { TaskConfigService } from "../task-config/task-config.service.js";
import { AssignNotifyService } from "./assign-notify.service.js";

/**
 * WarroomTasksService · WTB-M3
 * 對照 docs/modules/warroom-task-board.md §6-§7
 *
 * · 任務看板 (Kanban) · list tickets grouped by confirm_status
 * · 日誌 view · list daily_reports by day
 * · role-scoped filter · RLS 已處理 group_owner 限 own department
 */

/** 來源訊息 · media 為 null 代表這一則不是照片／影片 */
export interface SourceMessage {
  id: number;
  time: string;
  sender: string;
  text: string;
  kind: string;
  media: { mediaId: string; kind: string } | null;
}

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
  // 0036 · 第四條軸（當責人本人回報）· displayState 是四軸投影後的對外單一狀態
  workStatus: "open" | "closed";
  workOutcome: string | null;
  workClosedVia: string | null;
  workClosedByName: string | null;      // 代結案時 UI 要顯示「由 ○○ 代為結束」
  workLastReportAt: string | null;
  workLastReportNote: string | null;
  displayState: string;
  /**
   * 卡住幾天 · null = 沒卡住（正常的卡片不長 pill）
   *
   * ⚠️ 這是**量級**不是歸屬。design-research-taskboard.md §2 弱點 #3：
   * 「membership ≠ 嚴重度 —— 東西在逾時欄但沒說逾時多久，少了 triage 需要的量級」。
   * 先前把它做成另開一區（membership），正是被點名的那個錯。
   */
  stuckDays: number | null;
  /** 卡住的種類 · 決定主管要催派工還是問障礙 */
  stuckKind: "unassigned" | "no_report" | null;
  /** 逾時幾天 · due_at 是 null 時退回用建立日算（prod 的 due_at 100% 為 null）*/
  overdueDays: number | null;
  confirmedAt: string | null;
}

export interface WarroomDaily {
  uploadId: number;
  groupId: string;
  groupName: string | null;
  /** null = 這個群還沒分派部門 —— 分析會跑，但**一張任務都不會建**（materializer 直接 skip）*/
  departmentId: string | null;
  departmentName: string | null;
  batchDate: string;
  dailyReports: Array<Record<string, unknown>>;
  records: Array<Record<string, unknown>>;    // AI 抽的分類記錄 · 業務對話 (無工廠報工) 情境當 fallback 顯示
  status: string;
  uploadedAt: string;
}

@Injectable()
export class WarroomTasksService {
  constructor(
    private readonly taskConfig: TaskConfigService,
    private readonly assignNotify: AssignNotifyService,
  ) {}

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
    counts: {
      pending: number; signed: number; overdue: number; unconfirmed: number; archived: number;
      /** 卡住的張數 · 給「只看卡住的」篩選用（Linear display options）*/
      stuck: number;
    };
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
      work_status: "open" | "closed";
      work_outcome: string | null;
      work_closed_via: string | null;
      work_closed_by_name: string | null;
      work_last_report_at: string | null;
      work_last_report_note: string | null;
      work_asked_at: string | null;
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
             t.confirmed_at::text,
             t.work_status, t.work_outcome, t.work_closed_via,
             wu.display_name AS work_closed_by_name,
             t.work_last_report_at::text, t.work_last_report_note,
             t.work_asked_at::text
      FROM tickets t
      LEFT JOIN departments d ON d.department_id = t.department_id
      LEFT JOIN users u ON u.user_id = t.confirmed_by
      LEFT JOIN users au ON au.user_id = t.assignee_user_id
      LEFT JOIN users wu ON wu.user_id = t.work_closed_by
      ORDER BY t.created_at DESC
      LIMIT 500
    `);

    const now = Date.now();
    const daysSince = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 86_400_000);

    /**
     * 逾時幾天 · null = 沒逾時。**進欄與 pill 都用這一個判準**，不可能再漂移。
     *
     * ⚠️ 先前進欄用 `now - created > 7天`、pill 用 `floor(天數) > 7`，
     *    於是 7～8 天之間的票**在欄裡卻沒有 pill**，看起來像 pill 壞了。
     *
     * ⚠️ 數字的意思是「**超過期限幾天**」不是「建立至今幾天」。
     *    due_at 是 null 時（prod 100%），隱含期限＝建立後「寬限期」那麼多天，
     *    所以逾時＝天數 − 寬限期。先前直接顯示 age，25 天的票寫「逾時 25 天」是誇大 ——
     *    實際只逾了 18 天。標籤講的事要跟實際相符（同「未完成 vs 未確認完成」的紀律）。
     *
     * ⚠️ 寬限期不再硬編：每家公司對 task 的性質要求不一樣（維修 7 天合理、詢價太長）。
     */
    const { graceDays: GRACE_DAYS } = await this.taskConfig.forCurrentTenant(currentTx());
    /**
     * 卡住＝已簽核、工作還開著、且超過寬限期。
     * ⚠️「卡住 N 天」的 N 是**持續多久**（duration），跟「逾時 N 天」的
     *   **超出多少**（excess）語意不同，所以這裡顯示 age 而不是 age − 寬限期。
     */
    const isStuck = (r: { work_status: string; confirm_status: string; created_at: string }) =>
      r.work_status === "open" && r.confirm_status === "已簽核"
      && daysSince(r.created_at) > GRACE_DAYS;
    const overdueDaysOf = (t: { dueAt: string | null; createdAt: string }): number | null => {
      const d = t.dueAt ? daysSince(t.dueAt) : daysSince(t.createdAt) - GRACE_DAYS;
      return d >= 1 ? d : null;
    };

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
      workStatus: r.work_status,
      workOutcome: r.work_outcome,
      workClosedVia: r.work_closed_via,
      workClosedByName: r.work_closed_by_name,
      workLastReportAt: r.work_last_report_at,
      workLastReportNote: r.work_last_report_note,
      // ── 量級（不是歸屬）· design-research-taskboard.md §2 弱點 #3 ──
      // 卡住＝已簽核、工作還開著、且超過 7 天。正常的卡片這兩欄是 null，不長 pill
      //（同「信心度只在中／低顯」的克制原則：全部都顯眼＝沒有重點）
      // ⚠️ 用同一個 GRACE_DAYS，不要再寫一個獨立的 7 —— 兩個魔術數字遲早各自漂移
      stuckDays: isStuck(r) ? daysSince(r.created_at) : null,
      stuckKind: isStuck(r)
        ? (r.assign_status === "assigned" ? "no_report" as const : "unassigned" as const)
        : null,
      // ⚠️ due_at 在 prod 100% 是 null（抽取 schema 還沒有時間欄位），
      //    只吃 due_at 的舊寫法讓這個 pill 永遠不會顯示 —— §4 那行 ⬜ 掛了五天的原因。
      overdueDays: overdueDaysOf({ dueAt: r.due_at, createdAt: r.created_at }),
      // 四軸投影成對外一個狀態 —— 四個下拉並排丟給現場主管沒人看得懂
      displayState: displayState({
        workStatus: r.work_status,
        workOutcome: r.work_outcome,
        workLastReportAt: r.work_last_report_at,
        workAskedAt: r.work_asked_at,
        confirmStatus: r.confirm_status,
        assignStatus: r.assign_status,
        status: r.status,
      }),
    }));

    const overdue = all.filter(
      (t) => t.confirmStatus === "待簽核" && t.overdueDays !== null,
    );
    const overdueSet = new Set(overdue.map((t) => t.ticketId));
    const pending = all.filter((t) => t.confirmStatus === "待簽核" && !overdueSet.has(t.ticketId));
    // ⚠️ 卡住的**留在這一欄**，只是排到最前面。
    //
    // 先前把它們搬到另一個區塊，結果上線第一天所有歷史已簽核任務的 work_status
    // 都還是預設的 open、又都超過 7 天 —— 判定全部成立，整欄被搬空，
    // 主看板剩兩個空框，13 張真內容擠在附屬區塊。
    //
    // 根因是把**量級**（卡住多久）做成了**歸屬**（在哪一區），
    // 正是 design-research-taskboard.md §2 弱點 #3 點名的錯。
    // 告警佇列（Datadog／PagerDuty）不會因為某個告警卡住就把它移到另一張表。
    const signed = includeSigned
      ? all.filter((t) => t.confirmStatus === "已簽核")
        .sort((a, b) => (b.stuckDays ?? -1) - (a.stuckDays ?? -1))   // 卡最久的排最前
        .slice(0, 30)
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
        // 這個數字要跟畫面上看得到的卡片數一致（超過 30 由前端註腳說明）
        signed: signed.length,
        overdue: overdue.length,
        unconfirmed: unconfirmed.length,
        archived: notTracked.length,
        stuck: all.filter((t) => t.stuckDays !== null).length,
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
      department_id: string | null;
      department_name: string | null;
    }>(sql`
      -- ⚠️ DISTINCT ON：同一群同一天可能有**多次**分析（排程跑一次、有人手動重跑一次），
      --    每次都是一列 analysis_upload。原本全列出來，畫面上就是同一個群的卡片
      --    重複兩張、內容還略有出入（2026-07-27 客戶回報）。
      --    重跑的用意是取代前一次，所以只留最新那次。
      SELECT DISTINCT ON (au.group_id, au.batch_date)
             au.id, au.group_id, au.batch_date::text, au.status,
             au.uploaded_at::text,
             ar.daily_reports,
             ar.records,
             lg.display_name AS group_name,
             lg.department_id::text AS department_id,
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
      ORDER BY au.group_id, au.batch_date DESC, au.uploaded_at DESC
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
        departmentId: r.department_id,
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
  /**
   * 把照片掛回它自己那一則訊息。
   *
   * 對照鏈（prod 抽驗過是精準的）：
   *   `analysis_result.messages[i].id` 是**解析索引**
   *   → `analysis_upload.source_message_ids[i]` 是該則的真實 LINE 訊息 id
   *   → join `line_media`
   *
   * ⚠️ 走 `withSystemTx` 是因為上一步已用 tickets 的 RLS 授權過這張票；
   *    line_media 沒有租戶欄位，只能靠 line_message join 回去。
   *    這裡只回 id 與型別，內容仍走 `GET /media/:id/content`（需 media:view，
   *    且每次存取都會進 audit_log）—— 網址一個都不外流。
   */
  private async attachMedia(uploadId: number, msgs: Array<{
    id: number; time: string; sender: string; text: string; kind: string;
  }>): Promise<SourceMessage[]> {
    if (msgs.length === 0) return [];

    const r = await withSystemTx((stx) => stx.execute<{
      idx: number; media_id: string; media_type: string;
    }>(sql`
      WITH idmap AS (
        SELECT generate_subscripts(source_message_ids, 1) - 1 AS idx,
               unnest(source_message_ids) AS message_id
          FROM analysis_upload WHERE id = ${uploadId}
      )
      SELECT idmap.idx, md.media_id::text, md.media_type
        FROM idmap
        JOIN line_media md ON md.message_id = idmap.message_id AND md.deleted_at IS NULL`));

    const byIdx = new Map(r.rows.map((x) => [Number(x.idx), { mediaId: x.media_id, kind: x.media_type }]));
    return msgs.map((m) => ({ ...m, media: byIdx.get(m.id) ?? null }));
  }

  async ticketSource(ticketId: string): Promise<{
    summary: string;
    extracted: Record<string, unknown> | null;
    messages: SourceMessage[];
    /**
     * 這張任務有沒有留下「哪幾則訊息」的連結。
     * ⚠️ false 與「這幾則訊息沒有照片」是**兩件事**，前端要分開講 ——
     * 前者是我們不知道，後者是確定沒有。都留白的話主管無從判斷自己看到的是全部還是殘缺。
     */
    hasSourceLink: boolean;
    unavailableReason: string | null;
  }> {
    const tx = currentTx();
    const t = await tx.execute<{
      summary: string; source_upload_id: number | null; source_record_index: number | null;
      source_message_ids: string[] | null;
    }>(sql`
      SELECT summary, source_upload_id, source_record_index, source_message_ids
      FROM tickets WHERE ticket_id = ${ticketId}::uuid LIMIT 1
    `);
    const ticket = t.rows[0];
    if (!ticket) throw new NotFoundException("找不到這張任務，或你沒有權限查看");

    const hasSourceLink = (ticket.source_message_ids?.length ?? 0) > 0;
    const empty = (reason: string) => ({
      summary: ticket.summary, extracted: null, messages: [], hasSourceLink, unavailableReason: reason,
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
    const picked = all.filter((m) => sourceIds.has(m.id));

    // ⭐ 原文裡的「[照片]」只是一段文字，看不到內容就無法判斷這該不該變成任務。
    //    照片早就存在 line_media，把它掛回**它自己那一則**訊息 ——
    //    另外列一排的話，「這個可以嗎」指的是哪一張就看不出來。
    const messages = await this.attachMedia(ticket.source_upload_id, picked);

    return {
      summary: ticket.summary,
      extracted: rec,
      messages,
      hasSourceLink,
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
  /**
   * 手動指派。指派成功後私訊當事人（task-assign-notify M1）。
   *
   * ⚠️ 通知結果一定要回傳。送不出去而畫面沒說的話，**主管會以為對方知道了**，
   *    事情就卡在那裡 —— 那是本模組 FMEA 的 A-1（P0）。
   */
  async assignTicket(ticketId: string, assigneeUserId: string | null, actorUserId: string): Promise<{
    ticketId: string; assignStatus: string; assigneeUserId: string | null; assigneeName: string | null;
    notified: boolean; notifySkipReason: string | null;
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

    // 摘要與操作者姓名 —— 通知內文要用
    const meta = await tx.execute<{ summary: string; actor: string | null }>(sql`
      SELECT t.summary,
             (SELECT display_name FROM users WHERE user_id = ${actorUserId}::uuid) AS actor
        FROM tickets t WHERE t.ticket_id = ${ticketId}::uuid`);
    const summary = meta.rows[0]?.summary ?? "（無摘要）";
    const actorName = meta.rows[0]?.actor ?? "主管";

    if (assigneeUserId) {
      const n = await this.assignNotify.onAssigned(tx, {
        ticketId, assigneeUserId, summary, actorName,
      });
      return {
        ticketId, assignStatus: status, assigneeUserId, assigneeName: res.rows[0].name,
        notified: n.notified, notifySkipReason: n.skipReason,
      };
    }

    // 退回待認領 → 只通知原本推過的那個人（A-6）
    await this.assignNotify.onUnassigned(tx, { ticketId, summary });
    return {
      ticketId, assignStatus: status, assigneeUserId: null, assigneeName: null,
      notified: false, notifySkipReason: null,
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
