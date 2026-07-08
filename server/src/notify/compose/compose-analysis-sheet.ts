// TB-P01 分析表通知訊息組裝（pure function，方便未來搬中介層直接複用）。
// 對應 docs/modules/notify.md v1.0。企業風格：無 emoji、無區塊標題、逐行「欄位：值」、末尾 Ragic 連結。
import type { AnalysisSheetRecord } from "../dto/ragic-analysis-sheet.dto.js";

const MAX_LINE_LENGTH = 200;

function s(v: string | undefined | null): string {
  if (v == null || v === "") return "（未填）";
  const cleaned = String(v).replace(/[\r\n\t]+/g, " ").slice(0, MAX_LINE_LENGTH).trim();
  return cleaned || "（未填）";
}

// 訂購單、預交日期兩對相鄰欄位合併成單行以節省行數
function joinLine(main: string, sub: string | undefined | null): string {
  const mainStr = s(main);
  const subStr = s(sub);
  if (subStr === "（未填）") return mainStr;
  return `${mainStr}（${subStr}）`;
}

export function composeAnalysisSheetMessage(
  rec: AnalysisSheetRecord,
  trigger: "save" | "button",
  sheetName?: string,
  recordUrl?: string,
): string {
  const label = trigger === "save" ? "已更新" : "手動發送";
  const title = s(sheetName) === "（未填）" ? "分析表通知" : s(sheetName);
  const lines: string[] = [
    `【${title}｜${label}】`,
    `分析表編號：${s(rec.分析表編號)}`,
    `狀態：${s(rec.狀態)}`,
    `客戶：${s(rec.客戶全稱)}`,
    `訂購單：${joinLine(rec.訂購單編號, rec.訂購單日期)}`,
    `預交日期：${joinLine(rec.預交日期, rec.剩餘天數 ? `剩 ${rec.剩餘天數} 天` : "")}`,
    `聯絡地址：${s(rec.聯絡地址)}`,
    `所屬部門：${s(rec.所屬部門)}`,
    `課稅類別：${s(rec.課稅類別)}`,
    `未稅合計：${s(rec.未稅合計)}`,
    `數量合計：${s(rec.數量合計)}`,
  ];
  if (recordUrl && recordUrl.trim()) {
    lines.push("", "檢視完整資料：", recordUrl.trim());
  }
  return lines.join("\n");
}
