// Unit tests: computeNextRetry · pure exponential backoff 計算
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeNextRetry,
  MAX_ATTEMPTS,
  BASE_BACKOFF_MS,
  BACKOFF_MULTIPLIER,
} from "../src/data-sync-layer/writeback.service.js";

const NOW = 1_700_000_000_000; // fixed epoch ms · 2023-11-14 22:13:20 UTC

test("backoff: attempts=0 → 30s 後重試（第一次失敗）", () => {
  const r = computeNextRetry(0, NOW);
  assert.notEqual(r, null);
  assert.equal(r!.getTime() - NOW, BASE_BACKOFF_MS); // 30_000
});

test("backoff: attempts=1 → 60s 後重試（倍增）", () => {
  const r = computeNextRetry(1, NOW);
  assert.equal(r!.getTime() - NOW, BASE_BACKOFF_MS * BACKOFF_MULTIPLIER); // 60_000
});

test("backoff: attempts=3 → 240s = 4 分鐘後（30 × 2^3 = 240）", () => {
  const r = computeNextRetry(3, NOW);
  assert.equal(r!.getTime() - NOW, BASE_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, 3));
});

test("backoff: attempts=MAX-1（=4）→ 下次應為第 5 次 · 達上限 · null", () => {
  const r = computeNextRetry(MAX_ATTEMPTS - 1, NOW);
  assert.equal(r, null);
});

test("backoff: attempts 已 >= MAX → 仍 null（永遠 failed）", () => {
  const r = computeNextRetry(10, NOW);
  assert.equal(r, null);
});

test("backoff: 常量對齊 doc（30s base · 2× multiplier · max 5 次）", () => {
  assert.equal(BASE_BACKOFF_MS, 30_000);
  assert.equal(BACKOFF_MULTIPLIER, 2);
  assert.equal(MAX_ATTEMPTS, 5);
});
