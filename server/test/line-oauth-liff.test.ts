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
  await assert.rejects(() => svc.handleLiffToken("tok"), /不是這個組織的/);
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

// ─────────────────────────────────────────────────────────────
// 2026-08-28 · LIFF 的語言必須由伺服器決定
//
// 實機事故：台灣福祉的員工打開打卡頁，**整頁是英文的**。
// LIFF 以前完全沒有語言來源，只靠前端 `detect()`：
// `localStorage` → `navigator.language` —— 兩個都是**裝置狀態**，跟這個人是誰無關。
// 同一支手機先前在 LINE 內建瀏覽器把 demo 站切成英文，`aiproot.locale=en`
// 留在 localStorage；LIFF 同 origin 就吃到了。
//
// **工廠員工看不懂的打卡頁 = 那個功能等於沒有。**
// ─────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("⭐⭐ LIFF token 交換必須回傳 locale（不然前端只能靠裝置猜）", () => {
  const src = read("../src/auth/line-oauth.service.ts");
  assert.match(src, /export interface LineLoginResult \{[^}]*locale/,
    "LineLoginResult 沒有 locale —— LIFF 就沒有伺服器端的語言來源");
  assert.match(src, /u\.locale/, "resolveBindings 沒撈 users.locale");
  assert.match(src, /b\.locale === "en" \|\| b\.locale === "zh-TW" \? b\.locale : "zh-TW"/,
    "locale 沒設或值不認得時要落 zh-TW（migration 0071 的 DEFAULT），不可回退成前端自己猜");
});

test("⭐⭐ 前端 applyLiffToken 必須套用回來的 locale", () => {
  const api = read("../../web/src/api.ts");
  const fn = api.slice(api.indexOf("export async function applyLiffToken"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /setLocale\(d\.locale\)/,
    "applyLiffToken 拿到 locale 卻沒套用 —— 伺服器算了也是白算");
});

test("⭐⭐ LIFF 頁的語言不可以只由裝置決定（detect 只能當 fallback）", () => {
  // detect() 本身沒問題，問題是「只有 detect()」。
  // 這支釘住「LIFF 這條路上存在一個伺服器來源」，避免日後有人把上面那行拿掉。
  const main = read("../../web/src/liff/main.tsx");
  assert.match(main, /applyLiffToken/, "LIFF 沒有走 token 交換 → 沒有伺服器端語言來源");
});
