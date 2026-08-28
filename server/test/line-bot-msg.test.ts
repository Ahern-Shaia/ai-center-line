// LINE 1:1 私訊文案的長度守門 · docs/modules/i18n.md
//
// ⚠️ 為什麼一定要有這支：**LINE 超過字數會整則送不出去，而我們這邊收不到錯誤。**
//    使用者只會發現 bot 突然不回話了，log 裡也沒有東西。
//    2026-08-28 文案改中英雙語，長度直接翻倍 —— 這支就是那次補的。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// ─────────────────────────────────────────────────────────────
// 2026-08-28 實機回報的兩個問題
// ─────────────────────────────────────────────────────────────

test("⭐⭐ 外籍員工打得出來的關鍵字要能觸發日報（實機：傳 report 沒反應）", async () => {
  const { isDailyReportKeyword } = await import("../src/line-ingest/line-webhook.service.js");
  // 中文
  for (const k of ["日報", "我的日報", "看日報", "查日報", "報告", "查看"]) {
    assert.ok(isDailyReportKeyword(k), `「${k}」應該要觸發`);
  }
  // 英文 —— report / my report 是 2026-08-28 補的
  for (const k of ["report", "Report", "REPORT", " report ", "my report", "My Report", "daily", "daily report"]) {
    assert.ok(isDailyReportKeyword(k), `"${k}" 應該要觸發（外籍員工打不出中文）`);
  }
});

test("⭐⭐ 但不可以把真的工作訊息吃掉 —— 比對是整則相等，不是 includes", () => {
  return import("../src/line-ingest/line-webhook.service.js").then(({ isDailyReportKeyword }) => {
    // 這些是**真的工作回報**，被當成關鍵字的話那則訊息就不會被記錄下來
    for (const k of ["今天去 A 廠 report 已交", "report 給客戶了", "日報寫好了", "已經看日報了", "daily meeting 10:00"]) {
      assert.ok(!isDailyReportKeyword(k), `「${k}」是工作訊息，不該被當成關鍵字`);
    }
  });
});

test("⭐⭐ bot 的英文提示不可以叫人打中文關鍵字", async () => {
  const { isDailyReportKeyword } = await import("../src/line-ingest/line-webhook.service.js");
  const en = BOT_MSG.ackFirst("17:30").split("\n").filter((l) => /[A-Za-z]{4,}/.test(l)).join(" ");
  // 從英文句子裡把引號包住的關鍵字抓出來，確認它真的觸發得了
  const quoted = [...en.matchAll(/["「]([^"」]{2,20})["」]/g)].map((m) => m[1]);
  assert.ok(quoted.length > 0, `英文提示裡沒有指出關鍵字：\n${en}`);
  for (const q of quoted) {
    assert.ok(isDailyReportKeyword(q),
      `英文提示叫使用者傳「${q}」，但 isDailyReportKeyword 不認它 —— 叫人做一件做不到的事`);
    assert.ok(!/[一-鿿]/.test(q),
      `英文提示叫使用者傳中文「${q}」—— 那是叫不會打中文的人去打中文`);
  }
});

test("⭐⭐ LIFF 的 PHASE_TITLE 是 i18n key，document.title 必須包 tr()", () => {
  // 2026-08-28 實機踩到：LINE 的標題列直接顯示「liff.punch」給員工看。
  // tsc 擋不住（兩邊都是 string），而且中英文都壞。
  const src = readFileSync(fileURLToPath(new URL("../../web/src/liff/main.tsx", import.meta.url)), "utf8");
  assert.ok(!/document\.title\s*=\s*[a-z]\w*\s*;/.test(src),
    "document.title 直接吃 PHASE_TITLE 的值 —— 那是 key 不是文字，會把 liff.punch 印在標題列");
  assert.ok(/document\.title\s*=\s*tr\(/.test(src), "document.title 要走 tr()");
});
