// notify v2 · 動態 composer 純函式測試
// 對照 docs/modules/notify-selfserve-platform.md M1
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeFromConfig } from "../src/notify-config/dynamic-composer.js";
import { parseRagicWebhook } from "../src/notify-config/ragic-webhook.parser.js";

const fields = [
  { fieldId: 1001, label: "單據編號", order: 0 },
  { fieldId: 1002, label: "狀態", order: 1 },
  { fieldId: 1003, label: "客戶", order: 2 },
];

test("composer · 逐行欄位:值 + 標題 + 連結 · UPDATE", () => {
  const msg = composeFromConfig({
    title: "維修保養單",
    eventType: "UPDATE",
    fields,
    record: { "1001": "TB-0001", "1002": "已確認", "1003": "示範客戶" },
    recordUrl: "https://ap16.ragic.com/aitode/service-tickets/10/41",
  });
  assert.match(msg, /^【維修保養單｜已更新】/);
  assert.ok(msg.includes("單據編號：TB-0001"));
  assert.ok(msg.includes("狀態：已確認"));
  assert.ok(msg.includes("客戶：示範客戶"));
  assert.ok(msg.includes("檢視完整資料："));
  assert.ok(msg.includes("https://ap16.ragic.com/aitode/service-tickets/10/41"));
});

test("composer · 缺值 → （未填）", () => {
  const msg = composeFromConfig({
    title: "分析表",
    eventType: "CREATE",
    fields,
    record: { "1001": "AN-9", "1002": "", "1003": null },
  });
  assert.match(msg, /^【分析表｜已新增】/);
  assert.ok(msg.includes("狀態：（未填）"));
  assert.ok(msg.includes("客戶：（未填）"));
});

test("composer · 欄位依 order 排序（亂序輸入）", () => {
  const shuffled = [
    { fieldId: 1003, label: "客戶", order: 2 },
    { fieldId: 1001, label: "單據編號", order: 0 },
    { fieldId: 1002, label: "狀態", order: 1 },
  ];
  const msg = composeFromConfig({ title: "T", eventType: "UPDATE", fields: shuffled, record: { "1001": "A", "1002": "B", "1003": "C" } });
  const lines = msg.split("\n");
  assert.equal(lines[1], "單據編號：A");
  assert.equal(lines[2], "狀態：B");
  assert.equal(lines[3], "客戶：C");
});

test("composer · DELETE label + 無 recordUrl 不加連結", () => {
  const msg = composeFromConfig({ title: "單", eventType: "DELETE", fields: [fields[0]], record: { "1001": "X" } });
  assert.match(msg, /^【單｜已刪除】/);
  assert.ok(!msg.includes("檢視完整資料"));
});

test("composer · title 空 → （未填）保底", () => {
  const msg = composeFromConfig({ title: "", eventType: "UPDATE", fields: [], record: {} });
  assert.ok(msg.startsWith("【（未填）｜已更新】"));
});

test("webhook parser · 完整模式（data 物件 + _ragicId）", () => {
  const p = parseRagicWebhook({
    eventType: "UPDATE",
    apname: "aitode", path: "/service-tickets/10", sheetIndex: 10,
    data: [{ _ragicId: 41, "1001": "TB-0001" }],
  });
  assert.equal(p.eventType, "UPDATE");
  assert.equal(p.recordId, 41);
  assert.equal(p.recordData["1001"], "TB-0001");
});

test("webhook parser · 精簡模式（data 為 id 陣列）", () => {
  const p = parseRagicWebhook({ eventType: "CREATE", data: [7, 8, 9] });
  assert.equal(p.eventType, "CREATE");
  assert.equal(p.recordId, 7);
  assert.deepEqual(p.recordData, {});
});

test("webhook parser · eventType 缺 → 預設 UPDATE · recordId 取不到 → null", () => {
  const p = parseRagicWebhook({ data: [] });
  assert.equal(p.eventType, "UPDATE");
  assert.equal(p.recordId, null);
});

test("webhook parser · DELETE + top-level recordId", () => {
  const p = parseRagicWebhook({ eventType: "DELETE", recordId: 55, data: [] });
  assert.equal(p.eventType, "DELETE");
  assert.equal(p.recordId, 55);
});
