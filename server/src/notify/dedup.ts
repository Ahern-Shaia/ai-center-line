// 通知去重：同一 sheetPath + recordId 在 windowMs 內只發一次（OQ-NOT-3 A：30 秒）。
// Phase 1 backend 單 replica，記憶體 Map 足夠；多實例改 Redis SETNX（見 §6.2）。
// TTL-based，非嚴格 LRU；空間上限由 maxSize 兜底，超過就清最舊 20%。

export interface DedupCache {
  /** true = 命中窗口內、應跳過；false = 通過、記下這次時間戳 */
  shouldSkip(sheetPath: string, recordId: number, now?: number): boolean;
  size(): number;
}

export class MemoryDedupCache implements DedupCache {
  private readonly entries = new Map<string, number>(); // key -> lastNotifiedAt
  constructor(
    private readonly windowMs = 30_000,
    private readonly maxSize = 10_000,
  ) {}

  shouldSkip(sheetPath: string, recordId: number, now = Date.now()): boolean {
    const key = `${sheetPath}:${recordId}`;
    const prev = this.entries.get(key);
    if (prev != null && now - prev < this.windowMs) return true;

    // 空間 GC：超過 maxSize 就清最舊 20%（Map 保序 = 插入順序）
    if (this.entries.size >= this.maxSize) {
      const dropCount = Math.floor(this.maxSize * 0.2);
      const iter = this.entries.keys();
      for (let i = 0; i < dropCount; i++) {
        const first = iter.next();
        if (first.done) break;
        this.entries.delete(first.value);
      }
    }
    this.entries.set(key, now);
    return false;
  }

  size(): number {
    return this.entries.size;
  }
}
