import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { db, withTenant } from "../db/client.js";
import { DataSyncRepository, type WritebackInput, type WritebackItem } from "./data-sync.repository.js";
import { DataSyncTenantRegistry } from "./tenant-config.js";

// Writeback queue · Ragic 斷線緩衝
// 對應 docs/modules/data-sync-layer.md v0.2 §6
// Pilot 用 DB polling（BullMQ 是 OQ-DSL-3 裁定但 pilot 單 replica 過度 · 未來 SaaS scaling 再切）
// 每 30 秒 poll pending 項目 · 呼 Connector push · 成功 → synced · 失敗 → attempts++ · 5 次 → failed

const POLL_INTERVAL_MS = 30_000;
export const MAX_ATTEMPTS = 5;
export const BASE_BACKOFF_MS = 30_000;                 // 30s / 60s / 2m / 4m / 8m
export const BACKOFF_MULTIPLIER = 2;
const BATCH_SIZE = 20;

/**
 * 計算下次重試時間 · exponential backoff。回 null 表示已達 MAX_ATTEMPTS · status 該落 failed。
 * Pure function · 純算 · 可 unit test。
 */
export function computeNextRetry(currentAttempts: number, now: number): Date | null {
  const nextAttempts = currentAttempts + 1;
  if (nextAttempts >= MAX_ATTEMPTS) return null;
  return new Date(now + BASE_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, currentAttempts));
}

@Injectable()
export class WritebackService implements OnModuleInit {
  private readonly logger = new Logger(WritebackService.name);
  private readonly workerEnabled: boolean;
  private timer: NodeJS.Timeout | null = null;
  // Notify worker 用 · 記錄 sync fn 給下游 module 註冊
  // Pilot 版：writeback 只提供 API · 實際 push 由 connector 未來實作（M6+）
  // 現階段：worker 執行 pending items 但**只做「假 flush」到 sync 狀態 · log warn**
  private syncFn: ((item: WritebackItem) => Promise<void>) | null = null;

  constructor(
    private readonly repo: DataSyncRepository,
    // registry 目前未用 · 為未來 per-tenant connector.push 保留
    private readonly _registry: DataSyncTenantRegistry,
  ) {
    this.workerEnabled = (process.env.DSL_WRITEBACK_WORKER_ENABLED ?? "true").toLowerCase() !== "false";
  }

  onModuleInit(): void {
    if (!this.workerEnabled) {
      this.logger.log("DSL_WRITEBACK_WORKER_ENABLED=false · worker 未啟動");
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((e) =>
        this.logger.error(`writeback tick uncaught: ${String((e as Error).message ?? e)}`),
      );
    }, POLL_INTERVAL_MS);
    this.logger.log(`writeback worker 啟動 · poll interval ${POLL_INTERVAL_MS}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 註冊 push 執行邏輯 · connector push 實作後才 wire */
  setSyncFn(fn: (item: WritebackItem) => Promise<void>): void {
    this.syncFn = fn;
  }

  // Enqueue · 上層 service 呼（若 Ragic 直寫失敗）
  async enqueue(input: WritebackInput): Promise<number> {
    // 用 withTenant 帶 tenant · RLS 隔離
    let id = 0;
    await withTenant({ tenantId: input.tenantId, role: "aiproot_admin" }, async (tx) => {
      id = await this.repo.enqueueWriteback(tx, input);
    });
    this.logger.log(`writeback enqueued · id=${id} tenant=${input.tenantId} entity=${input.entity}`);
    return id;
  }

  // Worker tick · 取 pending 到期的 · 逐項 sync
  async tick(): Promise<{ processed: number; synced: number; failed: number }> {
    // 用 raw db 跨 tenant · 掃全部 pending
    const items = await this.repo.getPendingWritebacks(db, BATCH_SIZE);
    if (!items.length) return { processed: 0, synced: 0, failed: 0 };

    this.logger.log(`writeback worker · ${items.length} 個 pending items`);
    let synced = 0;
    let failed = 0;

    for (const item of items) {
      try {
        if (!this.syncFn) {
          // Pilot 現況 · connector push 未實作 · 只 log 不 dequeue
          this.logger.warn(`writeback item ${item.id} skip · syncFn 未註冊（pilot 階段正常）`);
          continue;
        }
        await this.syncFn(item);
        await this.repo.markWritebackSynced(db, item.id);
        synced++;
      } catch (e) {
        const errorMessage = String((e as Error).message ?? e);
        const nextRetryAt = computeNextRetry(item.attempts, Date.now());
        await this.repo.markWritebackFailed(db, item.id, errorMessage, nextRetryAt);
        if (!nextRetryAt) {
          this.logger.error(
            `writeback item ${item.id} FAILED after ${item.attempts + 1} attempts · ${errorMessage}`,
          );
        }
        failed++;
      }
    }

    return { processed: items.length, synced, failed };
  }
}
