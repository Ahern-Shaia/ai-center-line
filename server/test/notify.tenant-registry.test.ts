// Unit tests：buildTenantRegistry。
// 純函數不啟動 Nest；直接傳 env 對象、不動 process.env。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTenantRegistry } from "../src/notify/tenant.registry.js";

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);

const DEFAULT_ENV = {
  NOTIFY_WEBHOOK_SECRET: SECRET_A,
  LINE_CHANNEL_ACCESS_TOKEN: "twh-token",
  LINE_GROUP_ID_BUSINESS_ASSIST: "twh-group",
};

test("registry: 只有 default env → 1 tenant twh，欄位齊全", () => {
  const tenants = buildTenantRegistry({ ...DEFAULT_ENV });
  assert.equal(tenants.length, 1);
  const [t] = tenants;
  assert.equal(t.slug, "twh");
  assert.equal(t.displayName, "台灣福祉");
  assert.equal(t.webhookSecret, SECRET_A);
  assert.equal(t.lineChannelToken, "twh-token");
  assert.equal(t.lineGroupIdBusinessAssist, "twh-group");
  assert.deepEqual(t.allowedSheetPaths, []);
});

test("registry: default + 鮮勇 env → 2 tenants；鮮勇 token 缺就 fallback default", () => {
  const tenants = buildTenantRegistry({
    ...DEFAULT_ENV,
    NOTIFY_WEBHOOK_SECRET_XIANYONG: SECRET_B,
    LINE_GROUP_ID_BUSINESS_ASSIST_XIANYONG: "xy-group",
    NOTIFY_TENANT_SHEETS_XIANYONG: "/quotation/6,/material-inspection/4",
    // 沒填 LINE_CHANNEL_ACCESS_TOKEN_XIANYONG → 應 fallback 到 default token（共用官方帳號）
  });
  assert.equal(tenants.length, 2);
  const xy = tenants.find((t) => t.slug === "xianyong")!;
  assert.equal(xy.displayName, "鮮勇");
  assert.equal(xy.webhookSecret, SECRET_B);
  assert.equal(xy.lineChannelToken, "twh-token"); // fallback
  assert.equal(xy.lineGroupIdBusinessAssist, "xy-group");
  assert.deepEqual(xy.allowedSheetPaths, ["/quotation/6", "/material-inspection/4"]);
});

test("registry: 鮮勇 group id 也缺 → fallback default group（測試階段共用業助群）", () => {
  const tenants = buildTenantRegistry({
    ...DEFAULT_ENV,
    NOTIFY_WEBHOOK_SECRET_XIANYONG: SECRET_B,
    // 沒填 LINE_GROUP_ID_BUSINESS_ASSIST_XIANYONG 也沒填 token → 全 fallback default
  });
  const xy = tenants.find((t) => t.slug === "xianyong")!;
  assert.equal(xy.lineChannelToken, "twh-token");
  assert.equal(xy.lineGroupIdBusinessAssist, "twh-group"); // fallback
});

test("registry: 缺 default LINE_GROUP_ID_BUSINESS_ASSIST → throw（fail-loud）", () => {
  assert.throws(
    () =>
      buildTenantRegistry({
        NOTIFY_WEBHOOK_SECRET: SECRET_A,
        LINE_CHANNEL_ACCESS_TOKEN: "twh-token",
        // LINE_GROUP_ID_BUSINESS_ASSIST 缺
      }),
    /缺 LINE_GROUP_ID_BUSINESS_ASSIST/,
  );
});

test("registry: 兩 tenant 用相同 secret → throw（cross-tenant 碰撞）", () => {
  assert.throws(
    () =>
      buildTenantRegistry({
        ...DEFAULT_ENV,
        NOTIFY_WEBHOOK_SECRET_XIANYONG: SECRET_A, // 跟 default 相同 secret
        LINE_GROUP_ID_BUSINESS_ASSIST_XIANYONG: "xy-group",
      }),
    /webhookSecret 碰撞/,
  );
});

test("registry: 無任何 tenant 配置 → throw（不能靜默）", () => {
  assert.throws(() => buildTenantRegistry({}), /無任何 tenant 配置/);
});

test("registry: default secret 過短 → throw（避免弱 secret 上線）", () => {
  assert.throws(
    () =>
      buildTenantRegistry({
        NOTIFY_WEBHOOK_SECRET: "short",
        LINE_CHANNEL_ACCESS_TOKEN: "twh-token",
        LINE_GROUP_ID_BUSINESS_ASSIST: "twh-group",
      }),
    /過短/,
  );
});
