// Unit tests：composeQuotationMessage 純函數（鮮勇報價單 · 下游-1）
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeQuotationMessage } from "../src/notify/compose/compose-quotation.js";
import type { QuotationRecord } from "../src/notify/dto/ragic-quotation.dto.js";

const baseRec: QuotationRecord = {
  報價單號: "QT-2026-0001",
  單據狀態: "已核可",
  日期狀態: "",
  Approval_status: "Approved",
  客戶名稱: "XX 有限公司",
  報價單日期: "2026/07/17",
  報價有效日期: "2026/08/17",
  承辦人員: "王〇〇",
  簽核人: "張〇〇",
  簽核開始的日期時間: "",
  簽核結束的日期時間: "",
  送出簽核人: "",
  送出簽核人姓名: "",
  下載: "",
};

test("quotation compose save: 標題【報價單通知｜已更新】(fallback)", () => {
  const msg = composeQuotationMessage(baseRec, "save");
  assert.match(msg, /^【報價單通知｜已更新】$/m);
});

test("quotation compose button + sheetName: 標題被 sheetName 覆寫、trigger label 手動發送", () => {
  const msg = composeQuotationMessage(baseRec, "button", "鮮勇報價單");
  assert.match(msg, /^【鮮勇報價單｜手動發送】$/m);
});

test("quotation compose: 8 個業務欄位齊全、狀態合併（單據狀態＋Approval）", () => {
  const msg = composeQuotationMessage(baseRec, "save", "鮮勇報價單");
  assert.match(msg, /^報價單號：QT-2026-0001$/m);
  assert.match(msg, /^狀態：已核可（Approval: Approved）$/m);
  assert.match(msg, /^客戶：XX 有限公司$/m);
  assert.match(msg, /^報價日期：2026\/07\/17$/m);
  assert.match(msg, /^有效日期：2026\/08\/17$/m);
  assert.match(msg, /^承辦：王〇〇$/m);
  assert.match(msg, /^簽核：張〇〇$/m);
});

test("quotation compose: Approval status 空 → 狀態只顯示單據狀態不加括號", () => {
  const msg = composeQuotationMessage({ ...baseRec, Approval_status: "" }, "save");
  assert.match(msg, /^狀態：已核可$/m);
});

test("quotation compose: 帶 recordUrl → 末尾附連結", () => {
  const url = "https://ap16.ragic.com/freshfruits/quotation/6/123";
  const msg = composeQuotationMessage(baseRec, "save", "鮮勇報價單", url);
  assert.match(msg, /^檢視完整資料：$/m);
  assert.ok(msg.endsWith(url));
});

test("quotation compose 全空 → 全（未填）不炸", () => {
  const partial = { 報價單號: "QT-X-001" } as QuotationRecord;
  const msg = composeQuotationMessage(partial, "save");
  assert.match(msg, /報價單號：QT-X-001/);
  assert.match(msg, /狀態：（未填）/);
  assert.match(msg, /客戶：（未填）/);
  assert.match(msg, /報價日期：（未填）/);
});

test("quotation compose 注入防禦: \\n 折成空白", () => {
  const inj = { ...baseRec, 客戶名稱: "line1\nline2\r\nline3" };
  const msg = composeQuotationMessage(inj, "save");
  assert.match(msg, /^客戶：line1 line2 line3$/m);
});

test("quotation compose: 未擇要的欄位（簽核開始／送出簽核人等）不出現在輸出", () => {
  const rec: QuotationRecord = {
    ...baseRec,
    簽核開始的日期時間: "2026/07/16 09:00",
    簽核結束的日期時間: "2026/07/17 15:30",
    送出簽核人: "SUBMIT-USER",
    送出簽核人姓名: "李〇〇",
    日期狀態: "有效",
    下載: "https://download.example.com/file.pdf",
  };
  const msg = composeQuotationMessage(rec, "save");
  // 這些欄位不該出現（DTO 收但 compose 不輸出）
  assert.doesNotMatch(msg, /簽核開始/);
  assert.doesNotMatch(msg, /簽核結束/);
  assert.doesNotMatch(msg, /送出簽核人/);
  assert.doesNotMatch(msg, /日期狀態/);
  assert.doesNotMatch(msg, /下載/);
  assert.doesNotMatch(msg, /download\.example\.com/);
});
