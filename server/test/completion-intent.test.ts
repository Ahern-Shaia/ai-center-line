// 引用回覆意圖判定 · docs/modules/task-completion-tracking.md §2.2
//
// ⭐ 這支測試的主體是 **prod 真實訊息**（台灣福祉 2026-07-22～28）。
// 用假資料測這個函式沒有意義 —— 它要對付的正是真人講話的方式，
// 而 v2.3 那一輪查驗就是靠這 6 則發現關鍵字誤判率有 33%。
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/task-completion/completion-intent.js";

const SANDY = "U_sandy", WANG = "U_wang", ZHIQUAN = "U_zhiquan", ALLY = "U_ally";

/** 他人回覆（正常情況：指派者發、當責人回） */
const reply = (text: string) =>
  classifyIntent({ text, replierLineUserId: WANG, quotedSenderLineUserId: SANDY });

// ── prod 真實案例 · 6 則 ────────────────────────────────────────────

test("⭐ prod：「鮮湧 10 支產品 BOM已完成（沒有料號的除外）」→ 完成", () => {
  assert.equal(reply("鮮湧 10 支產品 BOM已完成（沒有料號的除外）"), "completion");
});

test("⭐ prod：「後續電話追蹤…該承辦已聯絡上…已完成」→ 完成", () => {
  assert.equal(
    reply("後續電話追蹤\n為本公司產品\n該承辦已聯絡上\n原接洽車輛車商\n已完成"),
    "completion",
  );
});

test("⭐ prod：「已聯絡」→ 完成（短句也算）", () => {
  assert.equal(reply("已聯絡"), "completion");
});

test("⭐ prod：「有幾個半成品的Bom建好了嗎」→ 催問，不是完成", () => {
  // 洪鈺仙引用自己的訊息追進度。純關鍵字會因為「好了」判成完成 —— 那是把還沒做完的關掉。
  assert.equal(
    classifyIntent({
      text: "有幾個半成品的Bom建好了嗎",
      replierLineUserId: SANDY, quotedSenderLineUserId: SANDY,
    }),
    "follow_up",
  );
});

test("⭐ prod：「@郁嫺（Ally) 請問改好了嗎?」→ 催問", () => {
  assert.equal(
    classifyIntent({
      text: "@郁嫺（Ally) 請問改好了嗎?\n另,倉庫層架廠商聽說Sandy有提",
      replierLineUserId: SANDY, quotedSenderLineUserId: SANDY,
    }),
    "follow_up",
  );
});

test("⭐ prod：「這個OK了 NAS部分需要等一下」→ 就地問（部分完成）", () => {
  assert.equal(
    reply("這個OK了　\nNAS部分需要等一下　因為打給春秋沒接電話 應該在騎車"),
    "ask",
  );
});

// ── 兩個過濾器是雙保險，不是重複 ─────────────────────────────────

test("⭐ 疑問句就算不是自己引自己也不判完成", () => {
  // 換成別人來問（例如主管替另一個人追） · 結構規則抓不到，語意規則要接住
  assert.equal(
    classifyIntent({ text: "Bom建好了嗎", replierLineUserId: ALLY, quotedSenderLineUserId: SANDY }),
    "progress",
  );
});

test("⭐ 自己引自己就算講的是陳述句也不動狀態", () => {
  // 指派者自己補一句「已完成」—— 那是他在講別的事，不是當責人的回報
  assert.equal(
    classifyIntent({ text: "已完成", replierLineUserId: SANDY, quotedSenderLineUserId: SANDY }),
    "follow_up",
  );
});

// ── 保守側 ───────────────────────────────────────────────────────

test("⭐ 「快好了」不是「好了」", () => {
  assert.equal(reply("快好了"), "ask");
  assert.equal(reply("差不多好了"), "ask");
  assert.equal(reply("弄好了應該沒問題"), "ask");
});

test("「可以了」刻意不算完成詞", () => {
  // 「可以了」在中文裡常常是**核可**（這樣就行）而不是**做完**，
  // 例如主管看了成品說「可以了」。誤判成完成會把任務關掉，
  // 所以讓它落到 progress —— 少接一筆的代價遠低於誤報一筆。
  assert.equal(reply("應該可以了"), "progress");
  assert.equal(reply("這樣可以了"), "progress");
});

test("⭐ 明確說還沒 → 進度，不用再問", () => {
  assert.equal(reply("還沒好"), "progress");
  assert.equal(reply("尚未處理完"), "progress");
  assert.equal(reply("來不及，明天再弄"), "progress");
});

test("看不出完成語意的一律當進度", () => {
  assert.equal(reply("零件已叫，週四到貨"), "progress");
  assert.equal(reply("我先看一下"), "progress");
  assert.equal(reply(""), "progress");
  assert.equal(reply("收到"), "progress");
});

test("常見的完成講法都要接得住", () => {
  for (const s of ["換好了", "修好了", "弄好了", "裝好了", "搞定", "已處理", "結案了", "OK了"]) {
    assert.equal(reply(s), "completion", `「${s}」應判為完成`);
  }
});

test("身分缺一時退回語意判斷（不能因為缺 id 就漏接）", () => {
  assert.equal(
    classifyIntent({ text: "已完成", replierLineUserId: null, quotedSenderLineUserId: SANDY }),
    "completion",
  );
  assert.equal(
    classifyIntent({ text: "已完成", replierLineUserId: ZHIQUAN, quotedSenderLineUserId: null }),
    "completion",
  );
});
