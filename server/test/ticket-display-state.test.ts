// 四條軸 → 對外一個狀態 · docs/modules/task-completion-tracking.md §4.3
//
// 這支測試盯的不只是邏輯，還有**措辭**：
// 對外一律「尚未確認完成」不用「未完成」。前者說的是系統的認知（永遠為真），
// 後者說的是工作狀態 —— 人做完但還沒回報時它就是假的，他會因此不再信任提醒（F-26）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayState, countsTowardCompletion } from "../src/warroom-task-board/ticket-lane.js";

const base = { workStatus: "open", confirmStatus: "待簽核", assignStatus: "assigned", status: "open" };

test("已結束時顯示結束原因，完成不加括號", () => {
  assert.equal(displayState({ ...base, workStatus: "closed", workOutcome: "完成" }), "已完成");
  assert.equal(displayState({ ...base, workStatus: "closed", workOutcome: "不用做了" }), "已結束（不用做了）");
  assert.equal(displayState({ ...base, workStatus: "closed", workOutcome: "做不到" }), "已結束（做不到）");
});

test("⭐ 工作狀態蓋過其他三軸 —— 還沒簽核也可以先做完", () => {
  // 一件事可以「還沒簽核就先做完」（同仁本來就在做，主管兩天後才簽）
  assert.equal(
    displayState({ ...base, confirmStatus: "待簽核", workStatus: "closed", workOutcome: "完成" }),
    "已完成",
  );
});

test("⭐ AI 判讀完成 ≠ 本人確認 —— 要把落差講出來", () => {
  // 同 ITIL 的 resolved vs closed：技師標 resolved、使用者確認才 closed
  assert.equal(displayState({ ...base, status: "resolved" }), "AI 判讀已完成 · 尚未確認");
});

test("就地問過之後等本人回答", () => {
  assert.equal(displayState({ ...base, workAskedAt: new Date() }), "已詢問 · 待本人確認");
});

test("有回報要跟完全沒動靜分得出來（主管靠這個分辨久懸 vs 有進展）", () => {
  assert.equal(displayState({ ...base, workLastReportAt: new Date() }), "進行中（有回報）");
  assert.equal(displayState(base), "進行中");
});

test("沒指派就是待指派，不是進行中", () => {
  assert.equal(displayState({ ...base, assignStatus: "unclaimed" }), "待指派");
});

test("簽核佇列外的狀態各自顯示", () => {
  assert.equal(displayState({ ...base, confirmStatus: "待確認" }), "待確認是不是任務");
  assert.equal(displayState({ ...base, confirmStatus: "存查" }), "存查");
  assert.equal(displayState({ ...base, confirmStatus: "已忽略" }), "已忽略");
});

test("⭐ 對外措辭不得出現「未完成」（F-26）", () => {
  const all = [
    displayState(base),
    displayState({ ...base, status: "resolved" }),
    displayState({ ...base, workAskedAt: new Date() }),
    displayState({ ...base, assignStatus: "none" }),
    displayState({ ...base, workStatus: "closed", workOutcome: "完成" }),
    displayState({ ...base, confirmStatus: "待確認" }),
  ];
  for (const s of all) {
    assert.ok(!s.includes("未完成"), `「${s}」用了「未完成」—— 人做完但沒回報時這個標籤是假的`);
  }
});

test("⭐ 完成率分母排除「不用做了」，否則取消一堆會被算成做完一堆", () => {
  assert.equal(countsTowardCompletion("完成"), true);
  assert.equal(countsTowardCompletion("做不到"), true, "做不到也是結束，要算進分母");
  assert.equal(countsTowardCompletion("轉他人"), true);
  assert.equal(countsTowardCompletion("不用做了"), false);
});
