// 部門日報 · team 端點的部門 scope（RLS）· docs/modules/personal-daily-report.md
//
// 這條是**安全**規則不是功能規則 —— 主管只該看到自己該看的日報，所以用真 DB / 真 policy 跑。
// listByRange 的查詢**本身沒有部門過濾**，scope 完全靠 personal_daily_report_scope policy：
//   tenant_id = current_tenant AND (
//     user_id = current_user_id                              -- 自己的
//     OR EXISTS(users.department_id = current_department)    -- 同部門的
//     OR actor_role = 'tenant_admin'                         -- 全租戶
//   ) OR actor_role IN (aiproot_admin, consultant, system)
//
// RLS 的失敗方式是**靜默多回或少回幾列**，兩邊都不報錯 —— 2026-07-30 prod 驗證過，
// 這裡把三種角色的可見範圍釘死，避免日後有人動 policy 卻沒發現 scope 破了。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";
import { withTenant, closeDb } from "../src/db/client.js";
import { PersonalDailyReportRepository } from "../src/personal-daily-report/personal-daily-report.repository.js";

const repo = new PersonalDailyReportRepository();
const T = "b7ea3300-0000-4000-8000-00000000b701";
const OTHER = "b7ea3300-0000-4000-8000-00000000b702";     // 另一個租戶（跨租戶隔離）
const DEPT_A = "b7ea3300-0000-4000-8000-0000000000da";
const DEPT_B = "b7ea3300-0000-4000-8000-0000000000db";
const DATE = "2026-07-28";
const RANGE = { fromDate: "2026-07-01", toDate: "2026-07-31" };

// 部門 A：主管 owner_a + 員工 emp_a1；部門 B：員工 emp_b1
const ownerA = "b7ea3300-0000-4000-8000-00000000000a";
const empA1 = "b7ea3300-0000-4000-8000-0000000000a1";
const empB1 = "b7ea3300-0000-4000-8000-0000000000b1";

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

/** 用某個角色 + 部門上下文跑 team 查詢，回看得到的送出者姓名集合 */
const visibleNames = (role: string, opts: { departmentId?: string; userId?: string; tenantId?: string } = {}) =>
  withTenant(
    { tenantId: opts.tenantId ?? T, role: role as never, departmentId: opts.departmentId ?? null, userId: opts.userId ?? null },
    async (tx) => {
      const rows = await repo.listByRange(tx, RANGE);
      return new Set(rows.map((r) => r.userDisplayName));
    });

before(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T, OTHER]) {
    await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);
    await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1, $2)`, [t, `TEAM-SCOPE-${t.slice(-4)}`]);
  }
  for (const [id, name] of [[DEPT_A, "業務一部"], [DEPT_B, "技術研發"]]) {
    await c.query(
      `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
       VALUES ($1,$2,$3,$4,'x','x')`, [id, T, name, `G_${id.slice(-4)}`]);
  }
  const mkUser = (uid: string, role: string, dept: string | null, name: string, tenant = T) =>
    c.query(
      `INSERT INTO users (user_id, tenant_id, role, department_id, display_name, email)
       VALUES ($1,$2,$3,$4,$5,$6)`, [uid, tenant, role, dept, name, `${uid}@t.test`]);
  await mkUser(ownerA, "group_owner", DEPT_A, "主管A");
  await mkUser(empA1, "employee", DEPT_A, "員工A1");
  await mkUser(empB1, "employee", DEPT_B, "員工B1");
  // 另一租戶一筆日報 —— 跨租戶隔離用
  const otherUser = "b7ea3300-0000-4000-8000-0000000000c1";
  await mkUser(otherUser, "employee", null, "別家員工", OTHER);

  const mkReport = (uid: string, tenant = T) =>
    c.query(
      `INSERT INTO personal_daily_report (tenant_id, user_id, report_date, status, ai_items, final_items)
       VALUES ($1,$2,$3,'sent','[]'::jsonb,'[]'::jsonb)`, [tenant, uid, DATE]);
  await mkReport(empA1);
  await mkReport(empB1);
  await mkReport(otherUser, OTHER);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T, OTHER]) await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);
  await c.end();
  await closeDb();
});

test("⭐⭐ group_owner 只看得到自己部門的日報（不是全租戶）", async () => {
  const seen = await visibleNames("group_owner", { departmentId: DEPT_A, userId: ownerA });
  assert.ok(seen.has("員工A1"), "同部門的要看得到");
  assert.ok(!seen.has("員工B1"), "⚠️ 別部門的看得到＝部門 scope 破了（洩漏）");
});

test("⭐ tenant_admin 看得到全租戶的日報", async () => {
  const seen = await visibleNames("tenant_admin");
  assert.ok(seen.has("員工A1") && seen.has("員工B1"), "tenant_admin 不分部門");
});

test("⭐⭐ 跨租戶永遠看不到（不因角色改變）", async () => {
  for (const role of ["tenant_admin", "group_owner"]) {
    const seen = await visibleNames(role, { departmentId: DEPT_A, userId: ownerA });
    assert.ok(!seen.has("別家員工"), `${role} 看到別的租戶的日報＝跨租戶洩漏`);
  }
});

test("⭐ group_owner 沒設部門上下文 → 只看自己（deny by default，不是看全部）", async () => {
  // interceptor 漏設 current_department 時，EXISTS 子查詢對 NULL 永遠 false。
  // 這種情況要退成「只看自己」，不能退成「看全部」——後者才是危險的預設。
  const seen = await visibleNames("group_owner", { userId: ownerA });   // 不帶 departmentId
  assert.ok(!seen.has("員工A1") && !seen.has("員工B1"),
    "沒有部門上下文卻看得到別人的日報＝deny-by-default 破了");
});
