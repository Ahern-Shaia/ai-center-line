import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import { withSystemTx } from "../db/client.js";
import { LineMessageRepository } from "../line-ingest/line-message.repository.js";

/**
 * Nudge Service · 未綁定偵測工具 · 方向 3（不當綁定 · 只提示）
 * 對照 employee-line-binding.md §6.9 · §7-quinque.13
 *
 * 定期掃活躍但未綁定的 LINE UserId · 提示 aiproot 業助追人綁定
 * · 每日 09:00 台北 (aiproot 業助上班時已算好)
 */
@Injectable()
export class NudgeService {
  private readonly logger = new Logger(NudgeService.name);

  constructor(
    private readonly messageRepo: LineMessageRepository,
  ) {}

  /**
   * 每日 09:00 台北 · 記 log · 前端 dashboard 觸發實際計算
   */
  @Cron("0 9 * * *", { timeZone: "Asia/Taipei" })
  async handleDailyNudge(): Promise<void> {
    if (process.env.NUDGE_CRON_ENABLED === "false") {
      this.logger.log("NUDGE_CRON_ENABLED=false · skip");
      return;
    }
    const stats = await this.computeUnboundStats();
    const total = stats.reduce((s, r) => s + r.unboundCount, 0);
    this.logger.log(`Nudge cron · ${stats.length} tenants · ${total} unbound active UserIds`);
  }

  /**
   * 計算所有 tenant 未綁定活躍者 · 供 aiproot audit 頁 UI 用
   * (aiproot admin 也可手動觸發)
   */
  async computeUnboundStats(): Promise<Array<{
    tenantId: string;
    tenantName: string;
    unboundCount: number;
    top: Array<{ senderLineId: string; displayName: string | null; messageCount: number; topGroupName: string | null }>;
  }>> {
    const tenantsRes = await withSystemTx((tx) => tx.execute<{ tenant_id: string; tenant_name: string }>(sql`
      SELECT tenant_id::text, tenant_name FROM tenants
    `));

    const results: Array<{
      tenantId: string; tenantName: string; unboundCount: number;
      top: Array<{ senderLineId: string; displayName: string | null; messageCount: number; topGroupName: string | null }>;
    }> = [];

    for (const t of tenantsRes.rows) {
      const unbound = await withSystemTx((tx) => this.messageRepo.findUnboundActiveUsers(tx, t.tenant_id, 7));
      results.push({
        tenantId: t.tenant_id,
        tenantName: t.tenant_name,
        unboundCount: unbound.length,
        top: unbound.slice(0, 10).map((r) => ({
          senderLineId: r.senderLineId,
          displayName: r.displayName,
          messageCount: r.messageCount,
          topGroupName: r.topGroupName,
        })),
      });
    }
    return results;
  }
}
