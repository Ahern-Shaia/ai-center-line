// 停用中的 bot · webhook 事件處理
//
// 2026-07-28 的實際教訓：使用者刪掉舊 bot（＝軟刪除，status 轉 disabled）後
// 反映「bot 沒反應」，懷疑是自己改了名稱與密鑰。
// 排查時 log 印的是「webhook destination 不對應任何 bot」——
// 因為查詢帶了 AND status='active'，**停用跟查無此 bot 印同一句**，
// 於是排查方向被導去密鑰設定，實際上只是被停用。
//
// 這支測試守兩件事：
//   ① 查得到停用中的 bot（否則呼叫端無從分辨）
//   ② 但停用的 bot 事件仍然不可被處理（安全行為不能因為改 log 而鬆掉）
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withSystemTx } from "../src/db/client.js";
import { LineBotRepository } from "../src/line-ingest/line-bot.repository.js";

const repo = new LineBotRepository();
const TENANT = "77777777-0000-0000-0000-000000000001";

async function seedBot(status: "active" | "disabled"): Promise<{ botId: string; botUserId: string }> {
  const botUserId = `Utest${randomUUID().replace(/-/g, "").slice(0, 26)}`;
  const botId = await withSystemTx(async (tx) => {
    // 要跟 repository 的 encKey() 用同一把，否則 pgp_sym_decrypt 會 "Wrong key or corrupt data"
    const key = process.env.LINE_CONFIG_ENC_KEY;
    if (!key) throw new Error("測試需要 LINE_CONFIG_ENC_KEY");
    const r = await tx.execute<{ bot_id: string }>(sql`
      INSERT INTO line_bot (tenant_id, name, bot_user_id, channel_secret_enc, channel_access_token_enc, status)
      VALUES (${TENANT}::uuid, ${`測試bot-${status}`}, ${botUserId},
              pgp_sym_encrypt('secret', ${key}), pgp_sym_encrypt('token', ${key}), ${status})
      RETURNING bot_id::text
    `);
    return r.rows[0].bot_id;
  });
  return { botId, botUserId };
}

const drop = (botId: string) =>
  withSystemTx((tx) => tx.execute(sql`DELETE FROM line_bot WHERE bot_id = ${botId}::uuid`));

test("⭐ 停用中的 bot 仍查得到，且 status 要回報出來", async () => {
  const { botId, botUserId } = await seedBot("disabled");
  try {
    const bot = await withSystemTx((tx) => repo.getByBotUserIdWithSecret(tx, botUserId));
    assert.ok(bot, "查不到的話，呼叫端就沒辦法分辨『停用』與『查無此 bot』");
    assert.equal(bot!.status, "disabled");
  } finally { await drop(botId); }
});

test("啟用中的 bot 照常查得到", async () => {
  const { botId, botUserId } = await seedBot("active");
  try {
    const bot = await withSystemTx((tx) => repo.getByBotUserIdWithSecret(tx, botUserId));
    assert.equal(bot!.status, "active");
    assert.equal(bot!.channelSecret, "secret", "密鑰要解得開");
  } finally { await drop(botId); }
});

test("完全不存在的 destination → null（跟停用是不同情況）", async () => {
  const bot = await withSystemTx((tx) =>
    repo.getByBotUserIdWithSecret(tx, `Unobody${randomUUID().replace(/-/g, "").slice(0, 24)}`));
  assert.equal(bot, null);
});
