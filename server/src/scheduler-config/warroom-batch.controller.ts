import { BadRequestException, Body, Controller, HttpException, HttpStatus, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { BatchSchedulerService } from "../convo-analysis-realtime/batch-scheduler.service.js";

// P1-fix M3 · in-memory rate limit
// tenant_admin 每 5 分鐘只能觸發一次「立即分析」· 防止 self-DDoS
const RATE_LIMIT_MS = 5 * 60 * 1000;
const lastTriggered = new Map<string, number>();

/**
 * WarroomBatchController · scheduler-config M3
 * 對照 docs/modules/scheduler-config.md §6 · OQ-SCH-4 A
 *
 * · tenant_admin 可手動觸發自 tenant 當日 group_batch 分析
 * · aiproot_admin 也可用（跨 tenant 靠既有 /aiproot-console/batches/rerun · 這 endpoint 是 tenant scope 快捷）
 * · lookback=0 · 只跑當日 · 避免 tenant_admin 誤觸補救大批舊資料
 * · tenantId 從 JWT 取 · body 不接（防跨 tenant 觸發 · P0 mitigation）
 * · 5 分鐘 rate limit · 防連點自 DDoS
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

    // P1-fix M3 · rate limit (5 min per tenant)
    const now = Date.now();
    const last = lastTriggered.get(user.tenant_id) ?? 0;
    const elapsed = now - last;
    if (elapsed < RATE_LIMIT_MS) {
      const waitSec = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
      throw new HttpException(`操作太頻繁 · ${waitSec} 秒後再試（每 5 分鐘限一次）`, HttpStatus.TOO_MANY_REQUESTS);
    }
    lastTriggered.set(user.tenant_id, now);

    const triggeredBy = `manual-tenant:${user.user_id}`;
    // rerun 當日全部 group · 用戶明確意圖花 AI 錢重跑
    // (findPendingBatches 只給 pending · 已跑過的 skip · 對「立即分析」語意不對)
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
    return this.scheduler.runForDate(triggeredBy, user.tenant_id, today);
  }
}
