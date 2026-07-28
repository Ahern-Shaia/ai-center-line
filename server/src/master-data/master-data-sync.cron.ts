import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MasterDataSyncService } from "./master-data-sync.service.js";

/**
 * 每日主檔同步 · docs/modules/master-data-sync.md
 *
 * 一個租戶失敗不影響其他租戶 —— 失敗原因已由 service 落庫（last_sync_error），
 * 頁面上看得到「上次同步失敗：⋯」。沒有這個，主檔停止更新不會有任何人發現（F-4）。
 */
@Injectable()
export class MasterDataSyncCron {
  private readonly logger = new Logger(MasterDataSyncCron.name);

  constructor(private readonly sync: MasterDataSyncService) {}

  @Cron("0 4 * * *", { timeZone: "Asia/Taipei" })
  async daily(): Promise<{ ok: number; failed: number }> {
    const tenants = await this.sync.listSyncableTenants();
    let ok = 0, failed = 0;
    for (const tenantId of tenants) {
      try {
        const r = await this.sync.syncTenant(tenantId);
        ok += 1;
        this.logger.log(`主檔同步 · tenant=${tenantId} · ${r.count} 筆`);
      } catch (e) {
        failed += 1;
        this.logger.error(`主檔同步失敗 · tenant=${tenantId}`, e as Error);
      }
    }
    if (tenants.length > 0) this.logger.log(`每日主檔同步完成 · 成功 ${ok} · 失敗 ${failed}`);
    return { ok, failed };
  }
}
