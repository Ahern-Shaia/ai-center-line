import { Injectable, Logger } from "@nestjs/common";
import PQueue from "p-queue";
import { withSystemTx } from "../db/client.js";
import { LineMessageRepository } from "../line-ingest/line-message.repository.js";
import { AnalysisBatchService } from "./analysis-batch.service.js";

/**
 * Batch scheduler · CAR-M3-1
 *
 * 平台化後（scheduler-config M2）· @Cron decorator 已移除
 * · 由 SchedulerManager 依 scheduler_config 表動態註冊 CronJob
 * · runPending 保留為純 executor · 由 SchedulerManager.dispatch / 手動 endpoint 呼
 *
 * FMEA:
 * - 併發過高 → PQueue 限 concurrency (config 讀 · default 3)
 * - runBatch 內失敗 → analysis_batch.status = failed · 手動 UI (M3-3) retry
 */
@Injectable()
export class BatchSchedulerService {
  private readonly logger = new Logger(BatchSchedulerService.name);

  constructor(
    private readonly messageRepo: LineMessageRepository,
    private readonly batchService: AnalysisBatchService,
  ) {}

  /**
   * 手動觸發 · aiproot UI / tenant_admin UI · 或 SchedulerManager 呼叫
   * · lookback 天數可調 · default 2
   * · tenantId: optional · 傳則限單 tenant
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
