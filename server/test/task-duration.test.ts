/**
 * 任務時間 · 抵達與離開配對 · docs/modules/attendance-trip-state-machine.md §5-bis
 *
 * ⚠️⚠️ 這支的重點不是「算得對」，是**「算不出來的時候不要瞎掰」**。
 * 出勤與工時會被拿來計酬與稽核 —— 推估一個看起來合理的數字，
 * 比留白危險得多，因為沒有人會去查一個長得很正常的數字（F-12 · P0）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pairStays, summarizeStays, type PunchPoint } from "../src/attendance/task-duration.js";
import type { PunchType } from "../src/attendance/trip-state.js";

const T0 = Date.parse("2026-09-04T09:00:00+08:00");
const min = (n: number) => T0 + n * 60_000;

let n = 0;
const p = (type: PunchType, atMs: number, place: string | null = null): PunchPoint =>
  ({ punchId: `p${++n}`, punchType: type, atMs, customerName: place });

test("⭐ 一趟完整的停留 —— 客戶要的「第一趟任務時間」", () => {
  const stays = pairStays([
    p("clock_in", min(0)),
    p("arrive_site", min(30), "嘉義長青園"),
    p("depart_site", min(95)),
  ]);
  assert.equal(stays.length, 1);
  assert.equal(stays[0].seq, 1);
  assert.equal(stays[0].place, "嘉義長青園");
  assert.equal(stays[0].minutes, 65);
});

test("⭐ 多趟各自獨立計算", () => {
  const stays = pairStays([
    p("clock_in", min(0)),
    p("arrive_site", min(30), "A"), p("depart_site", min(90)),
    p("arrive_site", min(120), "B"), p("depart_site", min(150)),
  ]);
  assert.deepEqual(stays.map((s) => [s.seq, s.place, s.minutes]), [[1, "A", 60], [2, "B", 30]]);
});

test("⭐⭐ 漏打離開 → minutes 是 null，**不是 0、也不推估**", () => {
  // 這是 OQ-TDP-7 的丙案（用下一次抵達當這一站的離開時間）—— 已裁定不採。
  const stays = pairStays([
    p("clock_in", min(0)),
    p("arrive_site", min(30), "A"),          // ← 忘了按離開
    p("arrive_site", min(120), "B"),
    p("depart_site", min(150)),
  ]);
  assert.equal(stays[0].minutes, null, "拿下一次抵達推估了 A 的離開時間 —— 那是造假");
  assert.equal(stays[0].departPunchId, null);
  assert.equal(stays[1].minutes, 30, "B 是完整的，不該被 A 的缺漏影響");
});

test("⭐⭐ 在客戶端直接收班 · clock_out 也算離開", () => {
  // 很常見：最後一站做完就直接回家，不會再按一次「離開」
  const stays = pairStays([
    p("clock_in", min(0)),
    p("arrive_site", min(30), "A"),
    p("clock_out", min(100)),
  ]);
  assert.equal(stays[0].minutes, 70);
});

test("⭐ 還在站上（今天還沒離開）→ null，等他離開才有數字", () => {
  const stays = pairStays([p("clock_in", min(0)), p("arrive_site", min(30), "A")]);
  assert.equal(stays[0].minutes, null);
  assert.equal(stays[0].departAtMs, null);
});

test("⭐⭐ 時間倒退（資料本身有問題）→ null，不顯示負分鐘", () => {
  const stays = pairStays([
    p("arrive_site", min(60), "A"),
    p("depart_site", min(10)),
  ]);
  assert.equal(stays[0].minutes, null, "算出負的分鐘數會被當成真的顯示出去");
});

test("⭐⭐ 合計只加完整的那幾趟，而且一定要回報有幾趟不完整", () => {
  const stays = pairStays([
    p("clock_in", min(0)),
    p("arrive_site", min(30), "A"), p("depart_site", min(90)),   // 60
    p("arrive_site", min(120), "B"),                              // 漏打
    p("arrive_site", min(200), "C"), p("depart_site", min(230)),  // 30
  ]);
  const s = summarizeStays(stays);
  assert.equal(s.totalMinutes, 90);
  assert.equal(s.completed, 2);
  // ⚠️ 沒有這個數字的話，「今日 1 小時 30 分」會被當成全部 —— 使用者不會知道少算了
  assert.equal(s.incomplete, 1);
});

test("⭐ 完全沒有到點打卡 → 沒有任何一趟（不是 0 分鐘的一趟）", () => {
  assert.deepEqual(pairStays([p("clock_in", min(0)), p("clock_out", min(300))]), []);
  assert.deepEqual(summarizeStays([]), { totalMinutes: 0, completed: 0, incomplete: 0 });
});

test("⭐ 離站後又出發（depart → clock_in）不會被算成停留", () => {
  const stays = pairStays([
    p("arrive_site", min(30), "A"), p("depart_site", min(60)),
    p("clock_in", min(70)),                   // 中途重新開始（ended → 繼續外勤）
    p("arrive_site", min(100), "B"), p("depart_site", min(130)),
  ]);
  assert.deepEqual(stays.map((s) => s.minutes), [30, 30]);
});
