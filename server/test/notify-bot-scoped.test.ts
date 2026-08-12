// 通知規則綁定發送 bot（0061）· docs/modules/notify-bot-scoped-target.md
//
// 2026-08-12 鮮湧事故：規則指向鮮湧AI客服的群，卻用全域 env token 那支 bot 發送 → 400
// 「Failed to send messages」。排查困難是因為 LINE 的群組 ID **依 bot 發放**，
// 「群 ID 正確」和「這支 bot 送得到那個群」是兩件事，畫面上看不出差別。
//
// 這裡釘住的不變量：**規則存的 bot 與目標群必須是同一支**。
// 讓錯誤在存檔當下就被擋下，而不是等真實事件發生才 400。

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withSystemTx, closeDb } from "../src/db/client.js";
import { NotifyConfigRepository } from "../src/notify-config/notify-config.repository.js";

const repo = new NotifyConfigRepository();

const T = "cc000000-0000-4000-8000-00000000cc01";
const BOT_A = "cc000000-0000-4000-8000-0000000000a1";
const BOT_B = "cc000000-0000-4000-8000-0000000000b1";
const GROUP_A = "Cccbotatestgroup0000000000000001";   // 只在 BOT_A 底下
const GROUP_B = "Cccbotbtestgroup0000000000000002";   // 只在 BOT_B 底下

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'NBT-TEST')`, [T]);
  for (const [id, name, uid] of [[BOT_A, "A機器人", "Uccbota000000000000000000000000a"],
                                 [BOT_B, "B機器人", "Uccbotb000000000000000000000000b"]]) {
    await c.query(
      `INSERT INTO line_bot (bot_id, tenant_id, kind, name, bot_user_id, channel_secret_enc, channel_access_token_enc)
       VALUES ($1,$2,'analysis',$3,$4,'\\x00'::bytea,'\\x00'::bytea)`, [id, T, name, uid]);
  }
  const mkGroup = (bot: string, gid: string) => c.query(
    `INSERT INTO line_group (bot_id, group_id, first_seen_at, last_event_at, event_count, status)
     VALUES ($1,$2,now(),now(),1,'active')`, [bot, gid]);
  await mkGroup(BOT_A, GROUP_A);
  await mkGroup(BOT_B, GROUP_B);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.end();
  await closeDb();
});

test("⭐⭐ 群組屬於該 bot → 通過", async () => {
  const ok = await withSystemTx((tx) => repo.groupBelongsToBot(tx, BOT_A, GROUP_A));
  assert.equal(ok, true);
});

test("⭐⭐ 群組屬於別支 bot → 擋下（這正是鮮湧 400 的形狀）", async () => {
  const ok = await withSystemTx((tx) => repo.groupBelongsToBot(tx, BOT_A, GROUP_B));
  assert.equal(ok, false, "A 機器人不在 B 的群裡 —— 存進去只是把 400 延後到真實事件");
});

test("⭐ 群組不存在 → 擋下", async () => {
  const ok = await withSystemTx((tx) => repo.groupBelongsToBot(tx, BOT_A, "Cnotexist0000000000000000000000x"));
  assert.equal(ok, false);
});

test("⭐ 已離開的群 → 擋下（送過去也是 400）", async () => {
  const c = admin();
  await c.connect();
  await c.query(`UPDATE line_group SET status='left' WHERE bot_id=$1 AND group_id=$2`, [BOT_A, GROUP_A]);
  await c.end();
  try {
    const ok = await withSystemTx((tx) => repo.groupBelongsToBot(tx, BOT_A, GROUP_A));
    assert.equal(ok, false);
  } finally {
    const c2 = admin();
    await c2.connect();
    await c2.query(`UPDATE line_group SET status='active' WHERE bot_id=$1 AND group_id=$2`, [BOT_A, GROUP_A]);
    await c2.end();
  }
});
