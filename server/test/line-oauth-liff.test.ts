// LIFF token → JWT 認證的安全閘門測試（修 IDOR 的核心）
// 對照 docs/modules/liff-webapp-consolidation.md M1
// 這些 case 在打 DB 前就 throw，純 mock fetch，不需 DB。
// 「合法 token → binding → JWT」屬整合測試（需 DB + 種一筆 binding），另做。

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { LineOauthService } from "../src/auth/line-oauth.service.js";

const CHANNEL = "1234567890";
// jwt / bindingService 在成功路徑才用到；本檔只測失敗閘門 → 給最小 stub
const svc = new LineOauthService({ signAsync: async () => "jwt.token" } as never, {} as never);

let origFetch: typeof globalThis.fetch;

function mockFetch(handler: (url: string) => { ok: boolean; status?: number; json?: unknown; text?: string }) {
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    const r = handler(url);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 401),
      json: async () => r.json,
      text: async () => r.text ?? "",
    } as unknown as Response;
  }) as typeof globalThis.fetch;
}

beforeEach(() => { origFetch = globalThis.fetch; process.env.LINE_LOGIN_CHANNEL_ID = CHANNEL; });
afterEach(() => { globalThis.fetch = origFetch; });

test("LIFF token · channel_id 不符 → 401（擋跨 channel 憑證）", async () => {
  mockFetch(() => ({ ok: true, json: { client_id: "9999", expires_in: 3600 } }));
  await assert.rejects(() => svc.handleLiffToken("tok"), /channel 不符/);
});

test("LIFF token · 已過期 → 401", async () => {
  mockFetch(() => ({ ok: true, json: { client_id: CHANNEL, expires_in: 0 } }));
  await assert.rejects(() => svc.handleLiffToken("tok"), /過期/);
});

test("LIFF token · verify 端點失敗 → 401", async () => {
  mockFetch(() => ({ ok: false, status: 400, text: "invalid_token" }));
  await assert.rejects(() => svc.handleLiffToken("tok"), /憑證無效/);
});

test("LIFF token · profile 無 userId → 401", async () => {
  mockFetch((url) => url.includes("/verify")
    ? { ok: true, json: { client_id: CHANNEL, expires_in: 3600 } }
    : { ok: true, json: {} });
  await assert.rejects(() => svc.handleLiffToken("tok"), /無 userId/);
});
