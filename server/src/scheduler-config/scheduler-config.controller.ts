import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
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

  @Get()
  @RequirePermission("scheduler-config:view")
  async list(@CurrentUser() user: JwtUser) {
    return { configs: await this.svc.list(user) };
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
