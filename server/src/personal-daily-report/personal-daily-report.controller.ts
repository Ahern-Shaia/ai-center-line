import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { friendlyAiError } from "../llm/ai-error-message.js";
import { schedulerTimeLabel } from "../scheduler-config/scheduler-time.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { resolveTenantFilter } from "../auth/resolve-tenant-id.js";
import { sql as sql_import } from "drizzle-orm";
import { currentTx, withTenant } from "../db/client.js";
import { EmployeeBindingService } from "../employee-binding/employee-binding.service.js";
import { PersonalDailyReportRepository, type PersonalDailyReportItem } from "./personal-daily-report.repository.js";
import { PersonalDailyReportService } from "./personal-daily-report.service.js";
import { PersonalReportNotifyService } from "./personal-report-notify.service.js";
import { PersonalReportSchedulerService } from "./personal-report-scheduler.service.js";
import { msg } from "../i18n/index.js";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PersonalDailyReportController · PDR-M4
 * 對照 docs/modules/personal-daily-report.md §7
 *
 * 員工端：
 *   GET  /personal-daily-report/mine?date=YYYY-MM-DD → 拿今日 (或 date) draft
 *   POST /personal-daily-report/mine/save → 儲存 final_items · status=confirmed
 *   POST /personal-daily-report/mine/send → 儲存 final_items · status=sent
 *   POST /personal-daily-report/mine/regenerate → 重新走 AI (若 empty / failed)
 *
 * 主管端（M5 加）：
 *   GET  /personal-daily-report/team?from=&to= → 部門日報 (RLS 已限)
 *
 * Aiproot 端：
 *   POST /personal-daily-report/aiproot/run-scheduler → 手動觸發 scheduler
 */
@Controller("personal-daily-report")
export class PersonalDailyReportController {
  constructor(
    private readonly svc: PersonalDailyReportService,
    private readonly repo: PersonalDailyReportRepository,
    private readonly scheduler: PersonalReportSchedulerService,
    private readonly notify: PersonalReportNotifyService,
    private readonly bindingService: EmployeeBindingService,
  ) {}

  // ==================================================================
  // LIFF endpoints · @Public · 用 botId + lineUserId 認證 (LIFF SDK 保證)
  // 對照 employee-line-binding.md · 同一「一次綁定 · 兩處識別」pattern
  // ==================================================================

  @Public()
  @Get("liff/mine")
  async liffGetMine(
    @Query("botId") botId: string,
    @Query("lineUserId") lineUserId: string,
    @Query("date") dateStr?: string,
  ) {
    if (!botId || !lineUserId) throw new BadRequestException(msg("srv.v.needBotAndUser"));
    if (!uuidRegex.test(botId)) throw new BadRequestException(msg("srv.v.botId"));
    const date = dateStr ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException(msg("srv.v.dateYmd"));

    // 認證 · 走綁定表對照
    const userId = await this.bindingService.resolveUserByLineUserId(botId, lineUserId);
    if (!userId) throw new NotFoundException(msg("srv.bind.notBoundHint"));

    // 撈日報 · aiproot_admin 上下文跨租戶讀 (personal_daily_report RLS 允)
    const row = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.getByUserDate(tx, userId, date));
    // 今日私訊筆數 + 原始 list · empty state 展開讓使用者確認 bot 有收到什麼
    const pendingMessageCount = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.countPersonalMessagesForDate(tx, userId, date));
    // 一律回傳當日原始訊息（不再「有日報就不回」）：
    // bot 收到就該立刻看得到，AI 整理只是輔助 —— 否則日報生成後的新訊息會完全隱形。
    const pendingMessages = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.listPersonalMessagesForDate(tx, userId, date));

    // 撈員工姓名 · 顯示用
    const info = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{ display_name: string; tenant_name: string; tenant_id: string }>(sql_import`
      SELECT u.display_name, t.tenant_name, t.tenant_id::text
      FROM users u JOIN tenants t ON t.tenant_id = u.tenant_id
      WHERE u.user_id = ${userId}::uuid
    `));
    const user = info.rows[0];
    const liffAiRunAt = await withTenant({ tenantId: null, role: "aiproot_admin" },
      (tx) => schedulerTimeLabel(tx, user?.tenant_id ?? null, "pdr"));

    return {
      report: reportForClient(row),
      requestedDate: date,
      // AI 幾點會整理 · 每家自己設，不可在前端寫死（prod 實例：台灣福祉改成 18:00）
      aiRunAt: liffAiRunAt,
      userDisplayName: user?.display_name ?? "",
      tenantName: user?.tenant_name ?? "",
      pendingMessageCount,
      pendingMessages,
    };
  }

  @Public()
  @Post("liff/save")
  async liffSave(@Body() body: {
    botId?: string;
    lineUserId?: string;
    date?: string;
    items?: PersonalDailyReportItem[];
    action?: "save_draft" | "send";
  }) {
    if (!body?.botId || !body?.lineUserId) throw new BadRequestException(msg("srv.v.needBotAndUser"));
    if (!uuidRegex.test(body.botId)) throw new BadRequestException(msg("srv.v.botId"));
    if (!Array.isArray(body.items)) throw new BadRequestException(msg("srv.v.needItems"));
    const date = body.date ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException(msg("srv.v.date"));
    const action = body.action ?? "save_draft";

    const userId = await this.bindingService.resolveUserByLineUserId(body.botId, body.lineUserId);
    if (!userId) throw new NotFoundException(msg("srv.bind.notBound"));

    const row = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.getByUserDate(tx, userId, date));
    if (!row) throw new BadRequestException(msg("srv.pdr.noReportYet"));

    await withTenant({ tenantId: row.tenantId, role: "tenant_admin" }, (tx) => this.repo.saveFinal(tx, {
      reportId: row.reportId,
      finalItems: body.items!,
      action,
    }));

    // 送出時 · 通知主管
    if (action === "send") {
      void this.notify.notifySubmission({
        reportId: row.reportId,
        tenantId: row.tenantId,
        userId,
        itemCount: body.items!.length,
        reportDate: row.reportDate,
      });
    }

    return { success: true, action };
  }

  @Public()
  @Post("liff/regenerate")
  async liffRegenerate(@Body() body: {
    botId?: string;
    lineUserId?: string;
    date?: string;
  }) {
    if (!body?.botId || !body?.lineUserId) throw new BadRequestException(msg("srv.v.needBotAndUser"));
    if (!uuidRegex.test(body.botId)) throw new BadRequestException(msg("srv.v.botId"));
    const date = body.date ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException(msg("srv.v.date"));

    const userId = await this.bindingService.resolveUserByLineUserId(body.botId, body.lineUserId);
    if (!userId) throw new NotFoundException(msg("srv.bind.notBound"));

    // 需 tenantId · 從綁定間接查
    const info = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{ tenant_id: string }>(sql_import`
      SELECT tenant_id::text FROM users WHERE user_id = ${userId}::uuid
    `));
    const tenantId = info.rows[0]?.tenant_id;
    if (!tenantId) throw new NotFoundException(msg("srv.auth.noTenant"));

    return this.svc.generate({ tenantId, userId, reportDate: date });
  }

  @Get("mine")
  @RequirePermission("personal-report:mine")
  async getMine(@CurrentUser() user: JwtUser, @Query("date") dateStr?: string) {
    const date = dateStr ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException(msg("srv.v.dateYmd"));
    // currentTx() 已於 interceptor 設 tenant + user context · RLS 會擋別的
    const tx = currentTx();
    const row = await this.repo.getByUserDate(tx, user.user_id, date);
    const pendingMessageCount = await this.repo.countPersonalMessagesForDate(tx, user.user_id, date);
    // 同上 · 一律回傳當日原始訊息（bot 收到即可見 · 不必等 AI）
    const pendingMessages = await this.repo.listPersonalMessagesForDate(tx, user.user_id, date);
    // 撈員工姓名 · preview 用（主管將看到的 header）
    const info = await tx.execute<{ display_name: string; tenant_name: string }>(sql_import`
      SELECT u.display_name, t.tenant_name
      FROM users u JOIN tenants t ON t.tenant_id = u.tenant_id
      WHERE u.user_id = ${user.user_id}::uuid
    `);
    const meta = info.rows[0];
    // 指派給我、尚未簽核的任務（task-to-personal-report §5）
    // ⚠️ 不自動寫進日報 —— 由本人決定要不要納入。本人是歸屬錯誤的最後一道防線。
    // ⚠️ 只帶 summary 不帶原始對話：任務可能來自本人不在的群組（doc §6 F-3）。
    const assigned = await tx.execute<{
      ticket_id: string; summary: string; category: string | null; created_at: string;
      open_days: number; last_report_note: string | null; department_id: string | null;
    }>(sql_import`
      SELECT ticket_id::text, summary, category, created_at::text,
             (now()::date - created_at::date)::int AS open_days,
             work_last_report_note AS last_report_note,
             department_id::text AS department_id
      FROM tickets
      WHERE assignee_user_id = ${user.user_id}::uuid
        -- 只帶「已經確認是任務」的。待確認的還沒被主管認可為任務，
        -- 提早出現在同仁日報等於要他做一件公司還沒決定要做的事（doc F-6）
        AND confirm_status IN ('待簽核', '已簽核', '逾時警示')
        -- ⭐ 0036 · M6 · 以**本人有沒有回報完成**為準，不是以主管簽核為準。
        -- 原本條件是 confirm_status IN ('待簽核','逾時警示')，
        -- 意思是主管一簽核，任務就從當責人的清單消失 —— 但簽核代表
        -- 「AI 抽對了」，不是「工作做完了」。負責的人在「這被確認是一件
        -- 真任務」的那一刻失去了它（doc §1.3b）。
        AND work_status = 'open'
      ORDER BY created_at DESC
      LIMIT 20
    `);
    // 今天去過哪 · four-features-reflection.md §5（P5）
    //
    // 日報 16 份只有 3 份送出（19%）。最可能的原因是「要自己想今天做了什麼」——
    // 但系統其實知道他今天去了哪，只是這一頁看不到。
    // 從「要自己想」變成「看一眼、改一下、送出」。
    // ⚠️ 一樣不自動寫進日報，由本人決定要不要納入（同 assignedTasks 的理由）。
    const visits = await tx.execute<{ punch_id: string; place: string; at: string; note: string | null }>(sql_import`
      SELECT punch_id::text,
             customer_name AS place,
             to_char(punched_at AT TIME ZONE 'Asia/Taipei', 'HH24:MI') AS at,
             -- punch-note-to-report M2 · 打卡當下寫的那句話，按「加入日報」時直接變成該項的內容
             note
        FROM attendance_punch
       WHERE user_id = ${user.user_id}::uuid
         AND nullif(btrim(customer_name), '') IS NOT NULL
         AND (punched_at AT TIME ZONE 'Asia/Taipei')::date = ${date}::date
       ORDER BY punched_at
       LIMIT 20
    `);

    // ── 今日預定（calendar-sync M4）────────────────────────────────
    //
    // 兩個來源合成一份。**只做一個來源不行**：
    //   · tickets.due_at —— 群組對話裡排的事（材料化 M3 寫進去的）
    //   · 先前日報的項目 —— **私訊**裡自己報的事（M4a 才開始抽 dueAt）
    // 客戶原本的抱怨（「我 8/21 報 8/24 行程，為何 8/24 查無此行程」）走的是**私訊**那條。
    // 只做 tickets 那條的話，他報的那件事永遠不會出現 —— 功能對他完全無效（F-8）。
    //
    // ⚠️ 不自動寫進日報。事情可能沒去成、可能改期 —— 由本人按一下才算數，
    //    跟 assignedTasks 同一個原則。
    const alreadyAdded = new Set(
      [...(row?.finalItems ?? []), ...(row?.aiItems ?? [])]
        .map((it) => it.plannedKey).filter((k): k is string => !!k),
    );

    // (a) 指派給我、預定日剛好是這天的任務卡
    const plannedTickets = await tx.execute<{
      ticket_id: string; summary: string; hhmm: string | null;
    }>(sql_import`
      SELECT ticket_id::text, summary,
             -- 只有日期沒時間的（整天事件）顯示「—」不是「00:00」，
             -- 否則看起來像半夜有事（mockup §3）
             CASE WHEN (due_at AT TIME ZONE 'Asia/Taipei')::time = '00:00'
                  THEN NULL
                  ELSE to_char(due_at AT TIME ZONE 'Asia/Taipei', 'HH24:MI') END AS hhmm
        FROM tickets
       WHERE assignee_user_id = ${user.user_id}::uuid
         AND due_at IS NOT NULL
         AND (due_at AT TIME ZONE 'Asia/Taipei')::date = ${date}::date
         AND work_status = 'open'
         AND confirm_status IN ('待簽核', '已簽核', '逾時警示')
       ORDER BY due_at
       LIMIT 20
    `);

    // (b) 先前日報裡記下、預定日是這天的項目
    //
    // ⚠️ `report_date <> date`：同一天日報裡自己的項目不算「預定」——
    //    它已經在畫面上了，再列一次等於要他把自己加進自己。
    const plannedFromReports = await tx.execute<{
      report_id: string; idx: number; title: string; due_text: string | null;
      report_date: string; hhmm: string | null;
    }>(sql_import`
      SELECT r.report_id::text, (it.ord - 1)::int AS idx,
             it.value->>'title' AS title,
             it.value->>'dueText' AS due_text,
             r.report_date::text,
             CASE WHEN ((it.value->>'dueAt')::timestamptz AT TIME ZONE 'Asia/Taipei')::time = '00:00'
                  THEN NULL
                  ELSE to_char((it.value->>'dueAt')::timestamptz AT TIME ZONE 'Asia/Taipei', 'HH24:MI') END AS hhmm
        FROM personal_daily_report r
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.final_items, r.ai_items, '[]'::jsonb))
             WITH ORDINALITY AS it(value, ord)
       WHERE r.user_id = ${user.user_id}::uuid
         AND r.report_date <> ${date}::date
         AND nullif(it.value->>'dueAt', '') IS NOT NULL
         AND ((it.value->>'dueAt')::timestamptz AT TIME ZONE 'Asia/Taipei')::date = ${date}::date
       ORDER BY r.report_date
       LIMIT 20
    `);

    const plannedToday = [
      ...plannedTickets.rows.map((t) => ({
        key: `ticket:${t.ticket_id}`,
        title: t.summary,
        time: t.hhmm,
        noteDate: null as string | null,
        dueText: null as string | null,
        ticketId: t.ticket_id as string | null,
      })),
      ...plannedFromReports.rows.map((r) => ({
        key: `pdr:${r.report_id}#${r.idx}`,
        title: r.title,
        time: r.hhmm,
        noteDate: r.report_date,      // 「8/21 記下」· 讓人知道這是什麼時候講的
        dueText: r.due_text,
        ticketId: null as string | null,
      })),
    ].filter((p) => !alreadyAdded.has(p.key));

    return {
      report: reportForClient(row),
      requestedDate: date,
      plannedToday,
      // AI 幾點會整理 · 每家自己設，不可在前端寫死（prod 實例：台灣福祉改成 18:00）
      aiRunAt: await schedulerTimeLabel(tx, user.tenant_id, "pdr"),
      pendingMessageCount,
      pendingMessages,
      // ⚠️ 多回了 punchId / note / addedToReport（punch-note-to-report M2）。
      //    部署順序：**先後端後前端** —— 舊前端讀多出來的欄位不會壞（多給不會壞、少給才會）。
      todayVisits: visits.rows.map((v) => ({
        punchId: v.punch_id,
        place: v.place,
        at: v.at,
        note: v.note,
        // 已經加進今天日報的就標起來，前端不再列（OQ-PNR-4 · 順手修既有的「同一趟可加兩次」）
        addedToReport: alreadyAdded.has(`punch:${v.punch_id}`),
      })),
      // ⚠️ 預定日剛好是這天的任務卡已經在「今日預定」列過，這裡不再列第二次。
      //    同一件事出現在兩個區塊，使用者得自己判斷是不是同一件 —— 多一次判斷就是多一次出錯。
      assignedTasks: assigned.rows.filter((t) => !plannedToday.some((p) => p.ticketId === t.ticket_id)).map((t) => ({
        ticketId: t.ticket_id, summary: t.summary, category: t.category, createdAt: t.created_at,
        // 開了幾天 · 讓人一眼看出哪些拖著（我們沒有 due_at，用天數代替）
        openDays: t.open_days,
        lastReportNote: t.last_report_note,
        // ⭐ 部門制 gate（F-3 修訂）：任務屬本人部門才給看原始對話。跨部門仍只給 summary
        //    （否則等於看到自己沒參與的部門群內容）。判斷在此，實際來源走 assigned-tasks/:id/source。
        canSeeSource: user.department_id != null && t.department_id === user.department_id,
      })),
      userDisplayName: meta?.display_name ?? "",
      tenantName: meta?.tenant_name ?? "",
    };
  }

  /**
   * 指派任務的原始對話 · 部門制 gate（F-3 修訂 · docs/modules/task-to-personal-report.md §6）
   *
   * F-3 原本一律只給 summary（怕任務來自本人不在的群 → 洩漏）。改成：**任務屬本人部門才給看**，
   * 跨部門仍擋。判斷沿用系統既有的部門隱私邊界（tickets RLS 也是按部門），一致而非另立一套。
   *
   * 三道護欄（全在 app 層，不靠 RLS 靜默）：
   *   ① 走本人 currentTx 讀 ticket（RLS 已限本租戶/部門）· 讀不到就是無權 → 404
   *   ② 明驗 assignee == 本人（不是自己的任務不給）
   *   ③ 明驗 ticket.department_id == 本人 department_id（跨部門 → 403）
   * 通過才用 withSystemTx 讀 analysis_result（無 RLS）組來源訊息。
   */
  @Get("assigned-tasks/:ticketId/source")
  @RequirePermission("personal-report:mine")
  async assignedTaskSource(@CurrentUser() user: JwtUser, @Param("ticketId") ticketId: string) {
    if (!uuidRegex.test(ticketId)) throw new BadRequestException(msg("srv.v.ticketId"));
    return this.svc.assignedTaskSource(user.user_id, user.department_id, ticketId);
  }

  @Post("mine/save")
  @RequirePermission("personal-report:mine")
  async saveMine(
    @CurrentUser() user: JwtUser,
    @Body() body: { date?: string; items?: PersonalDailyReportItem[]; action?: "save_draft" | "send" },
  ) {
    const date = body.date ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException(msg("srv.v.date"));
    if (!Array.isArray(body.items)) throw new BadRequestException(msg("srv.v.needItems"));
    const action = body.action ?? "save_draft";

    const tx = currentTx();
    let row = await this.repo.getByUserDate(tx, user.user_id, date);
    // 今天沒有日報列，但本人自己加了項目（來自打卡／指派任務）→ 幫他開一列。
    // 原本一律擋並回「請先傳訊息給 bot」，但那些項目根本不需要私訊 bot 就存在，
    // 加得進去卻送不出去，使用者會走到死路（4FR §5）。
    if (!row && body.items.length > 0 && user.tenant_id) {
      await this.repo.ensureRow(tx, { tenantId: user.tenant_id, userId: user.user_id, reportDate: date });
      row = await this.repo.getByUserDate(tx, user.user_id, date);
    }
    if (!row) throw new BadRequestException(msg("srv.pdr.notGenerated"));
    if (row.userId !== user.user_id) throw new ForbiddenException(msg("srv.pdr.ownOnly"));

    await this.repo.saveFinal(tx, {
      reportId: row.reportId,
      finalItems: body.items,
      action,
    });

    // PDR-M5 · 送出時 · fire-and-forget 通知主管 (P0-N/A · 通知失敗不影響 save 成功)
    if (action === "send") {
      void this.notify.notifySubmission({
        reportId: row.reportId,
        tenantId: row.tenantId,
        userId: user.user_id,
        itemCount: body.items.length,
        reportDate: row.reportDate,
      });
    }
    return { success: true, action };
  }

  @Post("mine/regenerate")
  @RequirePermission("personal-report:mine")
  async regenerateMine(
    @CurrentUser() user: JwtUser,
    @Body() body: { date?: string } = {},
  ) {
    const date = body.date ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException(msg("srv.v.date"));
    // 需 tenantId · 從 JWT 拿
    if (!user.tenant_id) throw new ForbiddenException(msg("srv.auth.aiprootNeedsTenant"));
    const res = await this.svc.generate({
      tenantId: user.tenant_id,
      userId: user.user_id,
      reportDate: date,
    });
    // 原始英文訊息只留在 log 與 DB，不回給使用者
    return { ...res, errorMessage: friendlyAiError(res.errorMessage) ?? undefined };
  }

  /**
   * 部門日報清單。
   *
   * tenantId：平台角色指定要看哪一家；租戶角色一律鎖自己家（resolveTenantFilter 把關）。
   *
   * ⚠️ 平台角色**必須**指定租戶，理由有兩個（2026-08-11 用戶回報）：
   *   1. `departments` 的 policy 是 AND-only、**沒有 aiproot_admin 逃生門**。
   *      `app.current_tenant` 空著時 LEFT JOIN 整個被濾掉 → 部門一律顯示「未分派」，
   *      而那跟「真的沒分派」在畫面上長得一模一樣，看不出是 bug。
   *   2. 不指定的話多家租戶的人混在同一張表，同名的人
   *      （陳○○ 在鮮湧與 aiproot 都有）根本分不出來。
   */
  @Get("team")
  @RequirePermission("personal-report:team")
  async team(
    @CurrentUser() user: JwtUser,
    @Query("from") fromDate?: string,
    @Query("to") toDate?: string,
    @Query("tenantId") tenantId?: string,
  ) {
    const to = toDate ?? getTaipeiDate();
    const from = fromDate ?? subtractDays(to, 7);
    if (!isValidDate(from) || !isValidDate(to)) throw new BadRequestException(msg("srv.v.fromTo"));
    const scope = resolveTenantFilter(user, tenantId);
    if (!scope) {
      throw new BadRequestException({ status: "tenant_id_required", message: "請先選擇要查看的租戶" });
    }
    const tx = currentTx();
    // 設好 current_tenant，departments 才 JOIN 得到（見上方說明）
    await this.repo.setTenantContext(tx, scope);
    // ⚠️ scope 一定要傳進去。setTenantContext 對 aiproot_admin 沒有作用
    //    （RLS 的平台逃生門是最上層的 OR），只有 SQL 裡的 WHERE 擋得住。
    const rows = await this.repo.listByRange(tx, { fromDate: from, toDate: to, limit: 200, tenantId: scope });
    return { reports: rows, from, to };
  }

  /**
   * 補跑個人日報（平台端）· 對應「對話分析歷程」頁的補跑按鈕。
   * 只補空缺、不重跑已存在的（見 scheduler.runPendingForTenant 的說明）。
   */
  @Post("aiproot/run-pending")
  @RequirePermission("personal-report:trigger")
  async runPendingPersonal(
    @CurrentUser() user: JwtUser,
    @Body() body: { tenantId?: string; lookbackDays?: number } = {},
  ) {
    const scope = resolveTenantFilter(user, body.tenantId);
    if (!scope) {
      throw new BadRequestException({ status: "tenant_id_required", message: "請先選擇要補跑的租戶" });
    }
    const lookback = Math.min(90, Math.max(1, body.lookbackDays ?? 2));
    return this.scheduler.runPendingForTenant(scope, lookback);
  }

  @Post("aiproot/run-scheduler")
  @RequirePermission("personal-report:trigger")
  async runScheduler(@Body() body: { date?: string } = {}) {
    const date = body.date ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException(msg("srv.v.date"));
    return this.scheduler.runForDate(date);
  }
}

function getTaipeiDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function subtractDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * 回給前端之前把 AI 的原始錯誤換成中文。
 * ⚠️ DB 裡仍存原文供我們排查 —— 換的是**這一層**，不是資料。
 */
function reportForClient<T extends { errorMessage: string | null } | null>(row: T): T {
  if (!row) return row;
  return { ...row, errorMessage: friendlyAiError(row.errorMessage) };
}
