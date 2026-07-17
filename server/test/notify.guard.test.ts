// Unit tests：WebhookSecretGuard（tenant-aware）。
// 手工組 ExecutionContext + 用真 TenantRegistry 直接吃自訂 env（不啟動 Nest、不動 process.env）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { WebhookSecretGuard, type NotifyRequest } from "../src/notify/webhook-secret.guard.js";
import { TenantRegistry } from "../src/notify/tenant.registry.js";

const SECRET_TWH = "a".repeat(32);
const SECRET_XY = "b".repeat(32);

const TWO_TENANT_ENV = {
  NOTIFY_WEBHOOK_SECRET: SECRET_TWH,
  LINE_CHANNEL_ACCESS_TOKEN: "twh-token",
  LINE_GROUP_ID_BUSINESS_ASSIST: "twh-group",
  NOTIFY_WEBHOOK_SECRET_XIANYONG: SECRET_XY,
  LINE_GROUP_ID_BUSINESS_ASSIST_XIANYONG: "xy-group",
};

function makeCtx(headers: Record<string, string | string[] | undefined>): {
  ctx: any;
  req: NotifyRequest;
} {
  const req: NotifyRequest = { headers };
  return {
    ctx: { switchToHttp: () => ({ getRequest: () => req }) },
    req,
  };
}

test("guard: default tenant secret → 命中 twh、req.tenant 設好", () => {
  const guard = new WebhookSecretGuard(new TenantRegistry(TWO_TENANT_ENV));
  const { ctx, req } = makeCtx({ "x-notify-secret": SECRET_TWH });
  assert.equal(guard.canActivate(ctx), true);
  assert.equal(req.tenant?.slug, "twh");
  assert.equal(req.tenant?.lineGroupIdBusinessAssist, "twh-group");
});

test("guard: 鮮勇 tenant secret → 命中 xianyong、req.tenant 設好", () => {
  const guard = new WebhookSecretGuard(new TenantRegistry(TWO_TENANT_ENV));
  const { ctx, req } = makeCtx({ "x-notify-secret": SECRET_XY });
  assert.equal(guard.canActivate(ctx), true);
  assert.equal(req.tenant?.slug, "xianyong");
  assert.equal(req.tenant?.lineGroupIdBusinessAssist, "xy-group");
});

test("guard: 未知 secret（不屬於任何 tenant）→ 401", () => {
  const guard = new WebhookSecretGuard(new TenantRegistry(TWO_TENANT_ENV));
  const { ctx } = makeCtx({ "x-notify-secret": "c".repeat(32) });
  assert.throws(() => guard.canActivate(ctx), UnauthorizedException);
  assert.throws(() => guard.canActivate(ctx), /invalid secret/);
});

test("guard: 缺 header → 401 missing", () => {
  const guard = new WebhookSecretGuard(new TenantRegistry(TWO_TENANT_ENV));
  const { ctx } = makeCtx({});
  assert.throws(() => guard.canActivate(ctx), /missing X-Notify-Secret/);
});

test("guard: 長度不同（避免 length oracle）也不 throw RangeError，仍拒", () => {
  const guard = new WebhookSecretGuard(new TenantRegistry(TWO_TENANT_ENV));
  const { ctx } = makeCtx({ "x-notify-secret": "a".repeat(31) }); // 少 1 字元
  assert.throws(() => guard.canActivate(ctx), /invalid secret/);
});
