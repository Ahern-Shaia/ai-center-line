// TB-P71 維修保養單通知訊息組裝（pure function，方便未來搬中介層直接複用）。
// 對應 docs/modules/notify.md §6.1。企業風格：無 emoji、無區塊標題、逐行「欄位：值」、末尾 Ragic 連結。
import type { MaintenanceRecord } from "../dto/ragic-maintenance-report.dto.js";

const MAX_LINE_LENGTH = 200; // 單行硬限；LINE 單則 5000 字全訊息上限由 controller 端整體再檢查

function s(v: string | undefined | null): string {
  if (v == null || v === "") return "（未填）";
  const cleaned = String(v).replace(/[\r\n\t]+/g, " ").slice(0, MAX_LINE_LENGTH).trim();
  return cleaned || "（未填）";
}

export function composeMaintenanceReportMessage(
  rec: MaintenanceRecord,
  trigger: "save" | "button",
  sheetName?: string,
  recordUrl?: string,
): string {
  const label = trigger === "save" ? "已更新" : "手動發送";
  const title = s(sheetName) === "（未填）" ? "維修保養通知" : s(sheetName);
  const lines: string[] = [
    `【${title}｜${label}】`,
    `單據編號：${s(rec.單據編號)}`,
    `單據日期：${s(rec.單據日期)}`,
    `來源別：${s(rec.來源別)}`,
    `來源單據編號：${s(rec.來源單據編號)}`,
    `車型：${s(rec.車型)}`,
    `車牌號碼：${s(rec.車牌號碼)}`,
    `車身號碼：${s(rec.車身號碼)}`,
    `產品序號：${s(rec.產品序號)}`,
    `出廠日期：${s(rec.出廠日期)}`,
    `設備類型：${s(rec.設備類型)}`,
    `設備型號：${s(rec.設備型號)}`,
    `設備序號：${s(rec.設備序號)}`,
    `維修保養狀況：${s(rec.維修保養狀況)}`,
    `維修人員：${s(rec.維修人員姓名)}（${s(rec.維修人員編號)}）`,
    `經辦人員：${s(rec.經辦人員簽名)}`,
  ];
  if (recordUrl && recordUrl.trim()) {
    lines.push("", "檢視完整資料：", recordUrl.trim());
  }
  return lines.join("\n");
}
