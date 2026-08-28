// LINE 1:1 私訊文案的長度守門 · docs/modules/i18n.md
//
// ⚠️ 為什麼一定要有這支：**LINE 超過字數會整則送不出去，而我們這邊收不到錯誤。**
//    使用者只會發現 bot 突然不回話了，log 裡也沒有東西。
//    2026-08-28 文案改中英雙語，長度直接翻倍 —— 這支就是那次補的。
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOT_MSG } from "../src/line-ingest/bot-messages.js";

// https://developers.line.biz/en/reference/messaging-api/
const LIMIT = {
  templateText: 160,   // buttons template · 無圖無標題
  buttonLabel: 20,     // ← 最緊的一條
  altText: 400,
  textMessage: 5000,
};

/** LINE 算的是 UTF-16 code unit，不是「看起來幾個字」—— emoji 會算 2 */
const len = (s: string) => s.length;

test("⭐⭐ buttons template 的 text 不可超過 160（超過整則送不出去，且無錯誤回報）", () => {
  for (const [key, v] of [["bindText", BOT_MSG.bindText], ["pwText", BOT_MSG.pwText],
                          ["reportText", BOT_MSG.reportText]] as const) {
    assert.ok(len(v) <= LIMIT.templateText,
      `${key} ${len(v)} 字 > ${LIMIT.templateText}：\n${v}`);
  }
});

test("⭐⭐ 按鈕 label 不可超過 20 —— 加英文最容易爆的就是它", () => {
  for (const [key, v] of [["bindLabel", BOT_MSG.bindLabel], ["pwLabel", BOT_MSG.pwLabel],
                          ["reportLabel", BOT_MSG.reportLabel]] as const) {
    assert.ok(len(v) <= LIMIT.buttonLabel,
      `${key} ${len(v)} 字 > ${LIMIT.buttonLabel}：「${v}」`);
  }
});

test("altText 不可超過 400", () => {
  for (const [key, v] of [["bindAlt", BOT_MSG.bindAlt], ["pwAlt", BOT_MSG.pwAlt],
                          ["reportAlt", BOT_MSG.reportAlt]] as const) {
    assert.ok(len(v) <= LIMIT.altText, `${key} ${len(v)} 字 > ${LIMIT.altText}`);
  }
});

test("純文字訊息不可超過 5000（含帶時間的那則）", () => {
  const all = [BOT_MSG.welcome, BOT_MSG.notBound, BOT_MSG.bindFirst, BOT_MSG.ack,
               BOT_MSG.ackFirst("17:30"), BOT_MSG.ackFirst(null)];
  for (const v of all) assert.ok(len(v) <= LIMIT.textMessage, `${len(v)} 字 > ${LIMIT.textMessage}`);
});

test("⭐ 每一則都要中英雙語 —— 只有中文等於這次改動沒生效", () => {
  const all: [string, string][] = [
    ["welcome", BOT_MSG.welcome], ["notBound", BOT_MSG.notBound], ["bindFirst", BOT_MSG.bindFirst],
    ["bindAlt", BOT_MSG.bindAlt], ["bindText", BOT_MSG.bindText], ["bindLabel", BOT_MSG.bindLabel],
    ["pwAlt", BOT_MSG.pwAlt], ["pwText", BOT_MSG.pwText], ["pwLabel", BOT_MSG.pwLabel],
    ["reportAlt", BOT_MSG.reportAlt], ["reportText", BOT_MSG.reportText], ["reportLabel", BOT_MSG.reportLabel],
    ["ack", BOT_MSG.ack], ["ackFirst", BOT_MSG.ackFirst("17:30")],
  ];
  for (const [key, v] of all) {
    assert.ok(/[一-鿿]/.test(v), `${key} 沒有中文`);
    assert.ok(/[A-Za-z]{3,}/.test(v), `${key} 沒有英文：「${v}」`);
  }
});

test("⭐⭐ 批次時間拿不到時，不可以編一個時間出來（R11 禁臆測）", () => {
  const withTime = BOT_MSG.ackFirst("17:30");
  const noTime = BOT_MSG.ackFirst(null);
  assert.ok(withTime.includes("17:30"), "有時間時要講出來");
  assert.ok(!/\d{1,2}:\d{2}/.test(noTime), `拿不到時間卻出現時間字樣：\n${noTime}`);
});

test("盤點：現在各則的長度（改文案時看一眼還剩多少餘裕）", () => {
  const rows: [string, string, number][] = [
    ["bindText", BOT_MSG.bindText, LIMIT.templateText],
    ["pwText", BOT_MSG.pwText, LIMIT.templateText],
    ["reportText", BOT_MSG.reportText, LIMIT.templateText],
    ["bindLabel", BOT_MSG.bindLabel, LIMIT.buttonLabel],
    ["pwLabel", BOT_MSG.pwLabel, LIMIT.buttonLabel],
    ["reportLabel", BOT_MSG.reportLabel, LIMIT.buttonLabel],
  ];
  for (const [k, v, lim] of rows) {
    console.log(`    ${k.padEnd(13)} ${String(len(v)).padStart(3)} / ${lim}   餘裕 ${lim - len(v)}`);
  }
  assert.ok(true);
});
