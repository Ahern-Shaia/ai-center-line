import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { currentTx } from "../db/client.js";
import { PersonalDailyReportRepository, type PersonalDailyReportItem } from "./personal-daily-report.repository.js";
import { PersonalDailyReportService } from "./personal-daily-report.service.js";
import { PersonalReportNotifyService } from "./personal-report-notify.service.js";
import { PersonalReportSchedulerService } from "./personal-report-scheduler.service.js";

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
  ) {}

  @Get("mine")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner")
  async getMine(@CurrentUser() user: JwtUser, @Query("date") dateStr?: string) {
    const date = dateStr ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException("date 格式錯 · 應為 YYYY-MM-DD");
    // currentTx() 已於 interceptor 設 tenant + user context · RLS 會擋別的
    const tx = currentTx();
    const row = await this.repo.getByUserDate(tx, user.user_id, date);
    return { report: row, requestedDate: date };
  }

  @Post("mine/save")
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner")
  async saveMine(
    @CurrentUser() user: JwtUser,
    @Body() body: { date?: string; items?: PersonalDailyReportItem[]; action?: "save_draft" | "send" },
  ) {
    const date = body.date ?? getTaipeiDate();
    if (!isValidDate(date)) throw new BadRequestException("date 格式錯");
    if (!Array.isArray(body.items)) throw new BadRequestException("items 必要");
    const action = body.action ?? "save_draft";

    const tx = currentTx();
    const row = await this.repo.getByUserDate(tx, user.user_id, date);
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
  @Roles("aiproot_admin", "consultant", "tenant_admin", "group_owner")
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
