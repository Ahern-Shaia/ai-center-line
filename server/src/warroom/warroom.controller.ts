import { BadRequestException, Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { Roles } from "../auth/roles.decorator.js";
import { WarroomService } from "./warroom.service.js";
import { WarroomTasksService } from "./warroom-tasks.service.js";
import { WorkStatusService } from "../task-completion/work-status.service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("warroom")
export class WarroomController {
  constructor(
    private readonly svc: WarroomService,
    private readonly tasksService: WarroomTasksService,
    private readonly workStatus: WorkStatusService,
  ) {}

  // 三環指標（÷N）＋各群組狀態。RLS 自動限本租戶（group_owner 再限本部門）。
  @Get()
  @Roles("tenant_admin", "group_owner", "consultant")
  async warroom() {
    return this.svc.warroom();
  }

  // WTB-M3 · 任務看板 Kanban
  @Get("tasks")
  @Roles("tenant_admin", "group_owner", "consultant", "aiproot_admin")
  async tasks(@Query("signed") includeSigned?: string) {
    return this.tasksService.listTasks({ includeSignedOff: includeSigned !== "false" });
  }

  // WTB-M3 · 日誌 view
  @Get("daily-reports")
  @Roles("tenant_admin", "group_owner", "consultant", "aiproot_admin")
  async dailyReports(@Query("from") fromDate?: string, @Query("to") toDate?: string) {
    return this.tasksService.listDailyReports({ fromDate, toDate });
  }

  /** 可指派的成員 · 手動派發下拉用 */
  @Get("assignable-members")
  @Roles("tenant_admin", "group_owner", "consultant", "aiproot_admin")
  async assignableMembers() {
    return { members: await this.tasksService.assignableMembers() };
  }

  /**
   * 手動派發任務給某人（assigneeUserId = null 則退回待認領）。
   * 導入期的主要流程 —— 員工還沒綁定 LINE 時，AI 對不到人，由主管指定。
   */
  @Patch("tickets/:ticketId/assignee")
  @Roles("tenant_admin", "group_owner", "consultant", "aiproot_admin")
  async assign(
    @CurrentUser() user: JwtUser,
    @Param("ticketId") ticketId: string,
    @Body() body: { assigneeUserId?: string | null },
  ) {
    if (!UUID_RE.test(ticketId)) throw new BadRequestException("ticketId 格式不正確");
    const a = body?.assigneeUserId ?? null;
    if (a !== null && !UUID_RE.test(a)) throw new BadRequestException("assigneeUserId 格式不正確");
    return this.tasksService.assignTicket(ticketId, a, user.user_id);
  }

  /**
   * 待確認的票 · 收為任務（accept=true）或不用追（accept=false）。
   * 權限同簽核 —— 決定一件事要不要追，跟確認它抽得對不對是同一層的判斷。
   */
  @Patch("tickets/:ticketId/decision")
  @Roles("tenant_admin", "group_owner", "consultant", "aiproot_admin")
  async decide(
    @CurrentUser() user: JwtUser,
    @Param("ticketId") ticketId: string,
    @Body() body: { accept?: boolean },
  ) {
    if (!UUID_RE.test(ticketId)) throw new BadRequestException("ticketId 格式不正確");
    if (typeof body?.accept !== "boolean") throw new BadRequestException("accept 必須是 true 或 false");
    return this.tasksService.decideTicket(ticketId, body.accept, user.user_id);
  }

  /**
   * 補登結束（M5）· 網頁端 · 主要入口仍是 LINE 引用回覆。
   *
   * 代結案是必然不是例外，所以允許 —— 但一定記 work_closed_by，
   * 且看板要顯示「由 ○○ 代為結束」（doc F-5）。
   */
  @Patch("tickets/:ticketId/work-close")
  @Roles("tenant_admin", "group_owner", "consultant", "aiproot_admin")
  async workClose(
    @CurrentUser() user: JwtUser,
    @Param("ticketId") ticketId: string,
    @Body() body: { outcome?: string; note?: string },
  ) {
    if (!UUID_RE.test(ticketId)) throw new BadRequestException("ticketId 格式不正確");
    if (!body?.outcome) throw new BadRequestException("請選擇結束原因");
    return this.workStatus.close(ticketId, body.outcome, body.note?.trim() || null, user.user_id);
  }

  /** 還原成「尚未確認完成」· 標錯了要有補救途徑，否則沒人敢按（F-4） */
  @Patch("tickets/:ticketId/work-reopen")
  @Roles("tenant_admin", "group_owner", "consultant", "aiproot_admin")
  async workReopen(@CurrentUser() user: JwtUser, @Param("ticketId") ticketId: string) {
    if (!UUID_RE.test(ticketId)) throw new BadRequestException("ticketId 格式不正確");
    return this.workStatus.reopen(ticketId, user.user_id);
  }

  /** 回報進度 · 低承諾動作 · 任務留在進行中（§2.1） */
  @Patch("tickets/:ticketId/work-report")
  @Roles("tenant_admin", "group_owner", "consultant", "aiproot_admin")
  async workReport(
    @CurrentUser() user: JwtUser,
    @Param("ticketId") ticketId: string,
    @Body() body: { note?: string },
  ) {
    if (!UUID_RE.test(ticketId)) throw new BadRequestException("ticketId 格式不正確");
    return this.workStatus.report(ticketId, body?.note ?? "", user.user_id);
  }

  // 某張任務卡的來源原文 · 簽核前拿 AI 抽取結果與原始訊息對照
  // 權限：能看到 ticket 就能看到來源（RLS 已切範圍）· 不另設 permission
  @Get("tickets/:ticketId/source")
  @Roles("tenant_admin", "group_owner", "consultant", "aiproot_admin")
  async ticketSource(@Param("ticketId") ticketId: string) {
    if (!UUID_RE.test(ticketId)) throw new BadRequestException("ticketId 格式不正確");
    return this.tasksService.ticketSource(ticketId);
  }

  // 群組原始訊息 · tenant_admin 想看「bot 收到什麼」用
  // 對照 PDR empty state pattern · 展開讓使用者確認訊息確實進 DB (只是 AI 抽不出)
  @Get("group-messages")
  @Roles("tenant_admin", "group_owner", "consultant", "aiproot_admin")
  async groupMessages(
    @Query("groupId") groupId?: string,
    @Query("date") date?: string,
  ) {
    if (!groupId) throw new BadRequestException("groupId 必要");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException("date 格式錯 · 應為 YYYY-MM-DD");
    return this.tasksService.listGroupMessages({ groupId, batchDate: date });
  }
}
