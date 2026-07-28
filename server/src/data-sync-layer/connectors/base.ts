import type { OrderCanonical } from "../models/order.js";
import type { CustomerCanonical } from "../models/customer.js";
import type { ContactCanonical } from "../models/contact.js";

// SourceConnector 抽象介面 · 對應 docs/modules/data-sync-layer.md §5
// 每 ERP 一 implementation · Ragic / Weyver / SAP / 未來 · pilot 只做 Ragic
// 上層 scheduler / service 依 tenant config 動態選 Connector · 呼 pullXxx / healthCheck

export interface ConnectorHealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ConnectorPullOptions {
  since?: Date;               // 增量拉取 · 只拉 updated_at >= since 的
  limit?: number;             // 分頁上限 · default 200
  offset?: number;            // 分頁位移
  /** 只拉這些 fieldId · 空＝全拉（master-data-sync.md §3：沒拉進來的不會外洩） */
  fields?: string[];
}

export interface SourceConnector {
  readonly name: "ragic" | "weyver" | "sap" | "manual";
  readonly tenantId: string;

  pullOrders(options?: ConnectorPullOptions): Promise<OrderCanonical[]>;
  pullCustomers(options?: ConnectorPullOptions): Promise<CustomerCanonical[]>;
  pullContacts(options?: ConnectorPullOptions): Promise<ContactCanonical[]>;

  // 用於斷線偵測（§6 · 決定 writeback queue 是否啟用）
  healthCheck(): Promise<ConnectorHealthResult>;

  // 未來 SaaS 才需要 push · pilot skip
  // pushOrder?(order: OrderCanonical): Promise<{ sourceRecordId: string }>;
}
