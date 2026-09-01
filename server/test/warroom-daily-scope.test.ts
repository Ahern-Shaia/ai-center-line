// 群組日誌 scope（listDailyReports）· analysis_upload/result 無 RLS → service 層明確 scope
// 守：① 部門主管只看「分派到自己部門」的群 ② 沒設部門的部門主管看不到任何群
//     ③ 總經理室看全租戶（不限部門）④ 跨租戶隔離（P0）
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTenant, txStore, closeDb } from "../src/db/client.js";
import { WarroomTasksService } from "../src/warroom/warroom-tasks.service.js";

import { notTestingNotify } from "./warroom-tasks-fixture.js";
const svc = notTestingNotify();
const T1 = "b0da0000-0000-4000-8000-00000000d201";
const T2 = "b0da0000-0000-4000-8000-00000000d202";
const BOT = "b0da0000-0000-4000-8000-00000000d2b0";
const DEPT_A = "b0da0000-0000-4000-8000-0000000002aa";
const DEPT_B = "b0da0000-0000-4000-8000-0000000002bb";
const G1 = "Cdaily1group0000000000000000000001"; // 部門 A
const G2 = "Cdaily2group0000000000000000000002"; // 部門 B
const GT2 = "Cdaily3group0000000000000000000003"; // T2

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
const runT1 = <R>(fn: () => Promise<R>) =>
  withTenant({ tenantId: T1, role: "aiproot_admin", departmentId: null, userId: null }, (tx) => txStore.run(tx, fn));

// 攤平出所有 groupId
const groupIds = (r: { days: Array<{ uploads: Array<{ groupId: string }> }> }) =>
  r.days.flatMap((d) => d.uploads.map((u) => u.groupId)).sort();

before(async () => {
  const c = admin(); await c.connect();
  const key = process.env.LINE_CONFIG_ENC_KEY;
  for (const t of [T1, T2]) await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'甲'),($2,'乙')`, [T1, T2]);
  await c.query(`INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, kind, channel_secret_enc, channel_access_token_enc, status)
                 VALUES ($1,$2,'b','Udaily${"x".repeat(20)}','analysis', pgp_sym_encrypt('s',$3), pgp_sym_encrypt('t',$3),'active')`,
    [BOT, T1, key]);
  for (const [id, name] of [[DEPT_A, "業務"], [DEPT_B, "技術"]] as const)
    await c.query(`INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
                   VALUES ($1,$2,$3,$4,'x','x')`, [id, T1, name, `g_${id.slice(-4)}`]);
  const mkGroup = (gid: string, dept: string) =>
    c.query(`INSERT INTO line_group (bot_id, group_id, display_name, department_id, status)
             VALUES ($1,$2,$3,$4,'active')`, [BOT, gid, gid.slice(0, 8), dept]);
  await mkGroup(G1, DEPT_A); await mkGroup(G2, DEPT_B);
  const mkUpload = (t: string, gid: string) =>
    c.query(`INSERT INTO analysis_upload (tenant_id, tenant_slug, filename, raw_content, group_id, batch_date, status)
             VALUES ($1,'s','f.txt','x',$2, CURRENT_DATE, 'done')`, [t, gid]);
  await mkUpload(T1, G1); await mkUpload(T1, G2); await mkUpload(T2, GT2);
  await c.end();
});

after(async () => {
  const c = admin(); await c.connect();
  for (const t of [T1, T2]) await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]);
  await c.end(); await closeDb();
});

test("⭐⭐ 部門主管只看分派到自己部門的群（部門 A → 只有 G1）", async () => {
  const r = await runT1(() => svc.listDailyReports({}, { role: "group_owner", tenantId: T1, departmentId: DEPT_A }));
  assert.deepEqual(groupIds(r), [G1]);
});

test("⭐ 總經理室看全租戶的群（G1+G2，不含 T2）", async () => {
  const r = await runT1(() => svc.listDailyReports({}, { role: "tenant_admin", tenantId: T1, departmentId: null }));
  assert.deepEqual(groupIds(r), [G1, G2].sort());
});

test("⭐⭐ 沒設部門的部門主管 → 看不到任何群（避免 over-scope）", async () => {
  const r = await runT1(() => svc.listDailyReports({}, { role: "group_owner", tenantId: T1, departmentId: null }));
  assert.deepEqual(groupIds(r), []);
});

test("⭐⭐ 跨租戶隔離：甲公司的人看不到乙公司的群日誌（P0）", async () => {
  const r = await runT1(() => svc.listDailyReports({}, { role: "tenant_admin", tenantId: T1, departmentId: null }));
  assert.ok(!groupIds(r).includes(GT2), "不得出現 T2 的群");
});
