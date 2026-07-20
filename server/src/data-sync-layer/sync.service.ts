import { Injectable, Logger } from "@nestjs/common";
import { withTenant } from "../db/client.js";
import { DataSyncRepository } from "./data-sync.repository.js";
import { DataSyncTenantRegistry, type DataSyncTenantConfig } from "./tenant-config.js";
import { RagicConnector } from "./connectors/ragic.js";
import type { SourceConnector } from "./connectors/base.js";

// Sync service · 對每 tenant pull → normalize → upsert · 寫 sync_log
// 對應 docs/modules/data-sync-layer.md v0.2 §5 · 由 scheduler.service.ts cron 觸發
// sync job 執行在 request scope 外 · 用 withTenant 明確帶 tenantId + aiproot_admin role（跨 tenant 系統操作）

export interface SyncResult {
  tenantSlug: string;
  entity: "order" | "customer" | "contact";
  recordsProcessed: number;
  errors: number;
  latencyMs: number;
  error?: string;
}

@Injectable()
export class DataSyncService {
  private readonly logger = new Logger(DataSyncService.name);
  // Connector cache · 每 tenant × connector 一 instance · avoid rebuilding per-cron-tick
  private readonly connectors = new Map<string, SourceConnector>();

  constructor(
    private readonly registry: DataSyncTenantRegistry,
    private readonly repo: DataSyncRepository,
  ) {}

  private getConnector(cfg: DataSyncTenantConfig): SourceConnector {
    const cached = this.connectors.get(cfg.slug);
    if (cached) return cached;
    if (cfg.connector !== "ragic" || !cfg.ragic) {
      throw new Error(`tenant '${cfg.slug}' connector 未支援：${cfg.connector}`);
    }
    const c = new RagicConnector(cfg.ragic);
    this.connectors.set(cfg.slug, c);
    return c;
  }

  /** 僅測試用：注入 fake connector */
  setConnector(slug: string, c: SourceConnector): void {
    this.connectors.set(slug, c);
  }

  // 對單一 tenant × 單一 entity 執行 pull + upsert + log
  async runSync(
    cfg: DataSyncTenantConfig,
    entity: "order" | "customer" | "contact",
  ): Promise<SyncResult> {
    const connector = this.getConnector(cfg);
    const startedAt = new Date();
    let recordsProcessed = 0;
    let errors = 0;
    let errorMessage: string | undefined;

    try {
      // 走 aiproot_admin role · sync job 是系統跨 tenant actor
      await withTenant(
        { tenantId: cfg.tenantId, role: "aiproot_admin" },
        async (tx) => {
          if (entity === "order") {
            const orders = await connector.pullOrders();
            recordsProcessed = await this.repo.upsertOrders(tx, orders);
          } else if (entity === "customer") {
            const customers = await connector.pullCustomers();
            recordsProcessed = await this.repo.upsertCustomers(tx, customers);
          } else {
            const contacts = await connector.pullContacts();
            recordsProcessed = await this.repo.upsertContacts(tx, contacts);
          }
        },
      );
    } catch (e) {
      errors = 1;
      errorMessage = String((e as Error).message ?? e);
      this.logger.error(`sync ${cfg.slug}/${entity} 失敗: ${errorMessage}`);
    }

    const finishedAt = new Date();
    const latencyMs = finishedAt.getTime() - startedAt.getTime();

    // 寫 sync_log · 錯誤情況也寫 · 用另一個 tx（若上面 tx 因 error abort · log 才不被連帶 rollback）
    try {
      await withTenant(
        { tenantId: cfg.tenantId, role: "aiproot_admin" },
        async (tx) => {
          await this.repo.insertSyncLog(tx, {
            tenantId: cfg.tenantId,
            connector: cfg.connector,
            operation: "pull",
            entity,
            recordsProcessed,
            errors,
            latencyMs,
            startedAt,
            finishedAt,
            metadata: errorMessage ? { error: errorMessage } : {},
          });
        },
      );
    } catch (e) {
      this.logger.error(`sync_log 寫入失敗（不影響 pull 結果）: ${String((e as Error).message ?? e)}`);
    }

    return {
      tenantSlug: cfg.slug,
      entity,
      recordsProcessed,
      errors,
      latencyMs,
      error: errorMessage,
    };
  }

  // Fan-out 每 tenant × 3 entity · Promise.allSettled 避免單一 tenant 掛拖累
  async runAllTenants(): Promise<SyncResult[]> {
    const configs = this.registry.all();
    if (!configs.length) {
      this.logger.log("data-sync-layer 無 tenant 配置 · 跳過本輪");
      return [];
    }
    const jobs: Promise<SyncResult>[] = [];
    for (const cfg of configs) {
      for (const entity of ["order", "customer", "contact"] as const) {
        // 若該 sheet path 未設 · Connector.pullXxx 會回空陣列 · 不 error · 但仍寫 sync_log（0 筆）
        jobs.push(this.runSync(cfg, entity));
      }
    }
    const settled = await Promise.allSettled(jobs);
    return settled.map((r) => {
      if (r.status === "fulfilled") return r.value;
      // Promise.allSettled 對非 throw 不觸發 · 這裡罕見 · runSync 本身 try/catch
      return {
        tenantSlug: "unknown",
        entity: "order" as const,
        recordsProcessed: 0,
        errors: 1,
        latencyMs: 0,
        error: String(r.reason),
      };
    });
  }
}
