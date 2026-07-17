// 鮮勇報價單（下游-1）通知訊息組裝（pure function）。
// 對應 docs/modules/notify-multi-tenant.md §6.1。企業風格：無 emoji、逐行「欄位：值」、末尾 Ragic 連結。
// DTO 14 欄；本 composer 只輸出擇要 8 欄（OQ-NMT-8 A）。
import type { QuotationRecord } from "../dto/ragic-quotation.dto.js";

const MAX_LINE_LENGTH = 200;

function s(v: string | undefined | null): string {
  if (v == null || v === "") return "（未填）";
  const cleaned = String(v).replace(/[\r\n\t]+/g, " ").slice(0, MAX_LINE_LENGTH).trim();
  return cleaned || "（未填）";
}

// 兩個狀態欄位合併：「單據狀態（Approval: xxx）」
function joinStatus(main: string | undefined | null, approval: string | undefined | null): string {
  const mainStr = s(main);
  const appStr = s(approval);
  if (appStr === "（未填）") return mainStr;
  return `${mainStr}（Approval: ${appStr}）`;
}

export function composeQuotationMessage(
  rec: QuotationRecord,
  trigger: "save" | "button",
  sheetName?: string,
  recordUrl?: string,
): string {
  const label = trigger === "save" ? "已更新" : "手動發送";
  const title = s(sheetName) === "（未填）" ? "報價單通知" : s(sheetName);
  const lines: string[] = [
    `【${title}｜${label}】`,
    `報價單號：${s(rec.報價單號)}`,
    `狀態：${joinStatus(rec.單據狀態, rec.Approval_status)}`,
    `客戶：${s(rec.客戶名稱)}`,
    `報價日期：${s(rec.報價單日期)}`,
    `有效日期：${s(rec.報價有效日期)}`,
    `承辦：${s(rec.承辦人員)}`,
    `簽核：${s(rec.簽核人)}`,
  ];
  if (recordUrl && recordUrl.trim()) {
    lines.push("", "檢視完整資料：", recordUrl.trim());
  }
  return lines.join("\n");
}
