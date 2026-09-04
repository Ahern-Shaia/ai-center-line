/**
 * 外勤打卡狀態機 · docs/modules/attendance-trip-state-machine.md §4
 *
 * ⚠️ 這支測的是「按鈕該長什麼樣」與「哪些動作允許」的**唯一依據**。
 * 它錯了不會有人發現 —— 畫面照樣顯示一顆按鈕，只是那顆按鈕是錯的動作，
 * 而人會照按（他信任畫面），於是資料歪掉。所以轉移表要逐格驗，不是抽樣。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveState, allowedActions, primaryAction, isAllowed,
  type PunchType, type TripState,
} from "../src/attendance/trip-state.js";

test("⭐ 狀態由最後一次打卡唯一決定", () => {
  assert.equal(resolveState(null), "not_started");
  assert.equal(resolveState("clock_in"), "moving");
  assert.equal(resolveState("arrive_site"), "at_site");
  assert.equal(resolveState("clock_out"), "ended");
});

test("⭐⭐ depart_site 之後是 moving —— 跟 clock_in 同一個狀態", () => {
  // 這是整個設計的關鍵：離站 = 又在路上了。
  // 若這裡回 at_site，他離站後畫面還是「出發前往下一站」，會連按兩次離站。
  assert.equal(resolveState("depart_site"), "moving");
  assert.deepEqual(allowedActions("moving"), allowedActions(resolveState("depart_site")));
});

test("⭐⭐ 不認得的型別要拋錯，不可以退回 not_started", () => {
  // 退回 not_started 會讓畫面出現「開始外勤」，他一按就多一筆 clock_in，
  // 把本來只是「讀不懂」的狀況變成「資料真的壞了」。
  assert.throws(() => resolveState("wat" as PunchType), /未知的打卡型別/);
});

test("⭐⭐ 主按鈕永遠只有一顆（§4.2）", () => {
  for (const s of ["not_started", "moving", "at_site"] as TripState[]) {
    const p = primaryAction(s);
    assert.ok(p, `${s} 應該要有主按鈕`);
    assert.ok(isAllowed(s, p), `${s} 的主按鈕 ${p} 竟然不在允許清單裡`);
  }
  // ended 是唯一沒有主按鈕的 —— 顯示今日總結，「繼續外勤」是次要位階
  assert.equal(primaryAction("ended"), null);
});

test("⭐⭐ 「今日行程結束」是逃生門 · moving 與 at_site 都摸得到", () => {
  assert.ok(isAllowed("moving", "clock_out"));
  assert.ok(isAllowed("at_site", "clock_out"));
  // 但沒開始不能結束、已結束不能再結束（那會產生兩筆 clock_out）
  assert.ok(!isAllowed("not_started", "clock_out"));
  assert.ok(!isAllowed("ended", "clock_out"));
});

test("⭐ 已結束還能「繼續外勤」（下午又被叫出去是常態）", () => {
  assert.ok(isAllowed("ended", "clock_in"));
  assert.equal(resolveState("clock_in"), "moving");
});

test("⭐⭐ 轉移表逐格驗 —— 每一格都要是刻意的，不是剛好", () => {
  // 完整真值表。改動狀態機時這張表一定要跟著改，
  // 否則「順手放寬一格」不會有任何測試擋下來。
  const EXPECT: Record<TripState, PunchType[]> = {
    not_started: ["clock_in"],
    moving:      ["arrive_site", "clock_out"],
    at_site:     ["depart_site", "clock_out"],
    ended:       ["clock_in"],
  };
  const ALL: PunchType[] = ["clock_in", "arrive_site", "depart_site", "clock_out"];
  for (const [state, allow] of Object.entries(EXPECT) as [TripState, PunchType[]][]) {
    assert.deepEqual(allowedActions(state), allow, `${state} 的允許清單不對`);
    for (const a of ALL) {
      assert.equal(isAllowed(state, a), allow.includes(a), `${state} + ${a} 的判定不對`);
    }
  }
});

test("⭐ 連續兩次同型別打不出來（狀態機本身就擋掉）", () => {
  // 客戶擔心的「連按兩次抵達」（§5-bis.2.2）在單鍵設計下不可能發生：
  // 抵達後狀態是 at_site，而 at_site 不允許 arrive_site。
  assert.ok(!isAllowed(resolveState("arrive_site"), "arrive_site"));
  assert.ok(!isAllowed(resolveState("depart_site"), "depart_site"));
  assert.ok(!isAllowed(resolveState("clock_in"), "clock_in"));
});
