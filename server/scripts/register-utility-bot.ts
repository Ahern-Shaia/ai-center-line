// 登錄「群組 ID 小幫手」utility bot（group-id-onboarding M1）。
//
// 為什麼要有這支：加密用的 key 若跟目標環境 server 的 LINE_CONFIG_ENC_KEY 不一致，
// webhook 會**靜默**解不開密鑰、bot 完全沒反應、且不報錯（RLS/pgp 的老坑）。
// 手貼 SQL 很容易踩到。本腳本用你指定的 key 加密後**再讀回解密比對**，
// key 不對就當場報錯，把「靜默失敗」變成「大聲失敗」。
//
// 用法（本機測試 DB）：
//   node --import tsx --env-file=.env scripts/register-utility-bot.ts \
//     --name "群組 ID 小幫手" --botUserId U... --secret <channel secret> --token <access token>
//
// 用法（prod · CLAUDE.md R10 由人執行）：把 DB 與 key 指向 prod —
//   REGISTER_DB_URL="$PROD_DATABASE_URL" LINE_CONFIG_ENC_KEY="<prod 那把>" \
//   node --import tsx scripts/register-utility-bot.ts --botUserId U... --secret ... --token ...
//   （prod 的 LINE_CONFIG_ENC_KEY 是 Render 上那一個，不是本機 .env 的）
import pg from "pg";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function die(msg: string): never { console.error(`❌ ${msg}`); process.exit(1); }

const name = arg("name") ?? "群組 ID 小幫手";
const botUserId = arg("botUserId");
const secret = arg("secret");
const token = arg("token");
const key = process.env.LINE_CONFIG_ENC_KEY;
const dbUrl = process.env.REGISTER_DB_URL ?? process.env.DATABASE_URL;

if (!dbUrl) die("缺 DB 連線：設 REGISTER_DB_URL 或 DATABASE_URL（本機用 --env-file=.env）");
if (!key) die("缺 LINE_CONFIG_ENC_KEY —— 必須是『目標環境 server』那一把，否則 webhook 解不開");
if (!botUserId || !secret || !token) {
  die("用法：--botUserId U... --secret <channel secret> --token <access token> [--name <名稱>]");
}
if (!botUserId.startsWith("U")) die("botUserId 應以 U 開頭（LINE Developers → Messaging API → Bot user ID）");

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
});
const client = await pool.connect();
try {
  await client.query(`SET app.actor_role = 'system'`);           // line_bot RLS 放行 system

  // ⭐ 真正的 key 驗證：拿一支「既有 bot」（用 server 真正的 key 加密的）試著用這把 key 解。
  //    解不開＝這把 key 跟這個環境的 server 對不上 → 現在就擋，別讓 webhook 靜默失敗。
  //    （不能只靠「自己加密再自己解」——那用錯的 key 也會通過，是假的安心。）
  const probe = await client.query<{ enc: string }>(
    `SELECT channel_secret_enc AS enc FROM line_bot
      WHERE channel_secret_enc IS NOT NULL AND bot_user_id <> $1 LIMIT 1`, [botUserId]);
  if (probe.rows[0]) {
    try {
      await client.query(`SELECT pgp_sym_decrypt($1, $2)::text`, [probe.rows[0].enc, key]);
      console.log("✓ key 交叉驗證通過（能解開既有 bot 的密鑰＝跟本環境 server 同一把）");
    } catch {
      die("這把 LINE_CONFIG_ENC_KEY 解不開資料庫既有 bot 的密鑰 —— key 跟本環境 server 對不上。\n" +
          "   prod 請用 Render 上那一把，不是本機 .env 的。");
    }
  } else {
    console.log("⚠ 資料庫沒有其他既有 bot 可交叉驗證 key —— 無法確認這把 key 是否與 server 一致，請自行確認。");
  }

  const existing = await client.query<{ bot_id: string }>(
    `SELECT bot_id::text FROM line_bot WHERE bot_user_id = $1 LIMIT 1`, [botUserId]);

  let botId: string;
  if (existing.rows[0]) {
    // 同一 bot 已存在 → 更新（換密鑰／重跑時走這條）
    await client.query(
      `UPDATE line_bot SET kind='utility', tenant_id=NULL, status='active', name=$2,
         channel_secret_enc = pgp_sym_encrypt($3, $4),
         channel_access_token_enc = pgp_sym_encrypt($5, $4),
         updated_at = now()
       WHERE bot_user_id = $1`,
      [botUserId, name, secret, key, token]);
    botId = existing.rows[0].bot_id;
    console.log(`ℹ 已存在同一 bot_user_id → 更新（bot_id=${botId}）`);
  } else {
    const r = await client.query<{ bot_id: string }>(
      `INSERT INTO line_bot (tenant_id, name, bot_user_id, kind, channel_secret_enc, channel_access_token_enc, status)
       VALUES (NULL, $1, $2, 'utility', pgp_sym_encrypt($3, $5), pgp_sym_encrypt($4, $5), 'active')
       RETURNING bot_id::text`,
      [name, botUserId, secret, token, key]);
    botId = r.rows[0].bot_id;
  }

  const v = await client.query<{ kind: string; tenant_id: string | null }>(
    `SELECT kind, tenant_id::text FROM line_bot WHERE bot_id = $1::uuid`, [botId]);
  const row = v.rows[0];
  if (row?.kind !== "utility" || row.tenant_id !== null) {
    die(`登錄後狀態不符（kind=${row?.kind} tenant_id=${row?.tenant_id}）· 應為 utility / NULL`);
  }

  console.log(`✅ utility bot 已登錄 · bot_id=${botId} · kind=utility · tenant=（無，平台層）`);
  console.log(`   下一步（LINE console）：`);
  console.log(`   1) Webhook URL 設成 https://<你們網域>/line/webhook 並開 Use webhook`);
  console.log(`   2) 開「Allow bot to join group chats」`);
  console.log(`   3) 關掉自動回覆 / 加好友歡迎訊息（改由 webhook 控制）`);
  console.log(`   4) 把 bot 加進測試群 → 應立刻收到含群組 ID 的歡迎訊息`);
} finally {
  client.release();
  await pool.end();
}
