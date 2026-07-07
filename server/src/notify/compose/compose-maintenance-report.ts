// TB-P71 維修保養單通知訊息組裝（pure function，方便未來搬中介層直接複用）。
// 對應 docs/modules/notify.md §6.1。
import type { MaintenanceRecord } from "../dto/ragic-maintenance-report.dto.js";

const MAX_LINE_LENGTH = 200; // 單行硬限；LINE 單則 5000 字全訊息上限由 controller 端整體再檢查

function s(v: string | undefined | null): string {
  if (v == null || v === "") return "（未填）";
  // 防注入：換行、tab 折成單一空白；避免使用者塞多行破壞訊息結構
  const cleaned = String(v).replace(/[\r\n\t]+/g, " ").slice(0, MAX_LINE_LENGTH).trim();
  return cleaned || "（未填）";
}

export function composeMaintenanceReportMessage(
  rec: MaintenanceRecord,
  trigger: "save" | "button",
): string {
  const label = trigger === "save" ? "已更新" : "手動發送";
  const lines: string[] = [
    `【維修保養通知 · ${label}】`,
    ``,
    `📋 單據 #${s(rec.單據編號)}（${s(rec.單據日期)}）`,
    `來源：${s(rec.來源別)} - ${s(rec.來源單據編號)}`,
    ``,
    `🚗 車輛`,
    `車型 / 車牌：${s(rec.車型)} / ${s(rec.車牌號碼)}`,
    `車身號碼：${s(rec.車身號碼)}`,
    `產品序號：${s(rec.產品序號)}`,
    `出廠：${s(rec.出廠日期)}`,
    ``,
    `🛠 設備`,
    `類型：${s(rec.設備類型)}`,
    `型號：${s(rec.設備型號)}`,
    `序號：${s(rec.設備序號)}`,
    ``,
    `📝 狀況：${s(rec.維修保養狀況)}`,
    ``,
    `👤 維修：${s(rec.維修人員姓名)}（#${s(rec.維修人員編號)}）`,
    `經辦：${s(rec.經辦人員簽名)}`,
  ];
  return lines.join("\n");
}
