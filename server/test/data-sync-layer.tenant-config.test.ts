// Unit tests: DataSyncTenantRegistry env parse + validation
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataSyncTenantConfigs, DataSyncTenantRegistry } from "../src/data-sync-layer/tenant-config.js";

const TENANT_UUID = "11111111-1111-1111-1111-111111111111";

const TWH_MIN_ENV = {
  DSL_TENANT_TWH_UUID: TENANT_UUID,
  DSL_TENANT_TWH_RAGIC_BASE_URL: "https://ap16.ragic.com",
  DSL_TENANT_TWH_RAGIC_ACCOUNT: "2026carhouse",
  DSL_TENANT_TWH_RAGIC_API_KEY: "test-api-key",
  DSL_TENANT_TWH_RAGIC_SHEET_ORDER: "/order-operation/11",
};

test("tenant-config: 最小配置 twh 一個 tenant · 建 1 個 · connector 預設 ragic", () => {
  const configs = buildDataSyncTenantConfigs({ ...TWH_MIN_ENV });
  assert.equal(configs.length, 1);
  const twh = configs[0];
  assert.equal(twh.slug, "twh");
  assert.equal(twh.tenantId, TENANT_UUID);
  assert.equal(twh.connector, "ragic");
  assert.equal(twh.ragic?.baseUrl, "https://ap16.ragic.com");
  assert.equal(twh.ragic?.sheetPaths.order, "/order-operation/11");
  assert.equal(twh.ragic?.sheetPaths.customer, undefined);
});

test("tenant-config: 完整 fieldMap 也 parse", () => {
  const configs = buildDataSyncTenantConfigs({
    ...TWH_MIN_ENV,
    DSL_TENANT_TWH_RAGIC_FIELD_ORDER_ORDER_NO: "1016153",
    DSL_TENANT_TWH_RAGIC_FIELD_ORDER_CUSTOMER_NAME: "1016085",
    DSL_TENANT_TWH_RAGIC_FIELD_ORDER_STATUS: "1026328",
  });
  const t = configs[0];
  assert.equal(t.ragic?.fieldMap?.order?.orderNo, "1016153");
  assert.equal(t.ragic?.fieldMap?.order?.customerName, "1016085");
  assert.equal(t.ragic?.fieldMap?.order?.status, "1026328");
});

test("tenant-config: UUID 格式錯 → throw", () => {
  assert.throws(
    () =>
      buildDataSyncTenantConfigs({
        ...TWH_MIN_ENV,
        DSL_TENANT_TWH_UUID: "not-uuid",
      }),
    /格式非 UUID/,
  );
});

test("tenant-config: connector 非 ragic → throw（M1 only）", () => {
  assert.throws(
    () =>
      buildDataSyncTenantConfigs({
        ...TWH_MIN_ENV,
        DSL_TENANT_TWH_CONNECTOR: "weyver",
      }),
    /M1 只支援/,
  );
});

test("tenant-config: 缺 RAGIC_BASE_URL/ACCOUNT/API_KEY 任一 → throw", () => {
  const noAccount = { ...TWH_MIN_ENV };
  delete (noAccount as Record<string, string | undefined>).DSL_TENANT_TWH_RAGIC_ACCOUNT;
  assert.throws(() => buildDataSyncTenantConfigs(noAccount), /BASE_URL\/ACCOUNT\/API_KEY/);
});

test("tenant-config: 三個 sheet path 都缺 → throw", () => {
  const noSheet = { ...TWH_MIN_ENV };
  delete (noSheet as Record<string, string | undefined>).DSL_TENANT_TWH_RAGIC_SHEET_ORDER;
  assert.throws(() => buildDataSyncTenantConfigs(noSheet), /三個 sheet path 至少填一個/);
});

test("tenant-config: 兩 tenant 並存 · registry 都認得", () => {
  const configs = buildDataSyncTenantConfigs({
    ...TWH_MIN_ENV,
    DSL_TENANT_XIANYONG_UUID: "22222222-2222-2222-2222-222222222222",
    DSL_TENANT_XIANYONG_RAGIC_BASE_URL: "https://ap16.ragic.com",
    DSL_TENANT_XIANYONG_RAGIC_ACCOUNT: "freshfruits",
    DSL_TENANT_XIANYONG_RAGIC_API_KEY: "xy-key",
    DSL_TENANT_XIANYONG_RAGIC_SHEET_ORDER: "/erp/1",
  });
  assert.equal(configs.length, 2);
  assert.deepEqual(configs.map((c) => c.slug).sort(), ["twh", "xianyong"]);
});

test("registry: 無 env → 空 registry（不 throw · 允許 pilot 階段模組不 enable）", () => {
  const reg = new DataSyncTenantRegistry({});
  assert.equal(reg.all().length, 0);
  assert.equal(reg.bySlug("twh"), undefined);
});

test("registry: bySlug / byTenantId 查詢", () => {
  const reg = new DataSyncTenantRegistry({ ...TWH_MIN_ENV });
  assert.equal(reg.bySlug("twh")?.tenantId, TENANT_UUID);
  assert.equal(reg.byTenantId(TENANT_UUID)?.slug, "twh");
  assert.equal(reg.bySlug("nonexistent"), undefined);
});
