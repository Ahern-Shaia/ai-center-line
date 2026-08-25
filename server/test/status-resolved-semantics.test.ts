// resolved 的判準 · 2026-08-25 台灣福祉「會議記錄有回覆就直接進已簽核」
//
// ⭐⭐ 客戶的描述不精確，但直覺是對的 —— 查下來：
//
//   · `laneFor()` **從來不會**回「已簽核」。自動材料化只會產生
//     待簽核／待確認／存查，已簽核只有人按下去才會有。所以「自動進已簽核」不成立。
//   · 客戶看到的是**存查**（high + resolved → 存查），
//     而存查頁的副標寫著「公告 / 已完成 / 已忽略 · 不需核對的紀錄」—— 讀起來就是做完了。
//   · 根因在 prompt：`resolved = 已解決` 只有這五個字、沒有任何限定。
//     會議記錄裡有人回「收到」，模型判成 resolved 完全講得通。
//
// 這支測試釘住那個限定不被後續改 prompt 時弄丟。
//
// ⚠️ 這裡**只**修「狀態判錯」。客戶真正要的「會議決議各自成一筆待辦」是
//    抽取顆粒度的問題，不是狀態問題 —— 見 docs/modules/twh-feedback-2026-08-24.md OQ-TWH-6。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { laneFor, workStatusFor } from "../src/warroom-task-board/ticket-lane.js";

const prompt = () =>
  readFileSync(new URL("../src/conversation-analysis/pipeline/tenant-twh.ts", import.meta.url), "utf8");

test("⭐⭐ prompt 必須明講「有人回覆不等於事情做完」", () => {
  const src = prompt();
  assert.match(src, /有人回覆不等於事情做完/,
    "少了這句，「收到」「好」「OK」就會被讀成 resolved");
  assert.match(src, /收到/,
    "要把實際會出現的回覆詞列出來 —— 只講抽象原則模型抓不到邊界");
});

test("⭐⭐ 判斷不了要往 open 倒 —— 兩邊的錯誤成本不對稱", () => {
  // 誤填 open：多一次人工核對，成本 30 秒。
  // 誤填 resolved：那件事離開待核對佇列，沒有人會再看到它。
  const src = prompt();
  assert.match(src, /判斷不了就填 open/, "要給明確的預設方向，不能讓模型自己權衡");
});

test("⭐ 會議：「會議開完了」不算 resolved", () => {
  assert.match(prompt(), /會議開完了」不算 resolved/,
    "這是客戶回報的原始情境，prompt 要直接點名");
});

test("⭐ 客戶說的「已簽核」其實是存查 —— 沒有任何自動進已簽核的路徑", () => {
  for (const c of ["high", "medium", "low"] as const) {
    for (const s of ["open", "in_progress", "resolved", "info", null]) {
      assert.notEqual(laneFor(c, s), "已簽核",
        `laneFor(${c}, ${s}) 回了已簽核 —— 簽核只能由人按，材料化不可以代勞`);
    }
  }
  assert.equal(laneFor("high", "resolved"), "存查", "客戶看到的是這個");
});

test("⭐ 誤判 resolved 只影響簽核分區，不會讓它離開追蹤（de8d291 保守版）", () => {
  // 這條說明為什麼這次只需要修 prompt、不用動 work_status：
  // resolved 刻意留在工作生命週期裡，當責人的待辦清單上還看得到。
  assert.equal(workStatusFor("meeting", "resolved"), "open");
  // 反之 info 會直接脫離生命週期 —— 誤判成 info 才是真的消失
  assert.equal(workStatusFor("meeting", "info"), "record");
});
