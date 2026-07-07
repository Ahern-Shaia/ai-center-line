// Unit tests：WebhookSecretGuard。
// 手工組 ExecutionContext（僅需 switchToHttp().getRequest().headers），不啟動 Nest。
import { test } from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { WebhookSecretGuard } from "../src/notify/webhook-secret.guard.js";

function makeCtx(headers: Record<string, string | string[] | undefined>): any {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  };
}

const SECRET = "a".repeat(32); // 32 字元

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("guard: 正確 secret → true", () => {
  withEnv({ NOTIFY_WEBHOOK_SECRET: SECRET }, () => {
    const guard = new WebhookSecretGuard();
    const ctx = makeCtx({ "x-notify-secret": SECRET });
    assert.equal(guard.canActivate(ctx), true);
  });
});

test("guard: 錯誤 secret → 401", () => {
  withEnv({ NOTIFY_WEBHOOK_SECRET: SECRET }, () => {
    const guard = new WebhookSecretGuard();
    const ctx = makeCtx({ "x-notify-secret": "b".repeat(32) });
    assert.throws(() => guard.canActivate(ctx), UnauthorizedException);
  });
});

test("guard: 缺 header → 401（missing）", () => {
  withEnv({ NOTIFY_WEBHOOK_SECRET: SECRET }, () => {
    const guard = new WebhookSecretGuard();
    const ctx = makeCtx({});
    assert.throws(() => guard.canActivate(ctx), /missing X-Notify-Secret/);
  });
});

test("guard: env 未設 → 401 fail-fast（不 leak 為 500）", () => {
  withEnv({ NOTIFY_WEBHOOK_SECRET: undefined }, () => {
    const guard = new WebhookSecretGuard();
    const ctx = makeCtx({ "x-notify-secret": SECRET });
    assert.throws(() => guard.canActivate(ctx), /secret 未設或過短/);
  });
});

test("guard: env 過短（< 16）→ 401（避免弱 secret 上線）", () => {
  withEnv({ NOTIFY_WEBHOOK_SECRET: "short" }, () => {
    const guard = new WebhookSecretGuard();
    const ctx = makeCtx({ "x-notify-secret": "short" });
    assert.throws(() => guard.canActivate(ctx), /secret 未設或過短/);
  });
});

test("guard: 不同長度也擋（避免 length oracle），且不 throw RangeError", () => {
  withEnv({ NOTIFY_WEBHOOK_SECRET: SECRET }, () => {
    const guard = new WebhookSecretGuard();
    const ctx = makeCtx({ "x-notify-secret": "a".repeat(31) }); // 差 1 字元
    assert.throws(() => guard.canActivate(ctx), /invalid secret/);
  });
});
