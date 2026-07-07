// TB-P71 維修保養單通知訊息組裝（pure function，方便未來搬中介層直接複用）。
// 對應 docs/modules/notify.md §6.1。
import type { MaintenanceRecord } from "../dto/ragic-maintenance-report.dto.js";

const MAX_LINE_LENGTH = 200; // 單行硬限；LINE 單則 5000 字全訊息上限由 controller 端整體再檢查

function sanitize(v: string | undefined | null): string {
  if (v == null) return "";
  // 防注入：換行、carriage return 折成單一空白；避免使用者塞多行破壞訊息結構
  return String(v).replace(/[\r\n\t]+/g, " ").slice(0, MAX_LINE_LENGTH).trim();
}

export function composeMaintenanceReportMessage(
  rec: MaintenanceRecord,
  trigger: "save" | "button",
): string {
  const label = trigger === "save" ? "已更新" : "手動發送";
  const lines = [
    `【維修保養通知 · ${label}】`,
    `單號：${sanitize(rec.維修保養單號) || "（未填）"}`,
    `客戶：${sanitize(rec.客戶全稱) || "（未填）"}`,
    `聯絡人：${sanitize(rec.聯絡人) || "（未填）"}（${sanitize(rec.聯絡電話) || "無電話"}）`,
    `車型 / 車牌：${sanitize(rec.車型) || "-"} / ${sanitize(rec.車牌號碼) || "-"}`,
    `狀況：${sanitize(rec.維修保養狀況) || "（未填）"}`,
    `地址：${sanitize(rec.客戶詳細地址) || "（未填）"}`,
  ];
  return lines.join("\n");
}
