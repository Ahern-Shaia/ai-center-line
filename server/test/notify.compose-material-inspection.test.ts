// Unit tests：composeMaterialInspectionMessage 純函數（鮮勇原料驗貨單 · 上游-4a）
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeMaterialInspectionMessage } from "../src/notify/compose/compose-material-inspection.js";
import type { MaterialInspectionRecord } from "../src/notify/dto/ragic-material-inspection.dto.js";

const baseRec: MaterialInspectionRecord = {
  品項名稱: "紅蘿蔔",
  品編: "M-0128",
  批號: "LOT-20260717-A",
  收貨數量: "500",
  數量: "498",
  單位: "kg",
  製造有效日期: "2026/07/15 / 2027/01/15",
  檢驗完成: "合格",
};

test("material compose save: 標題【原料驗貨單通知｜檢驗完成】(fallback、save 語意=檢驗完成)", () => {
  const msg = composeMaterialInspectionMessage(baseRec, "save");
  assert.match(msg, /^【原料驗貨單通知｜檢驗完成】$/m);
});

test("material compose button + sheetName: 標題被 sheetName 覆寫、trigger label 手動發送", () => {
  const msg = composeMaterialInspectionMessage(baseRec, "button", "鮮勇原料驗貨單");
  assert.match(msg, /^【鮮勇原料驗貨單｜手動發送】$/m);
});

test("material compose: 品項＋品編 合併「品項（品編）」", () => {
  const msg = composeMaterialInspectionMessage(baseRec, "save");
  assert.match(msg, /^品項：紅蘿蔔（M-0128）$/m);
});

test("material compose: 收貨/實收 有落差 → 顯示「收貨 500 kg、實收 498 kg」", () => {
  const msg = composeMaterialInspectionMessage(baseRec, "save");
  assert.match(msg, /^數量：收貨 500 kg、實收 498 kg$/m);
});

test("material compose: 實收未填 → 只顯示收貨數量帶單位", () => {
  const msg = composeMaterialInspectionMessage({ ...baseRec, 數量: "" }, "save");
  assert.match(msg, /^數量：500 kg$/m);
});

test("material compose: 單位未填 → 數字後不加單位", () => {
  const msg = composeMaterialInspectionMessage({ ...baseRec, 單位: "" }, "save");
  assert.match(msg, /^數量：收貨 500、實收 498$/m);
});

test("material compose: 品編未填 → 只顯示品項名稱不加括號", () => {
  const msg = composeMaterialInspectionMessage({ ...baseRec, 品編: "" }, "save");
  assert.match(msg, /^品項：紅蘿蔔$/m);
});

test("material compose 完整 6 行業務欄位（含合併行）", () => {
  const msg = composeMaterialInspectionMessage(baseRec, "save", "鮮勇原料驗貨單");
  assert.match(msg, /^品項：紅蘿蔔（M-0128）$/m);
  assert.match(msg, /^批號：LOT-20260717-A$/m);
  assert.match(msg, /^數量：收貨 500 kg、實收 498 kg$/m);
  assert.match(msg, /^製造\/有效日期：2026\/07\/15 \/ 2027\/01\/15$/m);
  assert.match(msg, /^檢驗結果：合格$/m);
});

test("material compose 帶 recordUrl → 末尾附連結", () => {
  const url = "https://ap16.ragic.com/freshfruits/material-inspection/4/456";
  const msg = composeMaterialInspectionMessage(baseRec, "save", "鮮勇原料驗貨單", url);
  assert.match(msg, /^檢視完整資料：$/m);
  assert.ok(msg.endsWith(url));
});

test("material compose 全欄位空 → 全（未填）不炸", () => {
  const partial = { 品項名稱: "紅蘿蔔" } as MaterialInspectionRecord;
  const msg = composeMaterialInspectionMessage(partial, "save");
  assert.match(msg, /品項：紅蘿蔔/);
  assert.match(msg, /批號：（未填）/);
  assert.match(msg, /檢驗結果：（未填）/);
});

test("material compose 注入防禦: \\n 折成空白", () => {
  const inj = { ...baseRec, 品項名稱: "line1\nline2\r\nline3" };
  const msg = composeMaterialInspectionMessage(inj, "save");
  assert.match(msg, /^品項：line1 line2 line3（M-0128）$/m);
});
