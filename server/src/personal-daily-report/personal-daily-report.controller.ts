import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { sql as sql_import } from "drizzle-orm";
import { currentTx, withTenant } from "../db/client.js";
import { EmployeeBindingService } from "../employee-binding/employee-binding.service.js";
import { PersonalDailyReportRepository, type PersonalDailyReportItem } from "./personal-daily-report.repository.js";
import { PersonalDailyReportService } from "./personal-daily-report.service.js";
import { PersonalReportNotifyService } from "./personal-report-notify.service.js";
import { PersonalReportSchedulerService } from "./personal-report-scheduler.service.js";

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
    if (!botId || !lineUserId) throw new BadRequestException("botId 和 lineUserId 必要");
    if (!uuidRegex.test(botId)) throw new BadRequestException("botId 格式錯 · 需為 UUID");
    const date = dateStr ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException("date 格式錯 · 應為 YYYY-MM-DD");

    // 認證 · 走綁定表對照
    const userId = await this.bindingService.resolveUserByLineUserId(botId, lineUserId);
    if (!userId) throw new NotFoundException("未綁定 · 請先完成 LINE 綁定");

    // 撈日報 · aiproot_admin 上下文跨租戶讀 (personal_daily_report RLS 允)
    const row = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.getByUserDate(tx, userId, date));
    // 今日私訊筆數 + 原始 list · empty state 展開讓使用者確認 bot 有收到什麼
    const pendingMessageCount = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.countPersonalMessagesForDate(tx, userId, date));
    // 一律回傳當日原始訊息（不再「有日報就不回」）：
    // bot 收到就該立刻看得到，AI 整理只是輔助 —— 否則日報生成後的新訊息會完全隱形。
    const pendingMessages = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.listPersonalMessagesForDate(tx, userId, date));

    // 撈員工姓名 · 顯示用
    const info = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{ display_name: string; tenant_name: string }>(sql_import`
      SELECT u.display_name, t.tenant_name
      FROM users u JOIN tenants t ON t.tenant_id = u.tenant_id
      WHERE u.user_id = ${userId}::uuid
    `));
    const user = info.rows[0];

    return {
      report: row,
      requestedDate: date,
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
    if (!body?.botId || !body?.lineUserId) throw new BadRequestException("botId 和 lineUserId 必要");
    if (!uuidRegex.test(body.botId)) throw new BadRequestException("botId 格式錯 · 需為 UUID");
    if (!Array.isArray(body.items)) throw new BadRequestException("items 必要");
    const date = body.date ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException("date 格式錯");
    const action = body.action ?? "save_draft";

    const userId = await this.bindingService.resolveUserByLineUserId(body.botId, body.lineUserId);
    if (!userId) throw new NotFoundException("未綁定");

    const row = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.getByUserDate(tx, userId, date));
    if (!row) throw new BadRequestException("尚無日報 · 需先讓 AI 生成 (私訊 bot 幾則後重打開)");

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
    if (!body?.botId || !body?.lineUserId) throw new BadRequestException("botId 和 lineUserId 必要");
    if (!uuidRegex.test(body.botId)) throw new BadRequestException("botId 格式錯");
    const date = body.date ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException("date 格式錯");

    const userId = await this.bindingService.resolveUserByLineUserId(body.botId, body.lineUserId);
    if (!userId) throw new NotFoundException("未綁定");

    // 需 tenantId · 從綁定間接查
    const info = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{ tenant_id: string }>(sql_import`
      SELECT tenant_id::text FROM users WHERE user_id = ${userId}::uuid
    `));
    const tenantId = info.rows[0]?.tenant_id;
    if (!tenantId) throw new NotFoundException("user 無 tenant");

    return this.svc.generate({ tenantId, userId, reportDate: date });
  }

  @Get("mine")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner", "employee")
  async getMine(@CurrentUser() user: JwtUser, @Query("date") dateStr?: string) {
    const date = dateStr ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException("date 格式錯 · 應為 YYYY-MM-DD");
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
      open_days: number; last_report_note: string | null;
    }>(sql_import`
      SELECT ticket_id::text, summary, category, created_at::text,
             (now()::date - created_at::date)::int AS open_days,
             work_last_report_note AS last_report_note
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
    const visits = await tx.execute<{ place: string; at: string }>(sql_import`
      SELECT customer_name AS place,
             to_char(punched_at AT TIME ZONE 'Asia/Taipei', 'HH24:MI') AS at
        FROM attendance_punch
       WHERE user_id = ${user.user_id}::uuid
         AND nullif(btrim(customer_name), '') IS NOT NULL
         AND (punched_at AT TIME ZONE 'Asia/Taipei')::date = ${date}::date
       ORDER BY punched_at
       LIMIT 20
    `);

    return {
      report: row,
      requestedDate: date,
      pendingMessageCount,
      pendingMessages,
      todayVisits: visits.rows.map((v) => ({ place: v.place, at: v.at })),
      assignedTasks: assigned.rows.map((t) => ({
        ticketId: t.ticket_id, summary: t.summary, category: t.category, createdAt: t.created_at,
        // 開了幾天 · 讓人一眼看出哪些拖著（我們沒有 due_at，用天數代替）
        openDays: t.open_days,
        lastReportNote: t.last_report_note,
      })),
      userDisplayName: meta?.display_name ?? "",
      tenantName: meta?.tenant_name ?? "",
    };
  }

  @Post("mine/save")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner", "employee")
  async saveMine(
    @CurrentUser() user: JwtUser,
    @Body() body: { date?: string; items?: PersonalDailyReportItem[]; action?: "save_draft" | "send" },
  ) {
    const date = body.date ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException("date 格式錯");
    if (!Array.isArray(body.items)) throw new BadRequestException("items 必要");
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
    if (!row) throw new BadRequestException("尚未生成日報 · 請先傳訊息給 bot 或按重新生成");
    if (row.userId !== user.user_id) throw new ForbiddenException("只能編輯自己的日報");

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
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner", "employee")
  async regenerateMine(
    @CurrentUser() user: JwtUser,
    @Body() body: { date?: string } = {},
  ) {
    const date = body.date ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException("date 格式錯");
    // 需 tenantId · 從 JWT 拿
    if (!user.tenant_id) throw new ForbiddenException("aiproot admin 沒 tenant · 需帶 tenantId 參數（未實作）");
    const res = await this.svc.generate({
      tenantId: user.tenant_id,
      userId: user.user_id,
      reportDate: date,
    });
    return res;
  }

  @Get("team")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner")
  async team(@Query("from") fromDate?: string, @Query("to") toDate?: string) {
    const to = toDate ?? getTaipeiDate();
    const from = fromDate ?? subtractDays(to, 7);
    if (!isValidDate(from) || !isValidDate(to)) throw new BadRequestException("from/to 格式錯");
    const tx = currentTx();
    const rows = await this.repo.listByRange(tx, { fromDate: from, toDate: to, limit: 200 });
    return { reports: rows, from, to };
  }

  @Post("aiproot/run-scheduler")
  @Roles("aiproot_admin")
  async runScheduler(@Body() body: { date?: string } = {}) {
    const date = body.date ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException("date 格式錯");
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
