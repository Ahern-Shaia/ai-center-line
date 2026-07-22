import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import PQueue from "p-queue";
import { withSystemTx } from "../db/client.js";
import { LineMessageRepository } from "../line-ingest/line-message.repository.js";
import { AnalysisBatchService } from "./analysis-batch.service.js";

/**
 * Batch scheduler · CAR-M3-1
 *
 * OQ-CAR-5 (A) 裁定：每天 08:00 (Asia/Taipei) 掃昨日 batches
 * · findPendingBatches lookback 2 天（保底 · 昨天 cron 掛也能補跑）
 * · 逐 (tenant, group, batch_date) 呼叫 runBatch
 * · 併發限 3 · 避免同時打爆 Anthropic API + 節流 batch cost 集中觸發
 *
 * FMEA:
 * - Cron 沒觸發 (Render service 沒起 / 崩) → 隔天 cron 掃到補跑 (lookback 2)
 * - 併發過高 → PQueue 限 3
 * - runBatch 內失敗 → analysis_batch.status = failed · 手動 UI (M3-3) retry
 */
@Injectable()
export class BatchSchedulerService {
  private readonly logger = new Logger(BatchSchedulerService.name);

  constructor(
    private readonly messageRepo: LineMessageRepository,
    private readonly batchService: AnalysisBatchService,
  ) {}

  // 每天 00:00 UTC = 08:00 Asia/Taipei
  // 用 Cron string 而非 EVERY_DAY_AT_MIDNIGHT · 為了明確 timezone 意圖
  @Cron("0 0 * * *", { name: "convo-analysis-batch-daily", timeZone: "Asia/Taipei" })
  async handleDailyBatch(): Promise<void> {
    // 若 env 明確 disable · skip (便於 dev / rollout gradual)
    if (process.env.CAR_BATCH_CRON_ENABLED === "false") {
      this.logger.log("CAR_BATCH_CRON_ENABLED=false · skip daily batch");
      return;
    }
    await this.runPending("cron");
  }

  /**
   * 手動觸發 (aiproot UI) · 或 cron 呼叫
   * · lookback 天數可調 · default 2
   * · tenantId: optional · 傳則限單 tenant (aiproot UI 下拉選單傳)
   */
  async runPending(triggeredBy: string, lookbackDays = 2, tenantId?: string): Promise<{
    total: number;
    completed: number;
    empty: number;
    failed: number;
  }> {
    const pending = await withSystemTx((tx) => this.messageRepo.findPendingBatches(tx, lookbackDays, tenantId));
    this.logger.log(`daily batch 掃到 ${pending.length} 個待跑 (lookback ${lookbackDays}d, tenant=${tenantId ?? "*"})`);
    if (pending.length === 0) return { total: 0, completed: 0, empty: 0, failed: 0 };

    const queue = new PQueue({ concurrency: 3 });
    let completed = 0, empty = 0, failed = 0;

    await Promise.all(pending.map((p) => queue.add(async () => {
      const result = await this.batchService.runBatch({
        tenantId: p.tenantId,
        groupId: p.groupId,
        batchDate: p.batchDate,
        triggeredBy,
      });
      if (result.status === "completed") completed++;
      else if (result.status === "empty") empty++;
      else failed++;
    })));

    this.logger.log(`daily batch done · completed=${completed} · empty=${empty} · failed=${failed}`);
    return { total: pending.length, completed, empty, failed };
  }
}
