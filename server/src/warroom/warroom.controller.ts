import { Controller, Get, Query } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { WarroomService } from "./warroom.service.js";
import { WarroomTasksService } from "./warroom-tasks.service.js";

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
}
