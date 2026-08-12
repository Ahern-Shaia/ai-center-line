// 0062 · 平台維運角色可讀所有 bot / 群組 / 租戶，但不可寫
//
// 2026-08-12：通知設定精靈改成「先選機器人」後，以 assistant 登入只看到一支 bot。
// line_bot / line_group / tenants 的逃生門是 aiproot_admin/consultant/system，獨缺 assistant，
// 而 assistant 正是「協助管通知設定」那個角色（0050）。
//
// ⚠️ 這是 RLS 靜默過濾的典型症狀：下拉不是空的、只是少了幾支，
//    看起來像「我們只有一支 bot」而不像權限問題。
//
// 釘住兩件事：① assistant 讀得到全部 ② assistant 仍然改不了任何一支

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";
import { withTenant, closeDb } from "../src/db/client.js";

const T_OWN = "dd000000-0000-4000-8000-00000000dd01";   // assistant 自己的租戶
const T_OTHER = "dd000000-0000-4000-8000-00000000dd02"; // 別家
const BOT_OWN = "dd000000-0000-4000-8000-0000000000a1";
const BOT_OTHER = "dd000000-0000-4000-8000-0000000000b1";

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

/** 以某角色跑查詢 · current_tenant 一律設成「自己家」 */
const asRole = <T>(role: string, fn: Parameters<typeof withTenant>[1]) =>
  withTenant({ tenantId: T_OWN, role: role as never }, fn) as Promise<T>;

before(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T_OWN, T_OTHER]) {
    await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);
    await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,$2)`, [t, `POR-${t.slice(-4)}`]);
  }
  const mkBot = (id: string, t: string, name: string, uid: string) => c.query(
    `INSERT INTO line_bot (bot_id, tenant_id, kind, name, bot_user_id, channel_secret_enc, channel_access_token_enc)
     VALUES ($1,$2,'analysis',$3,$4,'\\x00'::bytea,'\\x00'::bytea)`, [id, t, name, uid]);
  await mkBot(BOT_OWN, T_OWN, "自家機器人", "Udd0000000000000000000000000000a1");
  await mkBot(BOT_OTHER, T_OTHER, "別家機器人", "Udd0000000000000000000000000000b1");
  await c.query(
    `INSERT INTO line_group (bot_id, group_id, first_seen_at, last_event_at, event_count, status)
     VALUES ($1,$2,now(),now(),1,'active')`, [BOT_OTHER, "Cddothergroup00000000000000000001"]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T_OWN, T_OTHER]) await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);
  await c.end();
  await closeDb();
});

const countBots = (role: string) => asRole<number>(role, async (tx) => {
  const r = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM line_bot WHERE bot_id IN (${BOT_OWN}::uuid, ${BOT_OTHER}::uuid)`);
  return r.rows[0]?.n ?? 0;
});

test("⭐⭐ assistant 讀得到別家的 bot（通知設定要挑發送機器人）", async () => {
  assert.equal(await countBots("assistant"), 2);
});

test("⭐ tenant_admin 仍然只看得到自己家的（沒有被順手放寬）", async () => {
  assert.equal(await countBots("tenant_admin"), 1, "客戶端不可以看到別家的機器人");
});

test("⭐⭐ assistant 讀得到別家的群組（群組清單依 bot 過濾，看不到就選不了）", async () => {
  const n = await asRole<number>("assistant", async (tx) => {
    const r = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM line_group WHERE bot_id = ${BOT_OTHER}::uuid`);
    return r.rows[0]?.n ?? 0;
  });
  assert.equal(n, 1);
});

test("⭐ assistant 讀得到別家的租戶名（否則下拉分不出哪一家）", async () => {
  const n = await asRole<number>("assistant", async (tx) => {
    const r = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM tenants WHERE tenant_id = ${T_OTHER}::uuid`);
    return r.rows[0]?.n ?? 0;
  });
  assert.equal(n, 1);
});

test("⭐⭐ assistant 改不了別家的 bot（新 policy 只開 SELECT）", async () => {
  const affected = await asRole<number>("assistant", async (tx) => {
    const r = await tx.execute(sql`
      UPDATE line_bot SET name = '被改掉了' WHERE bot_id = ${BOT_OTHER}::uuid RETURNING bot_id`);
    return r.rows.length;
  });
  assert.equal(affected, 0, "讀得到不等於改得動 —— 寫入仍受原本的租戶隔離管");
});
