import type { NotifyConfigField } from "../db/schema.js";

// 依 notify_config 動態組訊息（通用「逐行 欄位：值」+ 標題 + Ragic 連結）
// 通用化 notify v1 的手刻 composer（企業風：無 emoji、缺值→（未填）、行長上限）。
// 純函式 · 可測。
const MAX_LINE_LENGTH = 200;

export type NotifyEventType = "CREATE" | "UPDATE" | "DELETE";

function s(v: unknown): string {
  if (v == null || v === "") return "（未填）";
  const cleaned = String(v).replace(/[\r\n\t]+/g, " ").slice(0, MAX_LINE_LENGTH).trim();
  return cleaned || "（未填）";
}

function eventLabel(e: NotifyEventType): string {
  if (e === "CREATE") return "已新增";
  if (e === "DELETE") return "已刪除";
  return "已更新";
}

export function composeFromConfig(input: {
  title: string; // 已 resolve（config.title || sheetName）
  eventType: NotifyEventType;
  fields: NotifyConfigField[];
  record: Record<string, unknown>; // { fieldId(字串): 值 }
  recordUrl?: string | null;
}): string {
  const ordered = [...input.fields].sort((a, b) => a.order - b.order);
  const lines: string[] = [`【${s(input.title)}｜${eventLabel(input.eventType)}】`];
  for (const f of ordered) {
    lines.push(`${f.label}：${s(input.record[String(f.fieldId)])}`);
  }
  if (input.recordUrl) {
    lines.push("", "檢視完整資料：", input.recordUrl);
  }
  return lines.join("\n");
}
