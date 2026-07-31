// line_bot.kind · utility（群組 ID 小幫手）vs analysis 的讀取 plumbing
//
// 前端「LINE 機器人管理」頁靠 getById / listByTenant 顯示 bot，並用 tenantId 對租戶名。
// utility bot 是平台層、tenant_id 為 NULL、kind='utility'。這支守：
//   ① kind 有正確帶出來（否則前端分不出哪個是小幫手）
//   ② utility 的 tenantId 是 null（前端要顯示「平台層」而非拿 null 去對租戶名炸掉）
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withSystemTx } from "../src/db/client.js";
import { LineBotRepository } from "../src/line-ingest/line-bot.repository.js";

const repo = new LineBotRepository();
const TENANT = "77777777-0000-0000-0000-000000000001";  // 同 line-bot-disabled 用的既有測試租戶

async function seed(kind: "analysis" | "utility"): Promise<string> {
  const key = process.env.LINE_CONFIG_ENC_KEY;
  if (!key) throw new Error("測試需要 LINE_CONFIG_ENC_KEY");
  const botUserId = `Ukind${randomUUID().replace(/-/g, "").slice(0, 27)}`;
  const tenant = kind === "utility" ? "NULL" : `'${TENANT}'::uuid`;
  return withSystemTx(async (tx) => {
    const r = await tx.execute<{ bot_id: string }>(sql`
      INSERT INTO line_bot (tenant_id, kind, name, bot_user_id, channel_secret_enc, channel_access_token_enc, status)
      VALUES (${sql.raw(tenant)}, ${kind}, ${`測試-${kind}`}, ${botUserId},
              pgp_sym_encrypt('s', ${key}), pgp_sym_encrypt('t', ${key}), 'active')
      RETURNING bot_id::text`);
    return r.rows[0].bot_id;
  });
}

const drop = (botId: string) =>
  withSystemTx((tx) => tx.execute(sql`DELETE FROM line_bot WHERE bot_id = ${botId}::uuid`));

test("⭐ utility bot · getById 回 kind=utility 且 tenantId=null", async () => {
  const botId = await seed("utility");
  try {
    const row = await withSystemTx((tx) => repo.getById(tx, botId));
    assert.ok(row);
    assert.equal(row!.kind, "utility");
    assert.equal(row!.tenantId, null, "utility bot 不屬租戶 · tenantId 必須是 null");
  } finally { await drop(botId); }
});

test("analysis bot · getById 回 kind=analysis 且帶 tenantId", async () => {
  const botId = await seed("analysis");
  try {
    const row = await withSystemTx((tx) => repo.getById(tx, botId));
    assert.equal(row!.kind, "analysis");
    assert.equal(row!.tenantId, TENANT);
  } finally { await drop(botId); }
});

test("listByTenant 兩種 bot 都在，且 kind 正確", async () => {
  const u = await seed("utility");
  const a = await seed("analysis");
  try {
    const rows = await withSystemTx((tx) => repo.listByTenant(tx));
    const uRow = rows.find((r) => r.botId === u);
    const aRow = rows.find((r) => r.botId === a);
    assert.equal(uRow?.kind, "utility");
    assert.equal(uRow?.tenantId, null);
    assert.equal(aRow?.kind, "analysis");
  } finally { await drop(u); await drop(a); }
});
