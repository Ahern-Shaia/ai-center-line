// Unit tests：composeMaintenanceReportMessage 純函數。
// 不需要 DB / env / network → 完全 hermetic
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeMaintenanceReportMessage } from "../src/notify/compose/compose-maintenance-report.js";
import type { MaintenanceRecord } from "../src/notify/dto/ragic-maintenance-report.dto.js";

const baseRec: MaintenanceRecord = {
  維修保養單號: "MR-2026-0128",
  客戶全稱: "喬醫健康事業有限公司",
  聯絡人: "李柏君",
  聯絡電話: "02-2835-7700",
  車型: "福特旅玩家",
  車牌號碼: "AAA-1234",
  維修保養狀況: "冷氣不冷、需檢查壓縮機",
  客戶詳細地址: "台北市士林區中正路420號14樓",
};

test("compose save trigger: 產出完整 7 行訊息、含【已更新】標籤", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "save");
  assert.match(msg, /^【維修保養通知 · 已更新】$/m);
  assert.match(msg, /單號：MR-2026-0128/);
  assert.match(msg, /客戶：喬醫健康事業有限公司/);
  assert.match(msg, /聯絡人：李柏君（02-2835-7700）/);
  assert.match(msg, /車型 \/ 車牌：福特旅玩家 \/ AAA-1234/);
  assert.match(msg, /狀況：冷氣不冷、需檢查壓縮機/);
  assert.match(msg, /地址：台北市士林區中正路420號14樓/);
  assert.equal(msg.split("\n").length, 7);
});

test("compose button trigger: 標籤改為【手動發送】", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "button");
  assert.match(msg, /^【維修保養通知 · 手動發送】$/m);
});

test("compose 空欄位: 顯示（未填）而非空白，避免訊息結構跑掉", () => {
  const msg = composeMaintenanceReportMessage(
    { ...baseRec, 客戶全稱: "", 維修保養狀況: "" },
    "save",
  );
  assert.match(msg, /客戶：（未填）/);
  assert.match(msg, /狀況：（未填）/);
});

test("compose 注入防禦: 含 \\n 的欄位值被摺成空白，訊息只保 7 行", () => {
  const injected: MaintenanceRecord = {
    ...baseRec,
    維修保養狀況: "line1\nline2\r\nline3\tline4",
  };
  const msg = composeMaintenanceReportMessage(injected, "save");
  assert.equal(msg.split("\n").length, 7);
  assert.match(msg, /狀況：line1 line2 line3 line4/);
});

test("compose 超長值截斷: > 200 字元被截、訊息不炸", () => {
  const long = "A".repeat(500);
  const msg = composeMaintenanceReportMessage({ ...baseRec, 客戶詳細地址: long }, "save");
  const addressLine = msg.split("\n").find((l) => l.startsWith("地址：")) ?? "";
  const addressValue = addressLine.replace(/^地址：/, "");
  assert.ok(addressValue.length <= 200, `地址應 <= 200 字，實際 ${addressValue.length}`);
});
