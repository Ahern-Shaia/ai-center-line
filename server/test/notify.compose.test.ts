// Unit tests：composeMaintenanceReportMessage 純函數。
// 不需要 DB / env / network → 完全 hermetic
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeMaintenanceReportMessage } from "../src/notify/compose/compose-maintenance-report.js";
import type { MaintenanceRecord } from "../src/notify/dto/ragic-maintenance-report.dto.js";

const baseRec: MaintenanceRecord = {
  單據編號: "202607188-003",
  單據日期: "2026/07/07",
  來源別: "客戶申請",
  來源單據編號: "S-0001",
  車型: "SUV",
  車牌號碼: "uy7-098",
  車身號碼: "VIN-ABC-123",
  產品序號: "PROD-001",
  出廠日期: "2024/01/15",
  設備類型: "升降機",
  設備型號: "E-Series",
  設備序號: "EQ-556",
  維修保養狀況: "已完成",
  維修人員編號: "T161",
  維修人員姓名: "張澤志",
  經辦人員簽名: "李承辦",
};

test("compose save trigger: 標題含【已更新】、預設 fallback 到「維修保養通知」", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "save");
  assert.match(msg, /^【維修保養通知 · 已更新】$/m);
});

test("compose button trigger: 標題改為【手動發送】", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "button");
  assert.match(msg, /^【維修保養通知 · 手動發送】$/m);
});

test("compose 帶 sheetName: 標題用 sheetName 覆寫預設", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "save", "TB-P71維修保養單-中部");
  assert.match(msg, /^【TB-P71維修保養單-中部 · 已更新】$/m);
});

test("compose sheetName 空字串 / undefined → fallback「維修保養通知」", () => {
  assert.match(composeMaintenanceReportMessage(baseRec, "save", ""), /【維修保養通知 · 已更新】/);
  assert.match(composeMaintenanceReportMessage(baseRec, "save", undefined), /【維修保養通知 · 已更新】/);
});

test("compose 分 5 段（單據 / 車輛 / 設備 / 狀況 / 人員），每段有 emoji header", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "save");
  assert.match(msg, /📋 單據 #202607188-003（2026\/07\/07）/);
  assert.match(msg, /🚗 車輛/);
  assert.match(msg, /🛠 設備/);
  assert.match(msg, /📝 狀況：已完成/);
  assert.match(msg, /👤 維修：張澤志（#T161）/);
});

test("compose 車輛段：車型 / 車牌 用斜線分隔", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "save");
  assert.match(msg, /車型 \/ 車牌：SUV \/ uy7-098/);
});

test("compose 空欄位: 顯示（未填）而非空白", () => {
  const msg = composeMaintenanceReportMessage(
    { ...baseRec, 車型: "", 維修保養狀況: "", 經辦人員簽名: "" },
    "save",
  );
  assert.match(msg, /車型 \/ 車牌：（未填） \/ uy7-098/);
  assert.match(msg, /📝 狀況：（未填）/);
  assert.match(msg, /經辦：（未填）/);
});

test("compose 注入防禦: 含 \\n 的欄位值被摺成空白", () => {
  const injected: MaintenanceRecord = {
    ...baseRec,
    維修保養狀況: "line1\nline2\r\nline3\tline4",
  };
  const msg = composeMaintenanceReportMessage(injected, "save");
  assert.match(msg, /📝 狀況：line1 line2 line3 line4/);
  // 訊息應該還是原來的行數（5 段結構不被 \n 破壞）
  assert.equal(msg.split("\n").filter((l) => l.startsWith("📋") || l.startsWith("🚗") || l.startsWith("🛠") || l.startsWith("📝") || l.startsWith("👤")).length, 5);
});

test("compose 超長值截斷: > 200 字元被截、訊息不炸", () => {
  const long = "A".repeat(500);
  const msg = composeMaintenanceReportMessage({ ...baseRec, 車身號碼: long }, "save");
  const vinLine = msg.split("\n").find((l) => l.startsWith("車身號碼：")) ?? "";
  const vinValue = vinLine.replace(/^車身號碼：/, "");
  assert.ok(vinValue.length <= 200, `車身號碼應 <= 200 字，實際 ${vinValue.length}`);
});

test("compose optional 欄位缺（undefined）→ 全（未填）不炸", () => {
  const partial = { 單據編號: "X-001", 維修保養狀況: "檢查中" } as MaintenanceRecord;
  const msg = composeMaintenanceReportMessage(partial, "save");
  assert.match(msg, /單據 #X-001/);
  assert.match(msg, /狀況：檢查中/);
  assert.match(msg, /車型 \/ 車牌：（未填） \/ （未填）/);
});
