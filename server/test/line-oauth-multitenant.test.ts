// 一人多租戶 LINE 登入 · 修 2026-08-03 跨租戶身分解析洞（Patrick 的 LINE 綁台灣福祉+鮮湧，
// 舊版取「最近綁定」→ 從台灣福祉 bot 開卻登入成鮮湧）。用真 DB 種跨租戶綁定。
//
// A：LIFF 用 botId 綁死租戶（確定性）。
// B：網頁登入多綁 → 回選單 + selectionToken（內含已驗證 lineUserId、防偽造）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LineOauthService } from "../src/auth/line-oauth.service.js";
import { closeDb } from "../src/db/client.js";

const TA = "c1a00000-0000-4000-8000-0000000000a1";   // 租戶 A
const TB = "c1a00000-0000-4000-8000-0000000000b2";   // 租戶 B
const UA = "c1a00000-0000-4000-8000-0000000000c1";   // A 的 user
const UB = "c1a00000-0000-4000-8000-0000000000d2";   // B 的 user
const BOT_A = "c1a00000-0000-4000-8000-00000000b0a1";
const BOT_B = "c1a00000-0000-4000-8000-00000000b0b2";
const LINE_UID = "Umultitenanttestuser000000000001";

// jwt stub：signAsync 回 payload 的 JSON（好斷言選到誰）；verifyAsync 回預設 selection payload（測 B 用）
let verifyReturn: unknown = { purpose: "tenant-select", line_user_id: LINE_UID };
const jwtStub = {
  signAsync: async (payload: unknown) => JSON.stringify(payload),
  verifyAsync: async () => verifyReturn,
} as never;
const svc = new LineOauthService(jwtStub, {} as never);

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

before(async () => {
  const c = admin();
  await c.connect();
  for (const t of [TA, TB]) {
    await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]);
    await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,$2)`, [t, `MT-${t.slice(-2)}`]);
  }
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email) VALUES
    ($1,$2,'employee','A員工','ua@mt.test'), ($3,$4,'tenant_admin','B總經理','ub@mt.test')`,
    [UA, TA, UB, TB]);
  // line_bot（bot 隸屬租戶 · binding FK 到它）· 同一 line_user 綁到兩個 bot（兩租戶）
  await c.query(`INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_id, channel_secret_enc, channel_access_token_enc, status, kind)
    VALUES ($1,$2,'BotA','UbotA','ch-a','x','x','active','analysis'),
           ($3,$4,'BotB','UbotB','ch-b','x','x','active','analysis')`,
    [BOT_A, TA, BOT_B, TB]);
  // 綁定：A 先、B 後（B 較新 → 舊版會誤取 B）
  await c.query(`INSERT INTO user_line_binding (user_id, bot_id, line_user_id, binding_method, status, bound_at)
    VALUES ($1,$2,$3,'aiproot_manual','active', now() - interval '2 days'),
           ($4,$5,$3,'aiproot_manual','active', now())`,
    [UA, BOT_A, LINE_UID, UB, BOT_B]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM user_line_binding WHERE line_user_id=$1`, [LINE_UID]);
  await c.query(`DELETE FROM line_bot WHERE bot_id = ANY($1)`, [[BOT_A, BOT_B]]);
  for (const t of [TA, TB]) await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]);
  await c.end();
  await closeDb();
});

// verifyLiffAccessToken 走 fetch · mock 成回我們的 LINE_UID
function mockLineFetch() {
  const orig = globalThis.fetch;
  process.env.LINE_LOGIN_CHANNEL_ID = "111";
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    const json = url.includes("/verify")
      ? { client_id: "111", expires_in: 3600 }
      : { userId: LINE_UID };
    return { ok: true, status: 200, json: async () => json, text: async () => "" } as unknown as Response;
  }) as typeof globalThis.fetch;
  return () => { globalThis.fetch = orig; };
}

test("⭐⭐ A · LIFF 帶 botId → 登入到那個 bot 所屬租戶（不取最近綁定）", async () => {
  const restore = mockLineFetch();
  try {
    const rA = await svc.handleLiffToken("tok", BOT_A);
    const pA = JSON.parse(rA.access_token);
    assert.equal(pA.tenant_id, TA, "從 bot A 開 → 租戶 A");
    assert.equal(pA.user_id, UA);

    const rB = await svc.handleLiffToken("tok", BOT_B);
    const pB = JSON.parse(rB.access_token);
    assert.equal(pB.tenant_id, TB, "從 bot B 開 → 租戶 B（即使綁定較新的是它，也是靠 bot 而非時間決定）");
    assert.equal(pB.user_id, UB);
  } finally { restore(); }
});

test("⭐⭐ A · botId 不在此人的綁定內 → 401（不放行到沒綁的組織）", async () => {
  const restore = mockLineFetch();
  try {
    await assert.rejects(() => svc.handleLiffToken("tok", "c1a00000-0000-4000-8000-00000000b099"), /未綁定到這個組織/);
  } finally { restore(); }
});

test("A · 舊版前端沒帶 botId → 退回最近綁定（相容 · 不炸）", async () => {
  const restore = mockLineFetch();
  try {
    const r = await svc.handleLiffToken("tok");
    const p = JSON.parse(r.access_token);
    assert.equal(p.tenant_id, TB, "沒 botId 時退回最近綁定（B）");
  } finally { restore(); }
});

test("⭐⭐ B · selectTenant 用簽章 token 選到正確租戶", async () => {
  verifyReturn = { purpose: "tenant-select", line_user_id: LINE_UID };
  const r = await svc.selectTenant("sel.tok", TA);
  const p = JSON.parse(r.access_token);
  assert.equal(p.tenant_id, TA);
  assert.equal(p.user_id, UA);
});

test("⭐⭐ B · selectTenant 選一個沒綁的租戶 → 擋（防偽造挑別人的租戶）", async () => {
  verifyReturn = { purpose: "tenant-select", line_user_id: LINE_UID };
  await assert.rejects(() => svc.selectTenant("sel.tok", "c1a00000-0000-4000-8000-0000000000ff"), /沒有帳號/);
});

test("⭐⭐ B · selectionToken purpose 不對 → 擋（不能拿別種 token 換登入）", async () => {
  verifyReturn = { purpose: "not-tenant-select", line_user_id: LINE_UID };
  await assert.rejects(() => svc.selectTenant("sel.tok", TA), /無效的組織選擇/);
});
