// 0060 · per-bot LIFF · 跨 provider 憑證必須被擋下（docs/modules/liff-multi-provider.md）
//
// 這條防線的意義：LINE 的 userId 依 provider 發放。拿 A provider 的 LIFF token
// 去綁 B provider 的 bot，會寫進一個永遠對不上 webhook 的 line_user_id，
// 而且整個流程「看起來成功」—— 2026-08-04 aiproot 就是這樣產生一筆髒綁定。
// 純 mock fetch，不需 DB。

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { verifyLiffAccessToken } from "../src/auth/liff-verify.js";

const ENV_CHANNEL = "1111111111";      // 全域允許清單裡那支（舊 provider）
const BOT_CHANNEL = "2222222222";      // 某個 bot 自己的 Login channel（新 provider）

let origFetch: typeof globalThis.fetch;

function mockVerify(clientId: string) {
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    const json = url.includes("/oauth2/v2.1/verify")
      ? { client_id: clientId, expires_in: 3600 }
      : { userId: "Utest0000000000000000000000000000" };
    return { ok: true, status: 200, json: async () => json, text: async () => "" } as unknown as Response;
  }) as typeof globalThis.fetch;
}

beforeEach(() => {
  origFetch = globalThis.fetch;
  process.env.LINE_LOGIN_CHANNEL_ID = ENV_CHANNEL;
  delete process.env.LIFF_CHANNEL_IDS;
});
afterEach(() => { globalThis.fetch = origFetch; });

test("⭐ 帶 expectedChannelId 時 · 舊 provider 的 token 被擋（就算它在 env 允許清單裡）", async () => {
  mockVerify(ENV_CHANNEL);
  await assert.rejects(
    () => verifyLiffAccessToken("tok", BOT_CHANNEL),
    /不是這個組織的/,
    "env 允許清單不該覆寫 bot 自己的 login_channel_id —— 否則跨 provider 憑證又會被默默接受",
  );
});

test("帶 expectedChannelId 時 · 相符的 token 放行", async () => {
  mockVerify(BOT_CHANNEL);
  const uid = await verifyLiffAccessToken("tok", BOT_CHANNEL);
  assert.equal(uid, "Utest0000000000000000000000000000");
});

test("未帶 expectedChannelId 時 · 退回 env 允許清單（既有客戶維持原行為）", async () => {
  mockVerify(ENV_CHANNEL);
  const uid = await verifyLiffAccessToken("tok");
  assert.equal(uid, "Utest0000000000000000000000000000");
});

test("未帶 expectedChannelId 且不在 env 清單 → 擋", async () => {
  mockVerify("9999999999");
  await assert.rejects(() => verifyLiffAccessToken("tok"), /不是這個組織的/);
});
