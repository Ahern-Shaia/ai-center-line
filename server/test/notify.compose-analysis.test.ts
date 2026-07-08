// Unit tests：composeAnalysisSheetMessage 純函數（TB-P01 分析表）
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAnalysisSheetMessage } from "../src/notify/compose/compose-analysis-sheet.js";
import type { AnalysisSheetRecord } from "../src/notify/dto/ragic-analysis-sheet.dto.js";

const baseRec: AnalysisSheetRecord = {
  分析表編號: "AN-2026-0032",
  狀態: "已確認",
  客戶全稱: "喬醫健康事業有限公司",
  聯絡地址: "台北市士林區中正路420號",
  訂購單編號: "OR-2026-0128",
  訂購單日期: "2026/07/07",
  預交日期: "2026/08/15",
  剩餘天數: "38",
  所屬部門: "業務一部",
  課稅類別: "應稅",
  未稅合計: "120000",
  數量合計: "3",
};

test("analysis compose save: 標題【分析表通知｜已更新】(fallback)", () => {
  const msg = composeAnalysisSheetMessage(baseRec, "save");
  assert.match(msg, /^【分析表通知｜已更新】$/m);
});

test("analysis compose button + sheetName: 標題被 sheetName 覆寫", () => {
  const msg = composeAnalysisSheetMessage(baseRec, "button", "TB-P01 分析表");
  assert.match(msg, /^【TB-P01 分析表｜手動發送】$/m);
});

test("analysis compose: 訂購單編號 + 訂購單日期 合併為單行", () => {
  const msg = composeAnalysisSheetMessage(baseRec, "save");
  assert.match(msg, /^訂購單：OR-2026-0128（2026\/07\/07）$/m);
});

test("analysis compose: 預交日期 + 剩餘天數 合併為單行「日期（剩 N 天）」", () => {
  const msg = composeAnalysisSheetMessage(baseRec, "save");
  assert.match(msg, /^預交日期：2026\/08\/15（剩 38 天）$/m);
});

test("analysis compose: 剩餘天數為空 → 只顯示日期不加括號", () => {
  const msg = composeAnalysisSheetMessage({ ...baseRec, 剩餘天數: "" }, "save");
  assert.match(msg, /^預交日期：2026\/08\/15$/m);
});

test("analysis compose: 訂購單日期為空 → 只顯示訂購單編號", () => {
  const msg = composeAnalysisSheetMessage({ ...baseRec, 訂購單日期: "" }, "save");
  assert.match(msg, /^訂購單：OR-2026-0128$/m);
});

test("analysis compose 完整 10 欄業務欄位（含合併行）", () => {
  const msg = composeAnalysisSheetMessage(baseRec, "save", "TB-P01 分析表");
  assert.match(msg, /^分析表編號：AN-2026-0032$/m);
  assert.match(msg, /^狀態：已確認$/m);
  assert.match(msg, /^客戶：喬醫健康事業有限公司$/m);
  assert.match(msg, /^訂購單：OR-2026-0128（2026\/07\/07）$/m);
  assert.match(msg, /^預交日期：2026\/08\/15（剩 38 天）$/m);
  assert.match(msg, /^聯絡地址：台北市士林區中正路420號$/m);
  assert.match(msg, /^所屬部門：業務一部$/m);
  assert.match(msg, /^課稅類別：應稅$/m);
  assert.match(msg, /^未稅合計：120000$/m);
  assert.match(msg, /^數量合計：3$/m);
});

test("analysis compose 帶 recordUrl: 末尾附連結", () => {
  const url = "https://ap16.ragic.com/aitode/order-operation/11/456";
  const msg = composeAnalysisSheetMessage(baseRec, "save", "TB-P01 分析表", url);
  assert.match(msg, /^檢視完整資料：$/m);
  assert.ok(msg.endsWith(url));
});

test("analysis compose 全欄位空 → 全（未填）不炸", () => {
  const partial = { 分析表編號: "X-001" } as AnalysisSheetRecord;
  const msg = composeAnalysisSheetMessage(partial, "save");
  assert.match(msg, /分析表編號：X-001/);
  assert.match(msg, /狀態：（未填）/);
  assert.match(msg, /客戶：（未填）/);
});

test("analysis compose 注入防禦: \\n 折成空白", () => {
  const inj = { ...baseRec, 聯絡地址: "line1\nline2\r\nline3" };
  const msg = composeAnalysisSheetMessage(inj, "save");
  assert.match(msg, /^聯絡地址：line1 line2 line3$/m);
});
