import { BadRequestException, Body, Controller, HttpException, HttpStatus, Logger, Post } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { BatchSchedulerService } from "../convo-analysis-realtime/batch-scheduler.service.js";
import { withSystemTx } from "../db/client.js";
import { LineApiClient } from "../line-ingest/line-api.client.js";
import { LineGroupRepository } from "../line-ingest/line-group.repository.js";

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
  private readonly logger = new Logger(WarroomBatchController.name);

  constructor(
    private readonly scheduler: BatchSchedulerService,
    private readonly lineApi: LineApiClient,
    private readonly groupRepo: LineGroupRepository,
  ) {}

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

    // 前置 backfill · 掃自 tenant 所有 display_name IS NULL 的 group · 呼 LINE API 拉群名
    // (webhook 新群自動 probe 已加 · 這裡是為 legacy 髒資料 backfill)
    await this.backfillGroupNames(user.tenant_id);

    const triggeredBy = `manual-tenant:${user.user_id}`;
    // rerun 當日全部 group · 用戶明確意圖花 AI 錢重跑
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
    return this.scheduler.runForDate(triggeredBy, user.tenant_id, today);
  }

  /**
   * Backfill · 掃該 tenant 底下 display_name IS NULL 的 active group
   * 逐個呼 LINE API 拉名 · 失敗只 log
   */
  private async backfillGroupNames(tenantId: string): Promise<void> {
    try {
      const nameless = await withSystemTx((tx) => tx.execute<{
        bot_id: string;
        group_id: string;
        channel_access_token: string;
      }>(sql`
        SELECT g.bot_id::text, g.group_id, b.channel_access_token
        FROM line_group g
        JOIN line_bot b ON b.bot_id = g.bot_id
        WHERE b.tenant_id = ${tenantId}::uuid
          AND g.display_name IS NULL
          AND g.status = 'active'
      `));
      if (nameless.rows.length === 0) return;
      this.logger.log(`backfill display_name · tenant=${tenantId} · ${nameless.rows.length} 群待補`);

      let ok = 0, fail = 0;
      for (const g of nameless.rows) {
        try {
          const summary = await this.lineApi.getGroupSummary(g.channel_access_token, g.group_id);
          if (summary?.groupName) {
            await withSystemTx((tx) => this.groupRepo.updateDisplayName(tx, {
              botId: g.bot_id,
              groupId: g.group_id,
              displayName: summary.groupName,
            }));
            ok++;
          } else {
            fail++;
          }
        } catch (err) {
          fail++;
          this.logger.warn(`backfill probe 失敗 · groupId=${g.group_id} · ${(err as Error).message}`);
        }
      }
      this.logger.log(`backfill done · tenant=${tenantId} · ok=${ok} fail=${fail}`);
    } catch (err) {
      // Backfill 失敗不影響 rerun · 只 log
      this.logger.warn(`backfill 整體失敗 · tenant=${tenantId} · ${(err as Error).message}`);
    }
  }
}
