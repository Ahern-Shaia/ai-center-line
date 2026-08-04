import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { resolveTenantFilter } from "../auth/resolve-tenant-id.js";
import { SchedulerConfigService } from "./scheduler-config.service.js";
import type { SchedulerId } from "./scheduler-config.repository.js";

const VALID_SCHEDULER_IDS: SchedulerId[] = ["pdr", "group_batch"];

/**
 * SchedulerConfigController · scheduler-config M2
 * 對照 docs/modules/scheduler-config.md §4
 *
 * · GET  /scheduler-config       · list (view perm)
 * · POST /scheduler-config       · upsert (manage-tenant · aiproot 可 manage-platform)
 */
@Controller("scheduler-config")
export class SchedulerConfigController {
  constructor(private readonly svc: SchedulerConfigService) {}

  /**
   * tenantId：平台角色用來指定「要看哪一家的 override」。不傳＝只看 platform default。
   *
   * 先前沒有這個參數，於是 aiproot 看不到、也就建不出任何 per-tenant override
   * （前端只能拿 session.tenant_id，平台帳號是 null）。後果是新接的租戶永遠沒有排程 ——
   * 群組收得到訊息、看起來一切正常，但不會被分析，也不會產生日報。
   * 2026-08-04 aiproot 自己的測試群就是這樣累積了 15 則訊息、0 個批次。
   */
  @Get()
  @RequirePermission("scheduler-config:view")
  async list(@CurrentUser() user: JwtUser, @Query("tenantId") tenantId?: string) {
    // 把關寫在 handler 裡（不是 service）—— route-guard 測試靠靜態掃描這一行，
    // 而且與其他 controller 的慣例一致：平台角色可指定，其他角色一律鎖自己家
    return { configs: await this.svc.list(resolveTenantFilter(user, tenantId) ?? null) };
  }

  @Post()
  @RequirePermission("scheduler-config:manage-tenant", "scheduler-config:manage-platform")
  async upsert(
    @CurrentUser() user: JwtUser,
    @Body() body: {
      schedulerId?: string;
      tenantId?: string | null;
      enabled?: boolean;
      cronExpr?: string;
      timeZone?: string;
      minSourceCount?: number;
      lookbackDays?: number;
      concurrency?: number;
    },
  ) {
    if (!body.schedulerId || !VALID_SCHEDULER_IDS.includes(body.schedulerId as SchedulerId)) {
      throw new BadRequestException("schedulerId 必要 · 需為 pdr | group_batch");
    }
    if (!body.cronExpr) throw new BadRequestException("cronExpr 必要");
    if (!body.timeZone) throw new BadRequestException("timeZone 必要");
    if (typeof body.enabled !== "boolean") throw new BadRequestException("enabled 必要 · boolean");

    // tenant_admin 提交 tenantId=null 或不填時 · 強制 fall 到自己的 tenant_id (不允改 platform default)
    let targetTenantId: string | null;
    if (user.role === "aiproot_admin") {
      targetTenantId = body.tenantId ?? null;
    } else {
      targetTenantId = user.tenant_id;
    }

    const row = await this.svc.upsert(user, {
      schedulerId: body.schedulerId as SchedulerId,
      tenantId: targetTenantId,
      enabled: body.enabled,
      cronExpr: body.cronExpr,
      timeZone: body.timeZone,
      minSourceCount: body.minSourceCount ?? 0,
      lookbackDays: body.lookbackDays ?? 1,
      concurrency: body.concurrency ?? 3,
    });
    return { config: row };
  }
}
