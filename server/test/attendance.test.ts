// 定位打卡 M1 · 反作弊旗標 + haversine 純函式測試（不需 DB）
// 對照 docs/modules/attendance-location-mileage.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSuspicious } from "../src/attendance/attendance.service.js";
import { haversineMeters } from "../src/attendance/routing-provider.js";

const now = 1_800_000_000_000; // 固定時間戳（不用 Date.now，測試可重現）

test("haversine · 赤道 1 經度 ≈ 111 km", () => {
  const m = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  assert.ok(Math.abs(m - 111_195) < 500, `實際 ${m}`);
});

test("反作弊 · 精度佳 + 合理速度 → 無旗標", () => {
  const prev = { punchId: "p", lat: 25.03, lng: 121.56, punchedAtMs: now - 30 * 60_000 }; // 30 分前
  // 台北市內移動約 3km · 30 分 → 6 km/h
  const flags = computeSuspicious(prev, { lat: 25.05, lng: 121.57, accuracyM: 15 }, now);
  assert.equal(flags, null);
});

test("反作弊 · GPS 精度過大 → low_accuracy_m", () => {
  const flags = computeSuspicious(null, { lat: 25.03, lng: 121.56, accuracyM: 350 }, now);
  assert.deepEqual(flags, { low_accuracy_m: 350 });
});

test("反作弊 · 不合理速度（台北→台中 10 分鐘）→ impossible_speed_kmh", () => {
  const prev = { punchId: "p", lat: 25.03, lng: 121.56, punchedAtMs: now - 10 * 60_000 }; // 10 分前
  const flags = computeSuspicious(prev, { lat: 24.14, lng: 120.68, accuracyM: 12 }, now);
  assert.ok(flags && flags.impossible_speed_kmh > 150, `flags=${JSON.stringify(flags)}`);
});

test("反作弊 · 無前一點 → 只檢查精度（此處精度佳）→ null", () => {
  const flags = computeSuspicious(null, { lat: 25.03, lng: 121.56, accuracyM: 10 }, now);
  assert.equal(flags, null);
});
