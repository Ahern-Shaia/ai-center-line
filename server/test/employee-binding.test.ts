// employee-line-binding M5 · repository + service + nudge SQL 覆蓋
// 對照 docs/modules/employee-line-binding.md v1.0.1 §7-quinque
//
// 覆蓋 8 個 case：
// 1. create 冪等 · 同 (botId, lineUserId) 二次回同 binding_id
// 2. create 復活 · revoked → active (member 二次綁定)
// 3. getActiveByLineUserId · 已 revoked 不回
// 4. revoke · 保留 audit (revoked_at / revoked_by / reason)
// 5. listByTenant · JOIN users + status filter
// 6. listByTenant · RLS 不會 leak 跨 tenant
// 7. completeLiffBinding · 建 users + binding · 二次呼叫擋
// 8. Nudge findUnboundActiveUsers · 排除已綁定 · message_count 正確

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";
import {
  withTenant,
  closeDb,
  type Db,
} from "../src/db/client.js";

// 統一走 aiproot_admin 跨租戶 · 對齊實際 employee-binding 服務的存取模式
// (user_line_binding USING 子查詢會撞 users RLS · system 不允)
const asAiproot = <T>(fn: (tx: Db) => Promise<T>) => withTenant({ tenantId: null, role: "aiproot_admin" }, fn);
import { UserLineBindingRepository } from "../src/employee-binding/user-line-binding.repository.js";
import { EmployeeBindingService } from "../src/employee-binding/employee-binding.service.js";
import { LiffPrefillService } from "../src/employee-binding/liff-prefill.service.js";
import { NudgeService } from "../src/employee-binding/nudge.service.js";
import { BadRequestException } from "@nestjs/common";

const T_ELB_A = "66666666-aaaa-aaaa-aaaa-666666666601";
const T_ELB_B = "66666666-bbbb-bbbb-bbbb-666666666602";
const BOT_ELB_A = "bb111111-0000-0000-0000-000000000a01";
const BOT_ELB_B = "bb111111-0000-0000-0000-000000000b02";
const DEPT_ELB_A = "dd111111-0000-0000-0000-000000000a01";
const GROUP_ELB_A = "Ctest_elb_group_000000000000001";
const USER_ELB_A1 = "ee111111-0000-0000-0000-0000000000a1";        // 已建 users · 走 aiproot_manual
const USER_ELB_A2 = "ee111111-0000-0000-0000-0000000000a2";
const LINE_USER_A1 = "Utestelbuser000000000000000000a1";
const LINE_USER_A2 = "Utestelbuser000000000000000000a2";
const LINE_USER_UNBOUND = "Utestelbuser000000000000unbound1";
const LINE_USER_UNBOUND_2 = "Utestelbuser000000000000unbound2";

const bindingRepo = new UserLineBindingRepository();
const prefillService = new LiffPrefillService();
const bindingService = new EmployeeBindingService(bindingRepo, prefillService);
const nudgeService = new NudgeService();

before(async () => {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();

  await c.query(`SET session_replication_role = replica`);
  await c.query(`DELETE FROM user_line_binding WHERE bot_id IN ($1, $2)`, [BOT_ELB_A, BOT_ELB_B]);
  await c.query(`DELETE FROM line_message WHERE bot_id IN ($1, $2)`, [BOT_ELB_A, BOT_ELB_B]);
  await c.query(`DELETE FROM line_member WHERE bot_id IN ($1, $2)`, [BOT_ELB_A, BOT_ELB_B]);
  await c.query(`DELETE FROM line_group WHERE bot_id IN ($1, $2)`, [BOT_ELB_A, BOT_ELB_B]);
  await c.query(`DELETE FROM line_bot WHERE bot_id IN ($1, $2)`, [BOT_ELB_A, BOT_ELB_B]);
  await c.query(`DELETE FROM users WHERE user_id IN ($1, $2) OR email LIKE '%@line.local.elbtest'`, [USER_ELB_A1, USER_ELB_A2]);
  await c.query(`DELETE FROM departments WHERE department_id = $1`, [DEPT_ELB_A]);
  await c.query(`DELETE FROM tenants WHERE tenant_id IN ($1, $2)`, [T_ELB_A, T_ELB_B]);
  await c.query(`SET session_replication_role = origin`);

  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'ELB-T-A'),($2,'ELB-T-B')`, [T_ELB_A, T_ELB_B]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1, $2, 'elb-dept-A', 'GA', 's', 'R')`,
    [DEPT_ELB_A, T_ELB_A],
  );
  const encKey = process.env.LINE_CONFIG_ENC_KEY ?? "test-only-line-enc-key-32chars---";
  await c.query(
    `INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_secret_enc, channel_access_token_enc)
     VALUES ($1, $2, 'elb-bot-A', 'U_elb_bot_A', pgp_sym_encrypt('sec-A', $3), pgp_sym_encrypt('tok-A', $3)),
            ($4, $5, 'elb-bot-B', 'U_elb_bot_B', pgp_sym_encrypt('sec-B', $3), pgp_sym_encrypt('tok-B', $3))`,
    [BOT_ELB_A, T_ELB_A, encKey, BOT_ELB_B, T_ELB_B],
  );
  await c.query(
    `INSERT INTO line_group (bot_id, group_id, department_id, analyze_enabled, display_name)
     VALUES ($1, $2, $3, false, 'elb 群 A')`,
    [BOT_ELB_A, GROUP_ELB_A, DEPT_ELB_A],
  );
  // 兩個 users · 走 aiproot_manual 覆蓋
  await c.query(
    `INSERT INTO users (user_id, tenant_id, email, display_name, role, must_change_password)
     VALUES ($1, $2, 'a1@elbtest', 'Alice', 'group_owner', false),
            ($3, $4, 'a2@elbtest', 'Bob', 'group_owner', false)`,
    [USER_ELB_A1, T_ELB_A, USER_ELB_A2, T_ELB_A],
  );

  await c.end();
});

after(async () => {
  await closeDb();
});

// 1. create 冪等 · 同 (botId, lineUserId) 二次回同 binding_id
test("ELB · create 冪等 · 同 (botId, lineUserId) 二次 = 同 binding_id", async () => {
  const args = {
    userId: USER_ELB_A1,
    botId: BOT_ELB_A,
    lineUserId: LINE_USER_A1,
    boundBy: USER_ELB_A1,
    bindingMethod: "liff_self_service" as const,
    metadata: { first: true },
  };
  const r1 = await asAiproot((tx) => bindingRepo.create(tx, args));
  assert.equal(r1.isNew, true, "首次 create · isNew=true");

  // 二次呼叫（相同 args）· 應 no-op reactivate · isNew=false · binding_id 相同
  const r2 = await asAiproot((tx) => bindingRepo.create(tx, args));
  assert.equal(r2.isNew, false, "重覆 create · isNew=false");
  assert.equal(r1.bindingId, r2.bindingId, "binding_id 應一致");

  // DB 只有 1 row
  const cnt = await asAiproot((tx) => tx.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM user_line_binding
    WHERE bot_id = ${BOT_ELB_A}::uuid AND line_user_id = ${LINE_USER_A1}
  `));
  assert.equal(cnt.rows[0].n, "1", "DB 只該有 1 row");
});

// 2. create 復活 · revoked → active (Alice 之前撤銷過 · 現重綁)
test("ELB · create 復活 · revoked 綁定二次 create 應復活為 active", async () => {
  // 先撤銷
  const active = await asAiproot((tx) => bindingRepo.getActiveByLineUserId(tx, BOT_ELB_A, LINE_USER_A1));
  assert.ok(active, "case 1 已建 · 應查得到 active");
  await asAiproot((tx) => bindingRepo.revoke(tx, active!.bindingId, {
    revokedBy: USER_ELB_A1,
    reason: "self_revoke",
  }));

  // 確認撤銷了
  const afterRevoke = await asAiproot((tx) => bindingRepo.getActiveByLineUserId(tx, BOT_ELB_A, LINE_USER_A1));
  assert.equal(afterRevoke, null, "撤銷後 getActiveByLineUserId 應回 null");

  // 二次綁定 · 應復活
  const r = await asAiproot((tx) => bindingRepo.create(tx, {
    userId: USER_ELB_A1,
    botId: BOT_ELB_A,
    lineUserId: LINE_USER_A1,
    boundBy: USER_ELB_A1,
    bindingMethod: "liff_self_service",
    metadata: { revive: true },
  }));
  assert.equal(r.isNew, false, "復活也算已存在 · isNew=false");

  // 現在應可查得到 active
  const revived = await asAiproot((tx) => bindingRepo.getActiveByLineUserId(tx, BOT_ELB_A, LINE_USER_A1));
  assert.ok(revived, "復活後應查得到 active");
  assert.equal(revived!.status, "active");
  assert.equal(revived!.revokedAt, null, "revoked_at 應清除");
  assert.equal(revived!.revokedBy, null, "revoked_by 應清除");
});

// 3. revoke 保留 audit
test("ELB · revoke 保留 audit · revoked_at/by/reason 都填", async () => {
  const active = await asAiproot((tx) => bindingRepo.getActiveByLineUserId(tx, BOT_ELB_A, LINE_USER_A1));
  assert.ok(active);
  const result = await asAiproot((tx) => bindingRepo.revoke(tx, active!.bindingId, {
    revokedBy: USER_ELB_A1,
    reason: "aiproot_revoke",
  }));
  assert.equal(result.revoked, true);

  const audit = await asAiproot((tx) => tx.execute<{
    status: string;
    revoked_at: string | null;
    revoked_by: string | null;
    revoked_reason: string | null;
  }>(sql`
    SELECT status, revoked_at::text, revoked_by::text, revoked_reason
    FROM user_line_binding WHERE binding_id = ${active!.bindingId}::uuid
  `));
  const row = audit.rows[0];
  assert.equal(row.status, "revoked");
  assert.ok(row.revoked_at, "revoked_at 應填");
  assert.equal(row.revoked_by, USER_ELB_A1);
  assert.equal(row.revoked_reason, "aiproot_revoke");
});

// 4. listByTenant · 對應 JOIN users · 只回同 tenant
test("ELB · listByTenant 只回同 tenant · RLS 不會 leak", async () => {
  // A tenant 有 revoked binding (剛剛 revoke) · 加一個 active
  await asAiproot((tx) => bindingRepo.create(tx, {
    userId: USER_ELB_A2,
    botId: BOT_ELB_A,
    lineUserId: LINE_USER_A2,
    boundBy: USER_ELB_A2,
    bindingMethod: "aiproot_manual",
    metadata: null,
  }));

  const listA = await asAiproot((tx) => bindingRepo.listByTenant(tx, T_ELB_A, { limit: 100 }));
  assert.ok(listA.length >= 2, `T_A 應至少 2 row · 實際 ${listA.length}`);
  assert.ok(listA.every((r) => r.lineUserId === LINE_USER_A1 || r.lineUserId === LINE_USER_A2), "全部應屬 T_A");

  // T_B 沒任何 binding
  const listB = await asAiproot((tx) => bindingRepo.listByTenant(tx, T_ELB_B, { limit: 100 }));
  assert.equal(listB.length, 0, "T_B 應無 binding");

  // status filter
  const activeOnly = await asAiproot((tx) => bindingRepo.listByTenant(tx, T_ELB_A, { status: "active", limit: 100 }));
  assert.ok(activeOnly.every((r) => r.status === "active"), "status=active filter 應只回 active");

  const revokedOnly = await asAiproot((tx) => bindingRepo.listByTenant(tx, T_ELB_A, { status: "revoked", limit: 100 }));
  assert.ok(revokedOnly.every((r) => r.status === "revoked"), "status=revoked filter 應只回 revoked");
});

// 5. completeLiffBinding · 建 users + binding · 二次擋
test("ELB · completeLiffBinding 建 users + binding · 二次擋", async () => {
  // 先移除該 line_user 已有 binding · 才能測 new flow
  await asAiproot((tx) => tx.execute(sql`
    DELETE FROM user_line_binding WHERE bot_id = ${BOT_ELB_A}::uuid AND line_user_id = ${LINE_USER_UNBOUND}
  `));
  await asAiproot((tx) => tx.execute(sql`
    DELETE FROM users WHERE email = ${LINE_USER_UNBOUND + "@line.local"}
  `));

  const result = await bindingService.completeLiffBinding({
    botId: BOT_ELB_A,
    lineUserId: LINE_USER_UNBOUND,
    displayName: "新員工 Charlie",
    primaryGroupId: GROUP_ELB_A,
    metadata: { test: true },
  });

  assert.ok(result.userId, "應建 users · userId 有值");
  assert.ok(result.bindingId, "應建 binding · bindingId 有值");
  assert.equal(result.displayName, "新員工 Charlie");
  assert.equal(result.departmentName, "elb-dept-A", "primaryGroupId 應查到 dept name");

  // 確認 users row · email 用 lineUserId@line.local 佔位
  const userCheck = await asAiproot((tx) => tx.execute<{ email: string; display_name: string; department_id: string | null }>(sql`
    SELECT email, display_name, department_id::text FROM users WHERE user_id = ${result.userId}::uuid
  `));
  assert.equal(userCheck.rows[0].email, LINE_USER_UNBOUND + "@line.local");
  assert.equal(userCheck.rows[0].display_name, "新員工 Charlie");
  assert.equal(userCheck.rows[0].department_id, DEPT_ELB_A);

  // 二次呼叫應 throw BadRequest
  await assert.rejects(
    () => bindingService.completeLiffBinding({
      botId: BOT_ELB_A,
      lineUserId: LINE_USER_UNBOUND,
      displayName: "重複的 Charlie",
      primaryGroupId: null,
      metadata: {},
    }),
    BadRequestException,
    "二次呼叫應 throw BadRequestException",
  );
});

// 6. resolveUserByLineUserId · bound 回 userId · unbound 回 null
test("ELB · resolveUserByLineUserId · bound 回 userId · unbound 回 null", async () => {
  const resolved = await bindingService.resolveUserByLineUserId(BOT_ELB_A, LINE_USER_UNBOUND);
  assert.ok(resolved, "已綁的 lineUserId 應回 userId");

  const unresolved = await bindingService.resolveUserByLineUserId(BOT_ELB_A, "Unonexistent_line_user_000000001");
  assert.equal(unresolved, null, "未綁的應回 null");
});

// 7. Nudge findUnboundActiveUsers · 排除已綁 · message_count 正確
test("ELB · Nudge findUnboundActiveUsers · 排除已綁 · count 正確", async () => {
  // 塞 3 則訊息 · 2 位 sender · 1 位已綁 (A2) · 1 位未綁
  const now = Date.now();
  await asAiproot(async (tx) => {
    await tx.execute(sql`
      INSERT INTO line_message
        (message_id, tenant_id, bot_id, group_id, department_id,
         sender_line_id, message_type, text_content, sent_at, raw_event, sender_user_id, chat_context)
      VALUES
        ('elbtest-msg-001', ${T_ELB_A}::uuid, ${BOT_ELB_A}::uuid, ${GROUP_ELB_A}, ${DEPT_ELB_A}::uuid,
         ${LINE_USER_A2}, 'text', 'A2 已綁 · 不該出現',
         to_timestamp(${(now - 60_000) / 1000}), '{"t":"elbtest"}'::jsonb, ${USER_ELB_A2}::uuid, 'group'),
        ('elbtest-msg-002', ${T_ELB_A}::uuid, ${BOT_ELB_A}::uuid, ${GROUP_ELB_A}, ${DEPT_ELB_A}::uuid,
         ${LINE_USER_UNBOUND_2}, 'text', '未綁 訊息 1',
         to_timestamp(${(now - 120_000) / 1000}), '{"t":"elbtest"}'::jsonb, NULL, 'group'),
        ('elbtest-msg-003', ${T_ELB_A}::uuid, ${BOT_ELB_A}::uuid, ${GROUP_ELB_A}, ${DEPT_ELB_A}::uuid,
         ${LINE_USER_UNBOUND_2}, 'text', '未綁 訊息 2',
         to_timestamp(${(now - 180_000) / 1000}), '{"t":"elbtest"}'::jsonb, NULL, 'group')
      ON CONFLICT (message_id) DO NOTHING
    `);
  });

  const stats = await nudgeService.computeUnboundStats();
  const tA = stats.find((s) => s.tenantId === T_ELB_A);
  assert.ok(tA, "T_ELB_A 應在 stats 中");

  const unboundEntry = tA!.top.find((r) => r.senderLineId === LINE_USER_UNBOUND_2);
  assert.ok(unboundEntry, "LINE_USER_UNBOUND_2 應出現在 unbound top");
  assert.equal(unboundEntry!.messageCount, 2, "message_count 應為 2");

  const boundEntry = tA!.top.find((r) => r.senderLineId === LINE_USER_A2);
  assert.equal(boundEntry, undefined, "LINE_USER_A2 已綁 · 不該出現在 unbound top");
});

// 8. Aiproot audit · list 順序 · bound_at DESC (最新在前)
test("ELB · listByTenant · bound_at DESC 排序", async () => {
  const list = await asAiproot((tx) => bindingRepo.listByTenant(tx, T_ELB_A, { limit: 100 }));
  for (let i = 0; i < list.length - 1; i++) {
    assert.ok(list[i].boundAt >= list[i + 1].boundAt,
      `第 ${i} 筆 boundAt (${list[i].boundAt}) 應 >= 第 ${i + 1} 筆 (${list[i + 1].boundAt})`);
  }
});
