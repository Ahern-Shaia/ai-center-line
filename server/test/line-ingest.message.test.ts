// convo-analysis-realtime M1 · 訊息落庫 + RLS 隔離測試 · 走 Docker Postgres
// 覆蓋 4 個 case：
// 1. insertOnEvent 冪等（同 messageId 二次不重覆）
// 2. 未綁 tenant 的 group 訊息不落庫（webhook 層擋）
// 3. RLS 阻擋跨租戶 SELECT
// 4. MediaStorageService 未設定 env 時 enabled=false（防禦性 gate）

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";
import {
  withTenant,
  withSystemTx,
  txStore,
  closeDb,
} from "../src/db/client.js";
import { LineMessageRepository } from "../src/line-ingest/line-message.repository.js";
import { LineGroupRepository } from "../src/line-ingest/line-group.repository.js";
import { MediaStorageService } from "../src/line-ingest/media-storage.service.js";

const T_A = "55555555-aaaa-aaaa-aaaa-555555555551";
const T_B = "55555555-bbbb-bbbb-bbbb-555555555552";
const BOT_A = "bb000000-0000-0000-0000-000000000a01";
const BOT_B = "bb000000-0000-0000-0000-000000000b02";
const DEPT_A = "dd000000-0000-0000-0000-000000000a01";
const GROUP_ID_A = "Ctestrealtimemessage000000000001";
const GROUP_ID_UNBOUND = "Ctestrealtimemessage000000000002";
const MSG_1 = "msgtest-realtime-msg-000000000001";
const MSG_2 = "msgtest-realtime-msg-000000000002";

const messageRepo = new LineMessageRepository();
const groupRepo = new LineGroupRepository();

before(async () => {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();

  await c.query(`SET session_replication_role = replica`);
  await c.query(`DELETE FROM line_message WHERE tenant_id IN ($1, $2)`, [T_A, T_B]);
  await c.query(`DELETE FROM line_group WHERE bot_id IN ($1, $2)`, [BOT_A, BOT_B]);
  await c.query(`DELETE FROM line_bot WHERE bot_id IN ($1, $2)`, [BOT_A, BOT_B]);
  await c.query(`DELETE FROM departments WHERE department_id = $1`, [DEPT_A]);
  await c.query(`DELETE FROM tenants WHERE tenant_id IN ($1, $2)`, [T_A, T_B]);
  await c.query(`SET session_replication_role = origin`);

  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'CAR-T-A'),($2,'CAR-T-B')`, [T_A, T_B]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1, $2, 'dept-A', 'GA', 's', 'R')`,
    [DEPT_A, T_A],
  );
  // 兩個 bot 分屬兩 tenant
  const encKey = process.env.LINE_CONFIG_ENC_KEY ?? "test-only-line-enc-key-32chars---";
  await c.query(
    `INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_secret_enc, channel_access_token_enc)
     VALUES ($1, $2, 'bot-A', 'U_bot_A_test_realtime', pgp_sym_encrypt('sec-A', $3), pgp_sym_encrypt('tok-A', $3)),
            ($4, $5, 'bot-B', 'U_bot_B_test_realtime', pgp_sym_encrypt('sec-B', $3), pgp_sym_encrypt('tok-B', $3))`,
    [BOT_A, T_A, encKey, BOT_B, T_B],
  );
  // Group A 綁 tenant_A + dept_A（透過 bot_id → line_bot.tenant_id）· dept assign 直接 update
  await c.query(
    `INSERT INTO line_group (bot_id, group_id, department_id, analyze_enabled)
     VALUES ($1, $2, $3, false),
            ($1, $4, NULL, false)`,   // Unbound group 沒 dept 也沒有直接 tenant_id 欄 · tenant 從 bot 拉
    [BOT_A, GROUP_ID_A, DEPT_A, GROUP_ID_UNBOUND],
  );

  await c.end();
});

after(async () => {
  await closeDb();
});

// 1. insertOnEvent 冪等
test("insertOnEvent 冪等 · 同 messageId 二次只 insert 一次", async () => {
  const ctx = { tenantId: T_A, role: "tenant_admin" as const };
  const args = {
    messageId: MSG_1,
    tenantId: T_A,
    botId: BOT_A,
    groupId: GROUP_ID_A,
    departmentId: DEPT_A,
    senderLineId: "Utest_sender_001",
    messageType: "text",
    textContent: "第一次 · 落一筆",
    stickerRef: null,
    sentAtMs: 1721539200000,   // 2024-07-21T00:00Z 固定
    rawEvent: { type: "message" as const, test: true },
  };
  const r1 = await withTenant(ctx, (tx) => txStore.run(tx, () => messageRepo.insertOnEvent(tx, args)));
  assert.equal(r1.inserted, true);
  const r2 = await withTenant(ctx, (tx) => txStore.run(tx, () => messageRepo.insertOnEvent(tx, args)));
  assert.equal(r2.inserted, false, "同 messageId 二次應回 inserted=false");

  const rows = await withSystemTx((tx) => tx.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM line_message WHERE message_id = ${MSG_1}
  `));
  assert.equal(rows.rows[0].n, "1", "DB 只該有 1 row");
});

// 2. 未綁 tenant 的 group 訊息不落庫（透過 groupRepo.getRefForMessage 判斷）
test("未綁 tenant 的 group · getRefForMessage 回的 tenantId 反映實際 bot tenant · 不落訊息由呼叫端擋", async () => {
  // 特別情境：即使 group 存在但沒 dept · 只要 bot 有綁 tenant · tenantId 就有值
  // 這 test 驗證的是 groupRepo 契約 · 讓 webhook service 能正確判斷
  const ctx = { tenantId: T_A, role: "tenant_admin" as const };
  const ref = await withTenant(ctx, (tx) => txStore.run(tx, () => groupRepo.getRefForMessage(tx, BOT_A, GROUP_ID_UNBOUND)));
  assert.ok(ref, "已在 line_group 表存在 · getRefForMessage 不該 null");
  assert.equal(ref!.tenantId, T_A, "tenant 從 bot 拉 · bot A 屬 T_A");
  assert.equal(ref!.departmentId, null, "此 group 未分派 dept");

  // 不存在的 group → null · webhook 就會 continue 掉
  const missing = await withTenant(ctx, (tx) => txStore.run(tx, () => groupRepo.getRefForMessage(tx, BOT_A, "Cnonexistent-group-9999999999")));
  assert.equal(missing, null, "不存在的 group · getRefForMessage 應回 null");
});

// 3. RLS 阻擋跨租戶 SELECT
test("RLS · tenant_admin 看不到別 tenant 的 line_message (P0 test)", async () => {
  // T_A 落一筆
  const argsA = {
    messageId: MSG_2,
    tenantId: T_A,
    botId: BOT_A,
    groupId: GROUP_ID_A,
    departmentId: DEPT_A,
    senderLineId: null,
    messageType: "text",
    textContent: "T_A only",
    stickerRef: null,
    sentAtMs: 1721539210000,
    rawEvent: { type: "message" as const },
  };
  await withSystemTx((tx) => messageRepo.insertOnEvent(tx, argsA));

  // T_A 看得到自己的訊息
  const asT_A = await withTenant({ tenantId: T_A, role: "tenant_admin" as const }, (tx) => txStore.run(tx, () =>
    tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM line_message WHERE message_id = ${MSG_2}`)));
  assert.equal(asT_A.rows[0].n, "1", "T_A 應看得到自己的訊息");

  // T_B 看不到（RLS 阻擋）
  const asT_B = await withTenant({ tenantId: T_B, role: "tenant_admin" as const }, (tx) => txStore.run(tx, () =>
    tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM line_message WHERE message_id = ${MSG_2}`)));
  assert.equal(asT_B.rows[0].n, "0", "T_B 應看不到 T_A 的訊息 · RLS 擋掉");
});

// 4. MediaStorageService · S3 未設定 env 時 enabled=false（防禦性 gate）
test("MediaStorageService · S3 env 未設 · enabled=false 且 put 不炸", async () => {
  const saved = {
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  };
  delete process.env.S3_BUCKET;
  delete process.env.S3_REGION;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;

  try {
    const svc = new MediaStorageService();
    assert.equal(svc.enabled, false, "未設 env 應 enabled=false");
    assert.equal(svc.makeKey(T_A, MSG_1), `${T_A}/${MSG_1}`, "makeKey 應仍能組出 key（純字串）");
    // put 未 enabled 時應 throw (呼叫端需先 check enabled)
    await assert.rejects(() => svc.put("k", Buffer.from("x"), "text/plain"), /S3 未設定/);
  } finally {
    if (saved.S3_BUCKET !== undefined) process.env.S3_BUCKET = saved.S3_BUCKET;
    if (saved.S3_REGION !== undefined) process.env.S3_REGION = saved.S3_REGION;
    if (saved.S3_ACCESS_KEY_ID !== undefined) process.env.S3_ACCESS_KEY_ID = saved.S3_ACCESS_KEY_ID;
    if (saved.S3_SECRET_ACCESS_KEY !== undefined) process.env.S3_SECRET_ACCESS_KEY = saved.S3_SECRET_ACCESS_KEY;
  }
});
