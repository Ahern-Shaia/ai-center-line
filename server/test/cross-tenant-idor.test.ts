// 跨租戶 IDOR · 2026-07-29 實測到的真實漏洞
//
// A 公司的 tenant_admin 呼叫 GET /tenant-admin/departments?tenantId=<B 的 id>
// 就讀得到 B 的部門 —— 已用 scratch 重現、修好後再驗一次。
//
// 根因：TenantTxInterceptor 依 JWT 設好 app.current_tenant，
// 但 service 的 setTenantContext(tx, <client 傳的值>) 把它**覆蓋掉**。
// @RequirePermission("departments:view") 擋不住 ——
// 它問的是「這個人有沒有這個權限」，不是「這筆資料是不是他家的」。
//
// ⚠️ 這支測試打的是 controller 不是 service：
//    修正在 controller（client 輸入進來的地方），service 仍然照傳入值切上下文。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { withTenant, txStore, closeDb } from "../src/db/client.js";
import { DepartmentController } from "../src/tenant-admin/department.controller.js";
import { DepartmentService } from "../src/tenant-admin/department.service.js";
import { DepartmentRepository } from "../src/tenant-admin/department.repository.js";
import type { JwtUser } from "../src/auth/jwt-user.js";

const ctl = new DepartmentController(new DepartmentService(new DepartmentRepository()));

/**
 * ⚠️ 專用租戶，**不可**改成從 tenants 撈現成的。
 * 原本寫 `SELECT ... FROM tenants ORDER BY created_at LIMIT 2`，低頻紅：
 * node --test 各檔案是**平行的 process**，而 auth / rls / line-ingest 等檔會
 * 建了又刪自己的租戶（FK cascade 連帶清 departments）——
 * 撈到的兩家可能在測試跑到一半就被別的檔案刪掉。
 * 共享可變狀態當測試 fixture ＝ 自找 flake。
 */
const A = "d0d0d0d0-0000-4000-8000-00000000000a";
const B = "d0d0d0d0-0000-4000-8000-00000000000b";
const TAG = `idor-${randomUUID().slice(0, 8)}`;

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id IN ($1,$2)`, [A, B]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'IDOR-A'),($2,'IDOR-B')`, [A, B]);
  await c.query(
    `INSERT INTO departments (tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1,$2,$3,'x','x')`, [B, TAG, `C-${TAG}`]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id IN ($1,$2)`, [A, B]); // cascade 清 departments
  await c.end();
  await closeDb();
});

const asUser = (u: JwtUser, ctxTenant: string | null, fn: () => Promise<unknown>) =>
  withTenant({ tenantId: ctxTenant, role: u.role, departmentId: null, userId: null },
    (tx) => txStore.run(tx, fn));

const user = (role: string, tenantId: string | null): JwtUser =>
  ({ user_id: randomUUID(), role, tenant_id: tenantId, department_id: null } as unknown as JwtUser);

test("⭐⭐ tenant_admin 不可傳別家 tenantId 讀別家部門", async () => {
  await assert.rejects(
    () => asUser(user("tenant_admin", A), A, () => ctl.list(user("tenant_admin", A), B)),
    /不可查詢其他租戶/,
    "這正是 2026-07-29 實測到的漏洞 —— 修回去的話這條會紅",
  );
});

test("tenant_admin 不傳 tenantId 時用自己的（正常路徑不可被誤傷）", async () => {
  const r = await asUser(user("tenant_admin", A), A,
    () => ctl.list(user("tenant_admin", A), undefined)) as { departments: unknown[] };
  assert.ok(Array.isArray(r.departments), "自己家的照樣查得到");
});

test("⭐ 傳自己的 tenantId 也要放行（前端目前就是這樣傳的）", async () => {
  const r = await asUser(user("tenant_admin", A), A,
    () => ctl.list(user("tenant_admin", A), A)) as { departments: unknown[] };
  assert.ok(Array.isArray(r.departments));
});

test("aiproot_admin 仍可跨租戶查（它本來就是跨租戶角色）", async () => {
  const r = await asUser(user("aiproot_admin", null), null,
    () => ctl.list(user("aiproot_admin", null), B)) as { departments: Array<{ departmentName: string }> };
  assert.ok(r.departments.some((d) => d.departmentName === TAG), "平台角色查得到指定租戶");
});
