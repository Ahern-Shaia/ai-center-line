export type NotifyEventType = "CREATE" | "UPDATE" | "DELETE";

// 解析 Ragic 原生 Webhook payload（防禦式 · 因實際 shape 需真 webhook 驗證，見 doc caveat）
// 完整模式：{ data:[{fieldId:value, _ragicId?}], apname, path, sheetIndex, eventType }
// 精簡模式：{ data:[1,2,4], ... }（只給變更的 record id）
export interface ParsedWebhook {
  eventType: NotifyEventType;
  recordId: number | null;
  recordData: Record<string, unknown>;
}

export function parseRagicWebhook(body: unknown): ParsedWebhook {
  const b = (body ?? {}) as Record<string, unknown>;
  const evRaw = String(b.eventType ?? "UPDATE").toUpperCase();
  const eventType: NotifyEventType = evRaw === "CREATE" || evRaw === "DELETE" ? evRaw : "UPDATE";

  let recordId: number | null = null;
  let recordData: Record<string, unknown> = {};

  const data = b.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (typeof first === "number") {
      recordId = first;
    } else if (first && typeof first === "object") {
      recordData = first as Record<string, unknown>;
      const rid = recordData._ragicId ?? recordData.ragicId ?? recordData._ragicid;
      if (rid != null && !Number.isNaN(Number(rid))) recordId = Number(rid);
    }
  }
  if (recordId == null && b.recordId != null && !Number.isNaN(Number(b.recordId))) {
    recordId = Number(b.recordId);
  }
  return { eventType, recordId, recordData };
}
