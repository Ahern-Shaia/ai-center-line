// 組織關係圖（org-overview M1）· 守 P0 跨租戶隔離 + 彙整正確
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closeDb } from "../src/db/client.js";
import { OrgOverviewService } from "../src/tenant-admin/org-overview.service.js";

const svc = new OrgOverviewService();
const T1 = "b0da0000-0000-4000-8000-00000000c101";
const T2 = "b0da0000-0000-4000-8000-00000000c102";
const DEPT_A = "b0da0000-0000-4000-8000-000000000caa";
const DEPT_B = "b0da0000-0000-4000-8000-000000000cbb";
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

before(async () => {
  const c = admin(); await c.connect();
  for (const t of [T1, T2]) { await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]); }
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'甲公司'),($2,'乙公司')`, [T1, T2]);
  const mkDept = (id: string, t: string, name: string) =>
    c.query(`INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
             VALUES ($1,$2,$3,$4,'x','x')`, [id, t, name, `G_${id.slice(-4)}`]);
  await mkDept(DEPT_A, T1, "業務部"); await mkDept(DEPT_B, T2, "別家部門");
  const mkUser = (uid: string, t: string, role: string, dept: string | null, name: string) =>
    c.query(`INSERT INTO users (user_id, tenant_id, role, department_id, display_name, email)
             VALUES ($1,$2,$3,$4,$5,$6)`,
      [uid, t, role, dept, name, `${uid.slice(-6)}@t.test`]);
  await mkUser("b0da0000-0000-4000-8000-0000000000a1", T1, "tenant_admin", null, "王總");
  await mkUser("b0da0000-0000-4000-8000-0000000000a2", T1, "group_owner", DEPT_A, "陳主管");
  await mkUser("b0da0000-0000-4000-8000-0000000000a3", T1, "employee", DEPT_A, "志員工");
  await mkUser("b0da0000-0000-4000-8000-0000000000a4", T1, "employee", null, "孤兒員工");   // 未分派
  await mkUser("b0da0000-0000-4000-8000-0000000000a9", T2, "employee", DEPT_B, "別家員工");
  await c.end();
});

after(async () => {
  const c = admin(); await c.connect();
  for (const t of [T1, T2]) await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]);
  await c.end(); await closeDb();
});

test("⭐ 彙整：公司 / GM / 部門成員 / 未分派 各就各位", async () => {
  const o = await svc.get(T1);
  assert.equal(o.company, "甲公司");
  assert.deepEqual(o.gm, ["王總"], "總經理室＝tenant_admin");
  assert.equal(o.departments.length, 1);
  assert.equal(o.departments[0].name, "業務部");
  const names = o.departments[0].members.map((m) => m.name).sort();
  assert.deepEqual(names, ["志員工", "陳主管"]);
  const lead = o.departments[0].members.find((m) => m.role === "group_owner");
  assert.equal(lead?.name, "陳主管");
  assert.deepEqual(o.unassigned.members.map((m) => m.name), ["孤兒員工"]);
});

test("⭐⭐ 跨租戶隔離：查甲公司看不到乙公司的部門/成員（P0）", async () => {
  const o = await svc.get(T1);
  const all = JSON.stringify(o);
  assert.ok(!all.includes("別家"), "不得出現乙公司的任何部門/成員");
  const o2 = await svc.get(T2);
  assert.equal(o2.company, "乙公司");
  assert.ok(!JSON.stringify(o2).includes("王總"), "乙公司看不到甲公司的 GM");
});

test("GM 不被當成部門成員（只在 gm 清單、不在 department.members）", async () => {
  const o = await svc.get(T1);
  const inDept = o.departments.some((d) => d.members.some((m) => m.name === "王總"));
  assert.equal(inDept, false);
});
