// 通知中心 v3 · 模板渲染 / 規則過濾 / Ragic webhook 解析（純函式）
// 對照 docs/modules/notification-hub.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { getByPath, matchFilters, renderTemplate } from "../src/notification-hub/template.renderer.js";
import { parseRagicWebhook } from "../src/notify-config/ragic-webhook.parser.js";

const template = {
  title: "維修保養單",
  items: [
    { path: "1001", label: "單據編號", order: 0 },
    { path: "1002", label: "狀態", order: 1 },
    { path: "1003", label: "客戶", order: 2 },
  ],
};

test("renderer · 逐行欄位:值 + 標題 + 連結", () => {
  const msg = renderTemplate(template, { "1001": "TB-0001", "1002": "已確認", "1003": "示範客戶" }, "已更新",
    "https://ap16.ragic.com/aitode/service-tickets/10/41");
  assert.match(msg, /^【維修保養單｜已更新】/);
  assert.ok(msg.includes("單據編號：TB-0001"));
  assert.ok(msg.includes("狀態：已確認"));
  assert.ok(msg.includes("檢視完整資料："));
});

test("renderer · 缺值 → （未填）", () => {
  const msg = renderTemplate(template, { "1001": "AN-9", "1002": "", "1003": null }, "已新增");
  assert.ok(msg.includes("狀態：（未填）"));
  assert.ok(msg.includes("客戶：（未填）"));
});

test("renderer · 依 order 排序（亂序輸入）", () => {
  const shuffled = { title: "T", items: [template.items[2], template.items[0], template.items[1]] };
  const msg = renderTemplate(shuffled, { "1001": "A", "1002": "B", "1003": "C" }, "已更新");
  const lines = msg.split("\n");
  assert.equal(lines[1], "單據編號：A");
  assert.equal(lines[2], "狀態：B");
  assert.equal(lines[3], "客戶：C");
});

test("renderer · 標題與事件標籤相同 → 不重複顯示", () => {
  const msg = renderTemplate({ title: "外勤打卡異常", items: [] }, {}, "外勤打卡異常");
  assert.equal(msg.split("\n")[0], "【外勤打卡異常】");
});

test("renderer · 無連結不加尾段", () => {
  const msg = renderTemplate({ title: "單", items: [template.items[0]] }, { "1001": "X" }, "已刪除");
  assert.match(msg, /^【單｜已刪除】/);
  assert.ok(!msg.includes("檢視完整資料"));
});

test("getByPath · Ragic 數字欄位 id 與 dot-path 皆可取值", () => {
  assert.equal(getByPath({ "1031954": "TB-1" }, "1031954"), "TB-1");
  assert.equal(getByPath({ trip: { distanceKm: 12.5 } }, "trip.distanceKm"), 12.5);
  assert.equal(getByPath({ a: {} }, "a.b.c"), undefined);
});

test("matchFilters · 無 filters 一律通過", () => {
  assert.equal(matchFilters({ eventType: "x" }, { any: 1 }), true);
});

test("matchFilters · eq 相等比對", () => {
  const cfg = { eventType: "x", filters: [{ path: "status", op: "eq" as const, value: "已確認" }] };
  assert.equal(matchFilters(cfg, { status: "已確認" }), true);
  assert.equal(matchFilters(cfg, { status: "草稿" }), false);
});

test("matchFilters · gte 數值門檻（可疑里程情境）", () => {
  const cfg = { eventType: "attendance.suspicious", filters: [{ path: "kmh", op: "gte" as const, value: 150 }] };
  assert.equal(matchFilters(cfg, { kmh: 320 }), true);
  assert.equal(matchFilters(cfg, { kmh: 80 }), false);
  assert.equal(matchFilters(cfg, { kmh: "not-a-number" }), false);
});

test("matchFilters · 多條件須全中（AND）", () => {
  const cfg = {
    eventType: "x",
    filters: [
      { path: "status", op: "eq" as const, value: "急件" },
      { path: "amount", op: "lte" as const, value: 1000 },
    ],
  };
  assert.equal(matchFilters(cfg, { status: "急件", amount: 500 }), true);
  assert.equal(matchFilters(cfg, { status: "急件", amount: 5000 }), false);
});

test("webhook parser · 完整模式（data 物件 + _ragicId）", () => {
  const p = parseRagicWebhook({ eventType: "UPDATE", data: [{ _ragicId: 41, "1001": "TB-0001" }] });
  assert.equal(p.eventType, "UPDATE");
  assert.equal(p.recordId, 41);
  assert.equal(p.recordData["1001"], "TB-0001");
});

test("webhook parser · 精簡模式（data 為 id 陣列）", () => {
  const p = parseRagicWebhook({ eventType: "CREATE", data: [7, 8, 9] });
  assert.equal(p.eventType, "CREATE");
  assert.equal(p.recordId, 7);
});

// Ragic 精簡模式送的是「裸陣列」不是 { data:[...] }（手冊 §14）
// 原本只認 wrapped 形式 → recordId 解不出來 → 不抓 record → 訊息每個欄位都（未填）
test("webhook parser · 精簡模式送裸陣列 [1,2,4]", () => {
  const p = parseRagicWebhook([1, 2, 4]);
  assert.equal(p.eventType, "UPDATE");
  assert.equal(p.recordId, 1);
  assert.deepEqual(p.recordData, {});
});

test("webhook parser · 裸陣列元素為數字字串", () => {
  assert.equal(parseRagicWebhook(["36"]).recordId, 36);
});

test("webhook parser · record id 為 0（Ragic 首筆）不可當成無 id", () => {
  assert.equal(parseRagicWebhook([0]).recordId, 0);
  assert.equal(parseRagicWebhook({ data: [{ _ragicId: 0 }] }).recordId, 0);
});

test("webhook parser · 空陣列 → null", () => {
  assert.equal(parseRagicWebhook([]).recordId, null);
});

test("webhook parser · eventType 缺 → UPDATE · recordId 取不到 → null", () => {
  const p = parseRagicWebhook({ data: [] });
  assert.equal(p.eventType, "UPDATE");
  assert.equal(p.recordId, null);
});

test("webhook parser · DELETE + top-level recordId", () => {
  const p = parseRagicWebhook({ eventType: "DELETE", recordId: 55, data: [] });
  assert.equal(p.eventType, "DELETE");
  assert.equal(p.recordId, 55);
});
