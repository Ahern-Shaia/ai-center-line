import { Body, Controller, Get, Patch, Query } from "@nestjs/common";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { TaskConfigService } from "./task-config.service.js";
import { resolveTenantId } from "../auth/resolve-tenant-id.js";

/**
 * 任務設定 · doc §4「時間」區塊。
 *
 * 兩層模型（§1.4）：權限由 aiproot 開放（task-config:*），
 * 開放之後**內容是客戶自己的** —— 幾天沒簽核算逾時，每家公司不一樣。
 */
@Controller("task-config")
export class TaskConfigController {
  constructor(private readonly svc: TaskConfigService) {}

  @Get()
  @RequirePermission("task-config:view")
  async read(@CurrentUser() user: JwtUser, @Query("tenantId") tenantId?: string) {
    // 租戶邊界在 controller 判 —— client 的輸入進來的地方。
    // 塞進 service 的話，下一個呼叫者就會忘記（2026-07-29 IDOR 的成因）
    return this.svc.read(resolveTenantId(user, tenantId));
  }

  @Patch("timing")
  @RequirePermission("task-config:timing")
  async updateTiming(
    @CurrentUser() user: JwtUser,
    @Body() body: { tenantId?: string; graceDays: number; tierDays: [number, number] },
  ) {
    return this.svc.update(user, resolveTenantId(user, body.tenantId), body);
  }
}
