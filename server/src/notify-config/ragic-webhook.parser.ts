export type NotifyEventType = "CREATE" | "UPDATE" | "DELETE";

// 解析 Ragic 原生 Webhook payload
// Ragic 有兩種回應模式，形狀差很多：
//   完整：{ data:[{fieldId:value, _ragicId?}], apname, path, sheetIndex, eventType }
//   精簡：[1,2,4]  ← ⚠️ 是「裸陣列」，不是 { data:[...] }。沒帶 eventType。
// 精簡模式只給變更的 record id，欄位值一律要再回頭打 API 抓。
export interface ParsedWebhook {
  eventType: NotifyEventType;
  recordId: number | null;
  recordData: Record<string, unknown>;
}

function toRecordId(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseRagicWebhook(body: unknown): ParsedWebhook {
  // 精簡模式：body 本身就是 id 陣列
  if (Array.isArray(body)) {
    return { eventType: "UPDATE", recordId: toRecordId(body[0]), recordData: {} };
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const evRaw = String(b.eventType ?? "UPDATE").toUpperCase();
  const eventType: NotifyEventType = evRaw === "CREATE" || evRaw === "DELETE" ? evRaw : "UPDATE";

  let recordId: number | null = null;
  let recordData: Record<string, unknown> = {};

  const data = b.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first && typeof first === "object") {
      recordData = first as Record<string, unknown>;
      recordId = toRecordId(recordData._ragicId ?? recordData.ragicId ?? recordData._ragicid);
    } else {
      recordId = toRecordId(first);   // 數字或數字字串皆可
    }
  }
  if (recordId == null) recordId = toRecordId(b.recordId);
  return { eventType, recordId, recordData };
}
