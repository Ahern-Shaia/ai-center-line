// Unit tests：MemoryDedupCache — 用手動注入 now 避免真的 sleep。
// M2 起 key 加 tenant prefix，避免不同 tenant 誤 dedup。
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryDedupCache } from "../src/notify/dedup.js";

test("dedup: 第一次呼叫 → 不跳過", () => {
  const cache = new MemoryDedupCache(30_000);
  assert.equal(cache.shouldSkip("twh", "/x/1", 100, 1_000_000), false);
});

test("dedup: 30 秒窗內同 key → 跳過", () => {
  const cache = new MemoryDedupCache(30_000);
  cache.shouldSkip("twh", "/x/1", 100, 1_000_000);
  assert.equal(cache.shouldSkip("twh", "/x/1", 100, 1_000_000 + 29_999), true);
});

test("dedup: 剛好 30 秒後 → 不跳過（窗外）", () => {
  const cache = new MemoryDedupCache(30_000);
  cache.shouldSkip("twh", "/x/1", 100, 1_000_000);
  assert.equal(cache.shouldSkip("twh", "/x/1", 100, 1_000_000 + 30_000), false);
});

test("dedup: 不同 sheetPath 或 recordId → 各自獨立", () => {
  const cache = new MemoryDedupCache(30_000);
  cache.shouldSkip("twh", "/x/1", 100, 1_000_000);
  assert.equal(cache.shouldSkip("twh", "/x/2", 100, 1_000_000 + 100), false); // 不同 sheet
  assert.equal(cache.shouldSkip("twh", "/x/1", 101, 1_000_000 + 100), false); // 不同 recordId
});

test("dedup: 不同 tenant 同 sheetPath+recordId → 不 dedup（cross-tenant 隔離）", () => {
  const cache = new MemoryDedupCache(30_000);
  cache.shouldSkip("twh", "/x/1", 100, 1_000_000);
  assert.equal(cache.shouldSkip("xianyong", "/x/1", 100, 1_000_000 + 100), false);
});

test("dedup: maxSize 觸發時清最舊 20%，仍能繼續運作", () => {
  const cache = new MemoryDedupCache(30_000, 100);
  // 灌 100 筆到 maxSize；再灌第 101 筆 → 觸發 GC
  for (let i = 0; i < 100; i++) cache.shouldSkip("twh", "/x/" + i, 1, 1_000_000 + i);
  assert.equal(cache.size(), 100);
  cache.shouldSkip("twh", "/x/999", 1, 2_000_000);
  // GC 清 20 筆 + 加新 1 筆 = 81
  assert.equal(cache.size(), 81);
});
