import type { NotificationChannelType, NotificationSourceType, NotificationTemplate } from "../db/schema.js";

// 正規化通知事件 · 所有來源（ragic_form / internal_event / schedule）都轉成這個形狀
// 對照 docs/modules/notification-hub.md §2
export interface NotificationEvent {
  sourceType: NotificationSourceType;
  tenantId: string | null;
  /** 訊息標題後綴（已新增 / 已更新 / 可疑里程…）*/
  eventLabel: string;
  /** 去重鍵（同鍵 30 秒內只送一次）*/
  dedupKey: string;
  /** 模板 path 取值來源（Ragic：欄位 id 為 key；領域事件：欄位名，支援 dot-path）*/
  payload: Record<string, unknown>;
  /** 「檢視完整資料」連結（選填）*/
  link?: string | null;
  /** internal_event 專用 · 事件型別（如 attendance.suspicious）*/
  eventType?: string;
  /** audit 用 · 來源識別（Ragic sheetPath / 事件型別）*/
  sourceRef?: string;
  /** audit 用 · 來源記錄 id */
  recordId?: number;
}

export interface RuleRow {
  ruleId: string;
  tenantId: string | null;
  name: string;
  enabled: boolean;
  sourceType: NotificationSourceType;
  sourceConfig: Record<string, unknown>;
  webhookToken: string | null;
  template: NotificationTemplate;
  channelType: NotificationChannelType;
  channelTarget: string | null;
}

/** ragic_form 規則的 source_config 形狀 */
export interface RagicSourceConfig {
  ragicAccountId: string;
  sheetPath: string;
  sheetName: string;
  events: { create: boolean; update: boolean; delete: boolean };
}

/** internal_event 規則的 source_config 形狀（OQ-NH-6：相等 + 數值門檻）*/
export interface InternalSourceConfig {
  eventType: string;
  filters?: Array<{ path: string; op: "eq" | "gte" | "lte"; value: string | number }>;
}
