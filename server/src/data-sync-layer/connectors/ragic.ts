import { Logger } from "@nestjs/common";
import { OrderSchema, type OrderCanonical } from "../models/order.js";
import { CustomerSchema, type CustomerCanonical } from "../models/customer.js";
import { ContactSchema, type ContactCanonical } from "../models/contact.js";
import type {
  ConnectorHealthResult,
  ConnectorPullOptions,
  SourceConnector,
} from "./base.js";

// Ragic Source Connector · 對應 docs/modules/data-sync-layer.md §5.2
// Ragic REST API pattern:
//   GET {baseUrl}/{account}/{tab-slug}/{sheetId}?api&APIKey={key}&_subtables=1
// 回應是 { "0": {...record0}, "1": {...record1}, ... }（key = ragicId）
// 每 tenant 對應 sheet path 由 tenant config 提供（§5.1 M1.4）

export interface RagicConnectorConfig {
  tenantId: string;                                    // canonical tenant uuid
  baseUrl: string;                                     // e.g. https://ap16.ragic.com
  account: string;                                     // e.g. 2026carhouse / freshfruits
  apiKey: string;
  sheetPaths: {
    order?: string;                                    // e.g. /order-operation/11 · 缺則跳過
    customer?: string;                                 // e.g. /customer/8
    contact?: string;                                  // e.g. /contact/9
  };
  // 主檔欄位 fieldId 對照 · tenant admin 於 Ragic 修改設計抓（見 SOP §11.1）
  // pilot 階段只 map 幾個關鍵欄位、其他進 raw
  fieldMap?: {
    order?: RagicOrderFieldMap;
    customer?: RagicCustomerFieldMap;
    contact?: RagicContactFieldMap;
  };
}

export interface RagicOrderFieldMap {
  orderNo?: string;                                    // Ragic fieldId 字串 · e.g. "1016153"
  customerName?: string;
  orderDate?: string;
  expectedDeliveryDate?: string;
  status?: string;
  amount?: string;
  ownerName?: string;
}

export interface RagicCustomerFieldMap {
  name?: string;
  code?: string;
  category?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface RagicContactFieldMap {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  lineId?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_LIMIT = 200;

export class RagicConnector implements SourceConnector {
  readonly name = "ragic" as const;
  readonly tenantId: string;
  private readonly logger = new Logger(RagicConnector.name);
  // 測試用 fetch 注入
  private fetchImpl: typeof fetch = fetch;

  constructor(private readonly config: RagicConnectorConfig) {
    this.tenantId = config.tenantId;
  }

  /** 僅測試用 */
  setFetchImpl(fn: typeof fetch): void {
    this.fetchImpl = fn;
  }

  async pullOrders(options?: ConnectorPullOptions): Promise<OrderCanonical[]> {
    const path = this.config.sheetPaths.order;
    if (!path) return [];
    const rows = await this.pullSheet(path, options);
    const map = this.config.fieldMap?.order ?? {};
    return rows
      .map((row) => this.toOrder(row, path, map))
      .filter((r): r is OrderCanonical => r !== null);
  }

  async pullCustomers(options?: ConnectorPullOptions): Promise<CustomerCanonical[]> {
    const path = this.config.sheetPaths.customer;
    if (!path) return [];
    const rows = await this.pullSheet(path, options);
    const map = this.config.fieldMap?.customer ?? {};
    return rows
      .map((row) => this.toCustomer(row, path, map))
      .filter((r): r is CustomerCanonical => r !== null);
  }

  async pullContacts(options?: ConnectorPullOptions): Promise<ContactCanonical[]> {
    const path = this.config.sheetPaths.contact;
    if (!path) return [];
    const rows = await this.pullSheet(path, options);
    const map = this.config.fieldMap?.contact ?? {};
    return rows
      .map((row) => this.toContact(row, map))
      .filter((r): r is ContactCanonical => r !== null);
  }

  async healthCheck(): Promise<ConnectorHealthResult> {
    // 用 order sheet path 當 canary · 若無則試 customer · 都無則報 config error
    const path =
      this.config.sheetPaths.order ??
      this.config.sheetPaths.customer ??
      this.config.sheetPaths.contact;
    if (!path) {
      return { ok: false, latencyMs: 0, error: "no sheet path configured" };
    }
    const startedAt = Date.now();
    try {
      // limit=1 · 只確認 API 可連 · 不拉全部
      const url = this.buildUrl(path, { limit: 1 });
      const res = await this.fetchWithTimeout(url);
      const latencyMs = Date.now() - startedAt;
      if (!res.ok) {
        return { ok: false, latencyMs, error: `HTTP ${res.status}` };
      }
      return { ok: true, latencyMs };
    } catch (e) {
      const err = e as { name?: string; message?: string };
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: err.name === "AbortError" ? "timeout" : (err.message ?? String(e)),
      };
    }
  }

  // === 內部 helpers ===

  private buildUrl(sheetPath: string, options?: ConnectorPullOptions): string {
    const base = this.config.baseUrl.replace(/\/$/, "");
    const params = new URLSearchParams();
    params.set("api", "");
    params.set("APIKey", this.config.apiKey);
    // ⚠️ 必須是 EID 不是 "true"。Ragic 預設回的 key 是「欄位名稱」，
    // 而下面 getField() 是用 fieldId 取值 —— 不指定 EID 就每個欄位都是 undefined，
    // 而且不會報錯。（notify 在 2026-07-27 踩過同一個坑，這裡因為從沒跑過所以一直沒被發現）
    params.set("naming", "EID");
    params.set("_subtables", "1");
    params.set("limit", String(options?.limit ?? DEFAULT_LIMIT));
    if (options?.offset) params.set("offset", String(options.offset));
    // 只拉需要的欄位 —— 這是隱私設計不是效能設計：
    // 沒有拉進來的東西不會外洩（master-data-sync.md §3 · F-1 P0）
    for (const f of options?.fields ?? []) params.append("fetchDomainIds", f);
    if (options?.since) {
      // Ragic where filter · 用 update_at >= since
      // 注意：Ragic where syntax 較複雜 · pilot 先不用 · 全量拉再 client 端 filter
    }
    return `${base}/${this.config.account}${sheetPath}?${params.toString()}`;
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async pullSheet(sheetPath: string, options?: ConnectorPullOptions): Promise<RagicRow[]> {
    const url = this.buildUrl(sheetPath, options);
    const res = await this.fetchWithTimeout(url);
    if (!res.ok) {
      throw new Error(`Ragic API HTTP ${res.status} for ${sheetPath}`);
    }
    const json = (await res.json()) as Record<string, RagicRow>;
    // Ragic 回 { "0": {...}, "1": {...} } · key 就是 ragicId
    return Object.entries(json).map(([ragicId, row]) => ({ ...row, __ragicId: ragicId }));
  }

  private getField(row: RagicRow, fieldId: string | undefined): string | undefined {
    if (!fieldId) return undefined;
    const v = row[fieldId];
    if (v == null) return undefined;
    const s = String(v).trim();
    return s === "" ? undefined : s;
  }

  private toOrder(row: RagicRow, sheetPath: string, map: RagicOrderFieldMap): OrderCanonical | null {
    const orderNo = this.getField(row, map.orderNo);
    if (!orderNo) return null; // 無單號 · skip
    const amount = this.getField(row, map.amount);
    const parsed = OrderSchema.safeParse({
      tenantId: this.tenantId,
      sourceConnector: "ragic",
      sourceRecordId: row.__ragicId,
      sourceSheetPath: sheetPath,
      orderNo,
      customerName: this.getField(row, map.customerName),
      orderDate: this.parseDate(this.getField(row, map.orderDate)),
      expectedDeliveryDate: this.parseDate(this.getField(row, map.expectedDeliveryDate)),
      status: this.getField(row, map.status),
      amount: amount != null ? Number(amount) : null,
      ownerName: this.getField(row, map.ownerName),
      raw: row,
    });
    if (!parsed.success) {
      this.logger.warn(`skip malformed order ${row.__ragicId}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  }

  private toCustomer(row: RagicRow, sheetPath: string, map: RagicCustomerFieldMap): CustomerCanonical | null {
    const name = this.getField(row, map.name);
    if (!name) return null;
    const parsed = CustomerSchema.safeParse({
      tenantId: this.tenantId,
      sourceConnector: "ragic",
      sourceRecordId: row.__ragicId,
      sourceSheetPath: sheetPath,
      name,
      code: this.getField(row, map.code),
      category: this.getField(row, map.category),
      contactEmail: this.getField(row, map.contactEmail),
      contactPhone: this.getField(row, map.contactPhone),
      raw: row,
    });
    if (!parsed.success) {
      this.logger.warn(`skip malformed customer ${row.__ragicId}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  }

  private toContact(row: RagicRow, map: RagicContactFieldMap): ContactCanonical | null {
    const name = this.getField(row, map.name);
    if (!name) return null;
    const parsed = ContactSchema.safeParse({
      tenantId: this.tenantId,
      sourceConnector: "ragic",
      sourceRecordId: row.__ragicId,
      name,
      title: this.getField(row, map.title),
      email: this.getField(row, map.email),
      phone: this.getField(row, map.phone),
      lineId: this.getField(row, map.lineId),
      raw: row,
    });
    if (!parsed.success) {
      this.logger.warn(`skip malformed contact ${row.__ragicId}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  }

  // Ragic 日期常見格式 · YYYY/MM/DD → YYYY-MM-DD
  private parseDate(v: string | undefined): string | null {
    if (!v) return null;
    const m = v.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (!m) return null;
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
}

type RagicRow = Record<string, unknown> & { __ragicId: string };
