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

test("compose save trigger: 標題含【已更新】、預設 fallback「維修保養通知」", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "save");
  assert.match(msg, /^【維修保養通知｜已更新】$/m);
});

test("compose button trigger: 標題改為【手動發送】", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "button");
  assert.match(msg, /^【維修保養通知｜手動發送】$/m);
});

test("compose 帶 sheetName: 標題用 sheetName 覆寫", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "save", "TB-P71維修保養單-中部");
  assert.match(msg, /^【TB-P71維修保養單-中部｜已更新】$/m);
});

test("compose sheetName 空 → fallback「維修保養通知」", () => {
  assert.match(composeMaintenanceReportMessage(baseRec, "save", ""), /【維修保養通知｜已更新】/);
  assert.match(composeMaintenanceReportMessage(baseRec, "save", undefined), /【維修保養通知｜已更新】/);
});

test("compose 全欄逐行「欄位：值」、無 emoji、無區塊標題", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "save", "TB-P71維修保養單-中部");
  // 不該有 emoji
  assert.doesNotMatch(msg, /[📋🚗🛠📝👤]/);
  // 每個欄位一行
  assert.match(msg, /^單據編號：202607188-003$/m);
  assert.match(msg, /^單據日期：2026\/07\/07$/m);
  assert.match(msg, /^來源別：客戶申請$/m);
  assert.match(msg, /^來源單據編號：S-0001$/m);
  assert.match(msg, /^車型：SUV$/m);
  assert.match(msg, /^車牌號碼：uy7-098$/m);
  assert.match(msg, /^車身號碼：VIN-ABC-123$/m);
  assert.match(msg, /^產品序號：PROD-001$/m);
  assert.match(msg, /^出廠日期：2024\/01\/15$/m);
  assert.match(msg, /^設備類型：升降機$/m);
  assert.match(msg, /^設備型號：E-Series$/m);
  assert.match(msg, /^設備序號：EQ-556$/m);
  assert.match(msg, /^維修保養狀況：已完成$/m);
  assert.match(msg, /^維修人員：張澤志（T161）$/m);
  assert.match(msg, /^經辦人員：李承辦$/m);
});

test("compose 帶 recordUrl: 末尾附「檢視完整資料：URL」", () => {
  const url = "https://ap16.ragic.com/aitode/service-tickets/10/22222";
  const msg = composeMaintenanceReportMessage(baseRec, "save", "TB-P71維修保養單-中部", url);
  assert.match(msg, /^檢視完整資料：$/m);
  assert.ok(msg.endsWith(url));
  // URL 前應該有空行分隔
  assert.match(msg, /\n\n檢視完整資料：/);
});

test("compose 不帶 recordUrl: 末尾就是最後一個欄位、沒有連結", () => {
  const msg = composeMaintenanceReportMessage(baseRec, "save");
  assert.doesNotMatch(msg, /檢視完整資料/);
  assert.ok(msg.trim().endsWith("李承辦"));
});

test("compose 空欄位: 顯示（未填）", () => {
  const msg = composeMaintenanceReportMessage(
    { ...baseRec, 車型: "", 維修保養狀況: "" },
    "save",
  );
  assert.match(msg, /^車型：（未填）$/m);
  assert.match(msg, /^維修保養狀況：（未填）$/m);
});

test("compose 注入防禦: 含 \\n 折成空白", () => {
  const injected: MaintenanceRecord = {
    ...baseRec,
    維修保養狀況: "line1\nline2\r\nline3\tline4",
  };
  const msg = composeMaintenanceReportMessage(injected, "save");
  assert.match(msg, /^維修保養狀況：line1 line2 line3 line4$/m);
});

test("compose 超長值截斷: > 200 字元被截、訊息不炸", () => {
  const long = "A".repeat(500);
  const msg = composeMaintenanceReportMessage({ ...baseRec, 車身號碼: long }, "save");
  const vinLine = msg.split("\n").find((l) => l.startsWith("車身號碼：")) ?? "";
  const vinValue = vinLine.replace(/^車身號碼：/, "");
  assert.ok(vinValue.length <= 200, `車身號碼應 <= 200 字，實際 ${vinValue.length}`);
});
