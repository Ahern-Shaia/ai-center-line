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
  /**
   * 手動 rerun · 指定 tenant + 日期的**所有** group（不管 batch 已 completed）
   * · WarroomBatchController「立即分析」呼叫 · manual 情境 idempotent 允 rerun
   * · 對齊 P1-fix M2 · runBatch 內部若 isManual 允 rerun
   */
  async runForDate(
    triggeredBy: string,
    tenantId: string,
    targetDate: string,
  ): Promise<{
    total: number;
    completed: number;
    empty: number;
    failed: number;
  }> {
    const groups = await withSystemTx((tx) => this.messageRepo.findAllGroupsForDate(tx, tenantId, targetDate));
    this.logger.log(`runForDate · tenant=${tenantId} date=${targetDate} · 掃到 ${groups.length} 群組`);
    if (groups.length === 0) return { total: 0, completed: 0, empty: 0, failed: 0 };

    const queue = new PQueue({ concurrency: 3 });
    let completed = 0, empty = 0, failed = 0;

    await Promise.all(groups.map((g) => queue.add(async () => {
      const result = await this.batchService.runBatch({
        tenantId: g.tenantId,
        groupId: g.groupId,
        batchDate: g.batchDate,
        triggeredBy,
      });
      if (result.status === "completed") completed++;
      else if (result.status === "empty") empty++;
      else failed++;
    })));

    this.logger.log(`runForDate done · tenant=${tenantId} date=${targetDate} · completed=${completed} empty=${empty} failed=${failed}`);
    return { total: groups.length, completed, empty, failed };
  }

  async runPending(
    triggeredBy: string,
    lookbackDays = 2,
    tenantId?: string,
    excludeTenants?: Set<string>,
  ): Promise<{
    total: number;
    completed: number;
    empty: number;
    failed: number;
    skipped: number;
  }> {
    const pending = await withSystemTx((tx) => this.messageRepo.findPendingBatches(tx, lookbackDays, tenantId));

    // P1-fix D4 · 排除已有 override 的 tenant
    const filtered = excludeTenants && excludeTenants.size > 0
      ? pending.filter((p) => !excludeTenants.has(p.tenantId))
      : pending;
    const skipped = pending.length - filtered.length;

    this.logger.log(`daily batch 掃到 ${filtered.length} 個待跑 (lookback ${lookbackDays}d, tenant=${tenantId ?? "*"}, skipped ${skipped})`);
    if (filtered.length === 0) return { total: 0, completed: 0, empty: 0, failed: 0, skipped };

    const queue = new PQueue({ concurrency: 3 });
    let completed = 0, empty = 0, failed = 0;

    await Promise.all(filtered.map((p) => queue.add(async () => {
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

    this.logger.log(`daily batch done · completed=${completed} · empty=${empty} · failed=${failed} · skipped=${skipped}`);
    return { total: filtered.length, completed, empty, failed, skipped };
  }
}
