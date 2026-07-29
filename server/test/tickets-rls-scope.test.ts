// tickets 的 RLS 資料範圍 · docs/modules/custom-roles.md §5.1（migration 0048）
//
// 這支釘的是一條**安全**規則，不是功能規則 —— 所以它必須用真的 DB、真的 policy 跑，
// 不能用 mock。RLS 的失敗方式是**靜默回 0 列或靜默多回幾列**，兩邊都不報錯。
//
// 舊 policy 寫成「列舉誰要被限制」：
//   AND (actor_role IS DISTINCT FROM 'group_owner' OR department_id = current_department)
// 於是**每多一個角色就自動落在「不被限制」那側**。prod 上 8 個 employee 因此
// 在 DB 層看得到全租戶所有部門的任務（只靠 API 權限碼擋著）。
//
// 新 policy 改成正向：有設 app.current_department 就限縮，沒設就是整個租戶。
// SQL 不再猜角色 —— 這也是為什麼將來新增角色不必再動 policy。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";
import { withTenant, closeDb } from "../src/db/client.js";

const T = "a11ce511-0000-4000-8000-00000000a101";
const D1 = "a11ce511-0000-4000-8000-00000000dd01";
const D2 = "a11ce511-0000-4000-8000-00000000dd02";

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

/** 用某個角色 + 某個部門上下文去數看得到幾張票 */
const visibleCount = (role: string, departmentId: string | null) =>
  withTenant({ tenantId: T, role: role as never, departmentId, userId: null }, async (tx) => {
    const r = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM tickets WHERE tenant_id = ${T}::uuid`);
    return r.rows[0].n;
  });

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'RLS-SCOPE-TEST')`, [T]);
  for (const [id, name, grp] of [[D1, "研發部", "Crls1"], [D2, "業務部", "Crls2"]]) {
    await c.query(
      `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
       VALUES ($1,$2,$3,$4,'x','x')`, [id, T, name, grp]);
  }
  // D1 兩張、D2 一張
  await c.query(
    `INSERT INTO tickets (tenant_id, department_id, summary, confirm_status)
     VALUES ($1,$2,'研發-A','待簽核'), ($1,$2,'研發-B','待簽核'), ($1,$3,'業務-A','待簽核')`,
    [T, D1, D2]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.end();
  await closeDb();
});

test("⭐ 沒有部門上下文 → 看得到整個租戶", async () => {
  assert.equal(await visibleCount("tenant_admin", null), 3);
});

test("⭐ 有部門上下文 → 只看得到那個部門", async () => {
  assert.equal(await visibleCount("group_owner", D1), 2);
  assert.equal(await visibleCount("group_owner", D2), 1);
});

test("⭐⭐ 部門隔離**不依角色名稱** —— 換成別的角色一樣要被限縮", async () => {
  // 這條是整個 0048 的重點。舊 policy 只認字面字串 'group_owner'，
  // 所以 employee／consultant／任何自訂角色帶著部門也照樣看得到全租戶。
  for (const role of ["employee", "tenant_admin", "consultant", "assistant"]) {
    assert.equal(
      await visibleCount(role, D2), 1,
      `⚠️ 角色 ${role} 帶著部門上下文卻看到不只自己部門 —— 部門隔離退回成「只擋 group_owner」了`,
    );
  }
});

test("⭐⭐ 跨租戶永遠看不到（這條不因 0048 改變，一併釘住）", async () => {
  const other = "a11ce511-0000-4000-8000-00000000b999";
  const n = await withTenant(
    { tenantId: other, role: "tenant_admin", departmentId: null, userId: null },
    async (tx) => {
      const r = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM tickets WHERE tenant_id = ${T}::uuid`);
      return r.rows[0].n;
    });
  assert.equal(n, 0);
});
