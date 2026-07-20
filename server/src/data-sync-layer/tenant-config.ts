import { Injectable, Logger, Optional } from "@nestjs/common";
import type { RagicConnectorConfig } from "./connectors/ragic.js";

// Data Sync Layer tenant config
// 對應 docs/modules/data-sync-layer.md v0.2 · OQ-DSL-9（B tenant.registry 擴展 · 但為避免耦合 notify · 本層自建 registry）
// M1 只支援 Ragic connector · M6 才擴 weyver
//
// env pattern:
//   DSL_TENANT_<SLUG>_UUID=<tenant uuid>                  # required
//   DSL_TENANT_<SLUG>_CONNECTOR=ragic                     # required（M1 只支援 ragic）
//   DSL_TENANT_<SLUG>_RAGIC_BASE_URL=https://ap16.ragic.com
//   DSL_TENANT_<SLUG>_RAGIC_ACCOUNT=2026carhouse
//   DSL_TENANT_<SLUG>_RAGIC_API_KEY=<key>
//   DSL_TENANT_<SLUG>_RAGIC_SHEET_ORDER=/order-operation/11
//   DSL_TENANT_<SLUG>_RAGIC_SHEET_CUSTOMER=/customer/8    # 缺則不 pull customers
//   DSL_TENANT_<SLUG>_RAGIC_SHEET_CONTACT=/contact/9      # 缺則不 pull contacts
//   DSL_TENANT_<SLUG>_RAGIC_FIELD_ORDER_ORDER_NO=1016153
//   ... 其他 fieldId 映射（可選 · 缺則欄位不 map）

export interface DataSyncTenantConfig {
  slug: string;
  tenantId: string;                                       // canonical tenant uuid
  connector: "ragic";                                     // M1 only
  ragic?: RagicConnectorConfig;
}

function readTrimmed(env: Record<string, string | undefined>, key: string): string | undefined {
  const v = env[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

// 從 env 掃出所有 DSL_TENANT_<SLUG>_UUID 對應的 slug
function extractSlugs(env: Record<string, string | undefined>): string[] {
  const slugs = new Set<string>();
  for (const key of Object.keys(env)) {
    const m = key.match(/^DSL_TENANT_(.+)_UUID$/);
    if (m && m[1] && env[key] && env[key]!.trim() !== "") {
      slugs.add(m[1].toLowerCase());
    }
  }
  return [...slugs].sort();
}

export function buildDataSyncTenantConfigs(
  env: Record<string, string | undefined>,
): DataSyncTenantConfig[] {
  const configs: DataSyncTenantConfig[] = [];
  for (const slug of extractSlugs(env)) {
    const upper = slug.toUpperCase();
    const tenantId = readTrimmed(env, `DSL_TENANT_${upper}_UUID`);
    const connector = readTrimmed(env, `DSL_TENANT_${upper}_CONNECTOR`) ?? "ragic";
    if (!tenantId) {
      throw new Error(`DSL_TENANT_${upper}_UUID 缺（掃到 slug 但無 UUID · 環境變數異常）`);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      throw new Error(`DSL_TENANT_${upper}_UUID 格式非 UUID: ${tenantId}`);
    }
    if (connector !== "ragic") {
      throw new Error(
        `DSL_TENANT_${upper}_CONNECTOR='${connector}' · M1 只支援 'ragic'（M6 擴 weyver）`,
      );
    }

    const baseUrl = readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_BASE_URL`);
    const account = readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_ACCOUNT`);
    const apiKey = readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_API_KEY`);
    if (!baseUrl || !account || !apiKey) {
      throw new Error(
        `tenant '${slug}' Ragic connector 缺 BASE_URL/ACCOUNT/API_KEY 任一 · 全 3 條必填`,
      );
    }

    const sheetPaths = {
      order: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_SHEET_ORDER`),
      customer: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_SHEET_CUSTOMER`),
      contact: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_SHEET_CONTACT`),
    };
    if (!sheetPaths.order && !sheetPaths.customer && !sheetPaths.contact) {
      throw new Error(
        `tenant '${slug}' 三個 sheet path 至少填一個（DSL_TENANT_${upper}_RAGIC_SHEET_ORDER/CUSTOMER/CONTACT）`,
      );
    }

    const fieldMap = {
      order: {
        orderNo: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_ORDER_ORDER_NO`),
        customerName: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_ORDER_CUSTOMER_NAME`),
        orderDate: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_ORDER_ORDER_DATE`),
        expectedDeliveryDate: readTrimmed(
          env,
          `DSL_TENANT_${upper}_RAGIC_FIELD_ORDER_EXPECTED_DELIVERY_DATE`,
        ),
        status: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_ORDER_STATUS`),
        amount: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_ORDER_AMOUNT`),
        ownerName: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_ORDER_OWNER_NAME`),
      },
      customer: {
        name: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_CUSTOMER_NAME`),
        code: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_CUSTOMER_CODE`),
        category: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_CUSTOMER_CATEGORY`),
        contactEmail: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_CUSTOMER_EMAIL`),
        contactPhone: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_CUSTOMER_PHONE`),
      },
      contact: {
        name: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_CONTACT_NAME`),
        title: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_CONTACT_TITLE`),
        email: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_CONTACT_EMAIL`),
        phone: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_CONTACT_PHONE`),
        lineId: readTrimmed(env, `DSL_TENANT_${upper}_RAGIC_FIELD_CONTACT_LINE_ID`),
      },
    };

    configs.push({
      slug,
      tenantId,
      connector: "ragic",
      ragic: {
        tenantId,
        baseUrl,
        account,
        apiKey,
        sheetPaths,
        fieldMap,
      },
    });
  }
  return configs;
}

@Injectable()
export class DataSyncTenantRegistry {
  private readonly logger = new Logger(DataSyncTenantRegistry.name);
  private readonly configs: DataSyncTenantConfig[];

  // @Optional() 讓 Nest DI 允許不 inject env（reuse notify TenantRegistry pattern）
  // 對照：memory pitfall_nestjs_di_default_param
  constructor(@Optional() env?: Record<string, string | undefined>) {
    this.configs = buildDataSyncTenantConfigs(env ?? process.env);
    if (this.configs.length === 0) {
      this.logger.log("data-sync-layer 無 tenant 配置 · registry 為空（未啟用 M1 pull）");
    } else {
      this.logger.log(
        `data-sync-layer tenants 註冊：${this.configs.map((t) => `${t.slug}(${t.connector})`).join(", ")}`,
      );
    }
  }

  all(): DataSyncTenantConfig[] {
    return this.configs;
  }

  bySlug(slug: string): DataSyncTenantConfig | undefined {
    return this.configs.find((t) => t.slug === slug);
  }

  byTenantId(tenantId: string): DataSyncTenantConfig | undefined {
    return this.configs.find((t) => t.tenantId === tenantId);
  }
}
