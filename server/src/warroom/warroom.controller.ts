import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { WarroomService } from "./warroom.service.js";
import { WarroomTasksService } from "./warroom-tasks.service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("warroom")
export class WarroomController {
  constructor(
    private readonly svc: WarroomService,
    private readonly tasksService: WarroomTasksService,
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
