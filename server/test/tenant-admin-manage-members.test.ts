// 總經理自主管理成員角色與刪除（0055）· docs/roles-permissions-matrix.md §5
//
// 這是**權限委派**（有提權風險），用真 DB / 真 RLS 跑。守住的護欄：
//   ① 只能動 員工↔部門主管 —— 碰不到 總經理室/助理/aiproot（防動同級或上級、防鎖死）
//   ② DTO 根本不收 tenant_admin/assistant —— 防把人（或自己）升成同級（v2 核心）
//   ③ 跨租戶 IDOR —— 改不到/刪不到別家的人（RLS + 明驗）
//   ④ 不能改/刪自己
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTenant, txStore, closeDb } from "../src/db/client.js";
import { UserService } from "../src/tenant-admin/user.service.js";
import { UserRepository } from "../src/tenant-admin/user.repository.js";
import { AssignRoleSchema } from "../src/tenant-admin/dto/user.dto.js";

const svc = new UserService(new UserRepository());

const T1 = "b0da0000-0000-4000-8000-00000000e001";
const T2 = "b0da0000-0000-4000-8000-00000000e002";       // 別家租戶
const ADMIN1 = "b0da0000-0000-4000-8000-00000000ae01";   // T1 總經理（操作者）
const ADMIN1B = "b0da0000-0000-4000-8000-00000000ae1b";  // T1 的另一位總經理（同級 · 不可被動）
const EMP1 = "b0da0000-0000-4000-8000-0000000000f1";     // T1 員工
const GO1 = "b0da0000-0000-4000-8000-0000000000f2";      // T1 部門主管
const DEL_EMP = "b0da0000-0000-4000-8000-0000000000fd";  // 專供刪除測試
const EMP2 = "b0da0000-0000-4000-8000-0000000000f9";     // T2 員工

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

const runAsTenant = <R>(fn: () => Promise<R>) =>
  withTenant({ tenantId: T1, role: "tenant_admin", departmentId: null, userId: ADMIN1 },
    (tx) => txStore.run(tx, fn));

before(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T1, T2]) {
    await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);
    await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,$2)`, [t, `MM-${t.slice(-4)}`]);
  }
  const mkUser = (uid: string, t: string, role: string, name: string) =>
    c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email)
             VALUES ($1,$2,$3,$4,$5)`, [uid, t, role, name, `${uid}@t.test`]);
  await mkUser(ADMIN1, T1, "tenant_admin", "王總");
  await mkUser(ADMIN1B, T1, "tenant_admin", "李總");
  await mkUser(EMP1, T1, "employee", "員工一");
  await mkUser(GO1, T1, "group_owner", "主管一");
  await mkUser(DEL_EMP, T1, "employee", "待刪員工");
  await mkUser(EMP2, T2, "employee", "別家員工");
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T1, T2]) await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);
  await c.end();
  await closeDb();
});

const roleOf = async (uid: string): Promise<string | null> => {
  const c = admin(); await c.connect();
  const r = await c.query<{ role: string }>(`SELECT role FROM users WHERE user_id=$1`, [uid]);
  await c.end();
  return r.rows[0]?.role ?? null;
};

// ── 改角色 · 正常路徑 ──────────────────────────────────────────
test("⭐ 員工可升成部門主管（employee → group_owner）", async () => {
  const dto = await runAsTenant(() => svc.assignRole(EMP1, T1, "group_owner", ADMIN1));
  assert.equal(dto.role, "group_owner");
});

test("⭐ 部門主管可降回員工（group_owner → employee）", async () => {
  const dto = await runAsTenant(() => svc.assignRole(GO1, T1, "employee", ADMIN1));
  assert.equal(dto.role, "employee");
});

// ── P0② DTO 不收高階角色（防提權/自升同級）────────────────────
test("⭐⭐ AssignRoleSchema 只收 員工/部門主管 —— tenant_admin 直接被拒", () => {
  assert.throws(() => AssignRoleSchema.parse({ tenantId: T1, role: "tenant_admin" }));
  assert.throws(() => AssignRoleSchema.parse({ tenantId: T1, role: "assistant" }));
  assert.throws(() => AssignRoleSchema.parse({ tenantId: T1, role: "aiproot_admin" }));
});

// ── P0① 碰不到同級/上級 ───────────────────────────────────────
test("⭐⭐ 不能改另一位總經理的角色（碰不到同級）", async () => {
  await assert.rejects(
    () => runAsTenant(() => svc.assignRole(ADMIN1B, T1, "employee", ADMIN1)),
    /只能調整員工或部門主管/,
  );
  assert.equal(await roleOf(ADMIN1B), "tenant_admin", "同級的角色不可被動到");
});

test("⭐⭐ 不能改自己的角色", async () => {
  await assert.rejects(
    () => runAsTenant(() => svc.assignRole(ADMIN1, T1, "group_owner", ADMIN1)),
    /不能修改自己/,
  );
});

// ── P0③ 跨租戶 IDOR ───────────────────────────────────────────
test("⭐⭐ 不能改別家租戶的成員（RLS + 明擋 · 回 404）", async () => {
  await assert.rejects(
    () => runAsTenant(() => svc.assignRole(EMP2, T1, "group_owner", ADMIN1)),
    /找不到該成員/,
  );
});

// ── 刪除 · 護欄同 assignRole ──────────────────────────────────
test("⭐ 可刪自家員工", async () => {
  await runAsTenant(() => svc.deleteMember(DEL_EMP, T1, ADMIN1));
  assert.equal(await roleOf(DEL_EMP), null, "刪掉後查不到");
});

test("⭐⭐ 不能刪另一位總經理（碰不到同級）", async () => {
  await assert.rejects(
    () => runAsTenant(() => svc.deleteMember(ADMIN1B, T1, ADMIN1)),
    /只能刪除員工或部門主管/,
  );
  assert.equal(await roleOf(ADMIN1B), "tenant_admin", "同級不可被刪");
});

test("⭐⭐ 不能刪自己", async () => {
  await assert.rejects(
    () => runAsTenant(() => svc.deleteMember(ADMIN1, T1, ADMIN1)),
    /不能刪除自己/,
  );
});

test("⭐⭐ 不能刪別家租戶的成員（回 404）", async () => {
  await assert.rejects(
    () => runAsTenant(() => svc.deleteMember(EMP2, T1, ADMIN1)),
    /找不到該成員/,
  );
});
