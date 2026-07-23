import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { BatchSchedulerService } from "../convo-analysis-realtime/batch-scheduler.service.js";

/**
 * WarroomBatchController · scheduler-config M3
 * 對照 docs/modules/scheduler-config.md §6 · OQ-SCH-4 A
 *
 * · tenant_admin 可手動觸發自 tenant 當日 group_batch 分析
 * · aiproot_admin 也可用（跨 tenant 靠既有 /aiproot-console/batches/rerun · 這 endpoint 是 tenant scope 快捷）
 * · lookback=0 · 只跑當日 · 避免 tenant_admin 誤觸補救大批舊資料
 * · tenantId 從 JWT 取 · body 不接（防跨 tenant 觸發 · P0 mitigation）
 */
@Controller("warroom/batches")
export class WarroomBatchController {
  constructor(private readonly scheduler: BatchSchedulerService) {}

  @Post("rerun")
  @Roles("aiproot_admin", "tenant_admin")
  async rerun(
    @Body() _body: Record<string, unknown>,
    @CurrentUser() user: JwtUser,
  ) {
    if (!user.tenant_id) {
      throw new BadRequestException("tenant_admin 需綁定 tenant");
    }
    const triggeredBy = `manual-tenant:${user.user_id}`;
    // lookback=0 · 只跑當日 · tenant 從 JWT 取（P0 · 防跨 tenant 觸發）
    return this.scheduler.runPending(triggeredBy, 0, user.tenant_id);
  }
}
