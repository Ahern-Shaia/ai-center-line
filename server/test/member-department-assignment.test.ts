// MDA · 總經理自主分配成員部門 · docs/modules/member-department-assignment.md
//
// 這是**安全**規則（誰能改誰的什麼），用真 DB / 真 RLS 跑。FMEA 三個 P0 各釘一條：
//   ① 跨租戶 IDOR：不能把自家成員指派到別家的部門、不能改別家的成員
//   ② 藉端點提權：這條路只能改部門，碰不到 role（schema 根本不收 role）
//   ③ 手動優先：手動指派後 department_source='manual'（自動推導日後不得覆寫的地基）
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";
import { withTenant, txStore, closeDb } from "../src/db/client.js";
import { UserService } from "../src/tenant-admin/user.service.js";
import { UserRepository } from "../src/tenant-admin/user.repository.js";
import { AssignDepartmentSchema } from "../src/tenant-admin/dto/user.dto.js";

const svc = new UserService(new UserRepository());

const T1 = "b0da0000-0000-4000-8000-00000000d001";
const T2 = "b0da0000-0000-4000-8000-00000000d002";     // 別家租戶
const DEPT_1A = "b0da0000-0000-4000-8000-0000000001aa";
const DEPT_1B = "b0da0000-0000-4000-8000-0000000001bb";
const DEPT_2 = "b0da0000-0000-4000-8000-0000000002aa";  // 別家的部門
const ADMIN1 = "b0da0000-0000-4000-8000-00000000ad01";  // T1 的總經理（指派者）
const EMP1 = "b0da0000-0000-4000-8000-0000000000e1";    // T1 的員工
const EMP2 = "b0da0000-0000-4000-8000-0000000000e2";    // T2 的員工

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

/** 以某租戶總經理身分跑（帶 RLS 上下文） */
const runAsTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
  withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId: ADMIN1 },
    (tx) => txStore.run(tx, fn));

before(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T1, T2]) {
    await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);
    await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,$2)`, [t, `MDA-${t.slice(-4)}`]);
  }
  for (const [id, t, name] of [[DEPT_1A, T1, "業務部"], [DEPT_1B, T1, "技術部"], [DEPT_2, T2, "別家部門"]]) {
    await c.query(
      `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
       VALUES ($1,$2,$3,$4,'x','x')`, [id, t, name, `G_${id.slice(-4)}`]);
  }
  const mkUser = (uid: string, t: string, role: string, dept: string | null, name: string) =>
    c.query(
      `INSERT INTO users (user_id, tenant_id, role, department_id, display_name, email)
       VALUES ($1,$2,$3,$4,$5,$6)`, [uid, t, role, dept, name, `${uid}@t.test`]);
  await mkUser(ADMIN1, T1, "tenant_admin", null, "王總");
  await mkUser(EMP1, T1, "employee", DEPT_1A, "員工一");   // 起始在業務部（auto）
  await mkUser(EMP2, T2, "employee", DEPT_2, "別家員工");
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T1, T2]) await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);
  await c.end();
  await closeDb();
});

// ── 基本 + P0③ 手動優先 ────────────────────────────────────────
test("⭐ 指派部門會生效，且標記 source='manual'（自動推導日後不得覆寫的地基）", async () => {
  const dto = await runAsTenant(T1, () => svc.assignDepartment(EMP1, T1, DEPT_1B, ADMIN1));
  assert.equal(dto.departmentId, DEPT_1B, "部門要換成技術部");
  assert.equal(dto.departmentSource, "manual", "手動指派後必須標 manual");

  // 直接查 DB 確認 assigned_by / assigned_at 有落
  const c = admin(); await c.connect();
  const r = await c.query<{ by: string | null; at: string | null }>(
    `SELECT department_assigned_by AS by, department_assigned_at AS at FROM users WHERE user_id=$1`, [EMP1]);
  await c.end();
  assert.equal(r.rows[0].by, ADMIN1, "要記下是誰指派的");
  assert.ok(r.rows[0].at, "要記下指派時間");
});

test("⭐ 可以清空部門（回未分派）—— 部門是屬性，null 是合法狀態", async () => {
  const dto = await runAsTenant(T1, () => svc.assignDepartment(EMP1, T1, null, ADMIN1));
  assert.equal(dto.departmentId, null);
  assert.equal(dto.departmentSource, "manual");
});

// ── P0① 跨租戶 IDOR ────────────────────────────────────────────
test("⭐⭐ 不能把自家成員指派到別家的部門（跨租戶 IDOR）", async () => {
  await assert.rejects(
    () => runAsTenant(T1, () => svc.assignDepartment(EMP1, T1, DEPT_2, ADMIN1)),
    /不屬於這個公司/,
    "拿別租戶的 department_id 必須被擋",
  );
});

test("⭐⭐ 不能改別家租戶的成員（RLS + 明擋）", async () => {
  await assert.rejects(
    () => runAsTenant(T1, () => svc.assignDepartment(EMP2, T1, DEPT_1A, ADMIN1)),
    /找不到該成員/,
    "T1 改 T2 的成員必須看不到（回 404，不洩漏存在）",
  );
});

// ── P0② 藉端點提權 ─────────────────────────────────────────────
test("⭐⭐ 這條路碰不到 role —— schema 根本不收 role 欄位", () => {
  // 就算 client 硬塞 role，zod 也不會把它放進 parsed.data（strip），service 更沒有改 role 的碼。
  const parsed = AssignDepartmentSchema.parse({
    tenantId: T1, departmentId: DEPT_1A, role: "tenant_admin", password: "hack",
  } as Record<string, unknown>);
  assert.ok(!("role" in parsed), "role 不得進入 payload");
  assert.ok(!("password" in parsed), "password 不得進入 payload");
});

test("⭐ 指派部門後，成員角色維持不變（沒有被順手改動）", async () => {
  await runAsTenant(T1, () => svc.assignDepartment(EMP1, T1, DEPT_1A, ADMIN1));
  const c = admin(); await c.connect();
  const r = await c.query<{ role: string }>(`SELECT role FROM users WHERE user_id=$1`, [EMP1]);
  await c.end();
  assert.equal(r.rows[0].role, "employee", "角色不可因為改部門而變動");
});
