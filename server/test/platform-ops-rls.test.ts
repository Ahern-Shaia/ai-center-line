// notify 三表的角色白名單 · migration 0050
//
// 這支釘的是一個**已經在 prod 發生過**的事故：
// 0049 把「助理」升格成內建角色，它帶著 notify-config.view / .manage 兩個權限碼。
// 指派給人之後，那個人打開「通知設定」看到「尚無通知規則」—— 但表裡實際有 3 條。
//
// 根因：這三張表的 RLS 是純角色白名單，assistant 不在裡面 → **回 0 列而且不報錯**。
// API 層的權限碼說「你可以看」，DB 層說「這裡沒東西」，兩邊各自都沒錯。
// （本專案第 14 次 RLS 靜默回 0。）
//
// ⚠️ 所以這支測試的價值不在「白名單裡有 assistant」這個事實，
//    而在於**下次有人加內建角色時，會被這裡提醒去看 app_is_platform_ops()**。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { withTenant, closeDb } from "../src/db/client.js";

const RULE_NAME = `RLS-OPS-TEST-${randomUUID().slice(0, 8)}`;
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

/** 用某個角色去數看得到幾條通知規則 */
const rulesVisibleTo = (role: string) =>
  withTenant({ tenantId: null, role: role as never, departmentId: null, userId: null }, async (tx) => {
    const r = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM notification_rule WHERE name = ${RULE_NAME}`);
    return r.rows[0].n;
  });

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(
    `INSERT INTO notification_rule (name, enabled, source_type, source_config, webhook_token,
                                    template, channel_type, channel_target)
     VALUES ($1, true, 'ragic_form', '{}'::jsonb, $2, '{}'::jsonb, 'line_group', 'C_test')`,
    [RULE_NAME, `tok_${randomUUID().slice(0, 12)}`]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM notification_rule WHERE name = $1`, [RULE_NAME]);
  await c.end();
  await closeDb();
});

test("⭐⭐ 助理看得到通知設定（0049 之後、0050 之前是 0 —— 空清單且不報錯）", async () => {
  assert.equal(
    await rulesVisibleTo("assistant"), 1,
    "⚠️ 助理有 notify-config 權限碼卻查不到資料 —— 角色白名單 app_is_platform_ops() 漏了它",
  );
});

test("⭐ 平台維運角色都看得到", async () => {
  for (const role of ["aiproot_admin", "consultant", "system"]) {
    assert.equal(await rulesVisibleTo(role), 1, `${role} 應該看得到`);
  }
});

test("⭐⭐ 租戶側角色看不到 —— 這三張表是 aiproot 全域設定，不是租戶資料", async () => {
  for (const role of ["tenant_admin", "group_owner", "employee"]) {
    assert.equal(
      await rulesVisibleTo(role), 0,
      `⚠️ ${role} 看得到 aiproot 的通知規則與 Ragic 帳號設定 —— 白名單放太寬`,
    );
  }
});
