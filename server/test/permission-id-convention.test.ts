// permission_id 慣例（0056）· 這條 bug 讓 tenant_admin 的權限「有勾卻完全不生效」
//
// 根因：permission.guard.ts 與前端 perms.has() 都拿 @RequirePermission 的 'resource:action'
// 字串去比對 permission_id；0051/0052/0055 誤用 gen_random_uuid() → 永遠對不上。
// 這支測試守整條鏈：tenant_admin → role_permissions → permission_id 要是**字串**。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closeDb } from "../src/db/client.js";
import { PermissionService } from "../src/permission/permission.service.js";

const svc = new PermissionService();
const T = "b0da0000-0000-4000-8000-00000000a001";
const ADMIN = "b0da0000-0000-4000-8000-00000000a0ad";
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'PID')`, [T]);
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email)
                 VALUES ($1,$2,'tenant_admin','總',$3)`, [ADMIN, T, "pid@t.test"]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [T]);
  await c.end();
  await closeDb();
});

test("⭐⭐ tenant_admin 權限集含『字串』id（guard/前端才比得中）", async () => {
  const perms = await svc.getUserPermissions(ADMIN);
  // permission_id 是 UUID 的話這裡就會 false —— 正是 0056 前的 bug
  assert.ok(perms.has("users:assign-role"), "permission_id 必須是 'users:assign-role' 而非 UUID");
  assert.ok(perms.has("users:delete-member"), "permission_id 必須是 'users:delete-member'");
  assert.ok(perms.has("users:assign-department"), "MDA 同坑 · 必須是 'users:assign-department'");
});

test("permissions 表不得有『permission_id ≠ resource:action』的列", async () => {
  const c = admin();
  await c.connect();
  const r = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM permissions WHERE permission_id <> resource||':'||action`);
  await c.end();
  assert.equal(r.rows[0].n, 0, "permission_id 必須等於 resource:action（0056 慣例）");
});
