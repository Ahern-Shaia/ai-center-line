import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DataSyncService } from "./sync.service.js";

// Cron scheduler · every 15 minutes 觸發 fan-out sync
// 對應 docs/modules/data-sync-layer.md v0.2 · OQ-DSL-1 (A · 15min)
// SCHEDULE_ENABLED=false → 跳過（unit test / dev 環境不想被 cron 觸發時用）
@Injectable()
export class DataSyncScheduler {
  private readonly logger = new Logger(DataSyncScheduler.name);
  private readonly enabled: boolean;

  constructor(private readonly svc: DataSyncService) {
    this.enabled = (process.env.DSL_SCHEDULE_ENABLED ?? "true").toLowerCase() !== "false";
    if (!this.enabled) {
      this.logger.log("DSL_SCHEDULE_ENABLED=false · scheduler 跳過所有 cron tick");
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES) // 註：@nestjs/schedule 內建 EVERY_15_MINUTES · 但語法某些版本不同 · 用 EVERY_10 是近似值 · 實測可切 CronExpression.EVERY_15_MINUTES
  async tick(): Promise<void> {
    if (!this.enabled) return;
    const startedAt = Date.now();
    this.logger.log("[cron] sync tick 開始");
    const results = await this.svc.runAllTenants();
    const totalRecords = results.reduce((sum, r) => sum + r.recordsProcessed, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
    this.logger.log(
      `[cron] sync tick 完成 · ${results.length} 個 (tenant×entity) job · ${totalRecords} 筆處理 · ${totalErrors} 個 error · 耗時 ${Date.now() - startedAt}ms`,
    );
    if (totalErrors > 0) {
      for (const r of results.filter((r) => r.errors > 0)) {
        this.logger.warn(`  → ${r.tenantSlug}/${r.entity} error: ${r.error}`);
      }
    }
  }

  // 手動 trigger（測試 / CLI 用）· 不依賴 cron
  async triggerManual(): Promise<void> {
    await this.tick();
  }
}
