// 鮮勇原料驗貨單（上游-4a）通知訊息組裝（pure function）。
// 對應 docs/modules/notify-multi-tenant.md §6.2。企業風格：無 emoji、逐行「欄位：值」、末尾 Ragic 連結。
// 8 欄全上；trigger=save 語意為「已更新」（OQ-NMT-9 修訂：任何 save 都發，Ragic Post workflow 無條件 push）
import type { MaterialInspectionRecord } from "../dto/ragic-material-inspection.dto.js";

const MAX_LINE_LENGTH = 200;

function s(v: string | undefined | null): string {
  if (v == null || v === "") return "（未填）";
  const cleaned = String(v).replace(/[\r\n\t]+/g, " ").slice(0, MAX_LINE_LENGTH).trim();
  return cleaned || "（未填）";
}

// 品項＋品編 合併為單行「品項（品編）」
function joinItem(name: string | undefined | null, code: string | undefined | null): string {
  const nameStr = s(name);
  const codeStr = s(code);
  if (codeStr === "（未填）") return nameStr;
  return `${nameStr}（${codeStr}）`;
}

// 收貨／實收 合併為單行「收貨 500 kg，實收 498 kg」
function joinQty(
  received: string | undefined | null,
  actual: string | undefined | null,
  unit: string | undefined | null,
): string {
  const receivedStr = s(received);
  const actualStr = s(actual);
  const unitStr = s(unit) === "（未填）" ? "" : ` ${s(unit)}`;
  if (actualStr === "（未填）") return `${receivedStr}${unitStr}`;
  if (receivedStr === "（未填）") return `${actualStr}${unitStr}`;
  return `收貨 ${receivedStr}${unitStr}、實收 ${actualStr}${unitStr}`;
}

export function composeMaterialInspectionMessage(
  rec: MaterialInspectionRecord,
  trigger: "save" | "button",
  sheetName?: string,
  recordUrl?: string,
): string {
  const label = trigger === "save" ? "已更新" : "手動發送";
  const title = s(sheetName) === "（未填）" ? "原料驗貨單通知" : s(sheetName);
  const lines: string[] = [
    `【${title}｜${label}】`,
    `品項：${joinItem(rec.品項名稱, rec.品編)}`,
    `批號：${s(rec.批號)}`,
    `數量：${joinQty(rec.收貨數量, rec.數量, rec.單位)}`,
    `製造/有效日期：${s(rec.製造有效日期)}`,
    `檢驗結果：${s(rec.檢驗完成)}`,
  ];
  if (recordUrl && recordUrl.trim()) {
    lines.push("", "檢視完整資料：", recordUrl.trim());
  }
  return lines.join("\n");
}
