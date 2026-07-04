// 認證/授權測試：login（bcrypt→JWT）、JwtAuthGuard、RolesGuard。直接 new，不經 NestJS DI。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import bcrypt from "bcryptjs";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { AuthService } from "../src/auth/auth.service.js";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard.js";
import { RolesGuard } from "../src/auth/roles.guard.js";
import { closeDb } from "../src/db/client.js";

const C = "33333333-3333-3333-3333-333333333333"; // 專用租戶，避免與 rls.test 平行衝突
const USER_C = "00000000-000c-0000-0000-0000000000cc";
const jwt = new JwtService({ secret: process.env.JWT_SECRET ?? "dev-only-change-me", signOptions: { expiresIn: "8h" } });
const auth = new AuthService(jwt);

before(async () => {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  const hash = await bcrypt.hash("pw123", 10);
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [C]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'C')`, [C]);
  await c.query(`INSERT INTO users (user_id, tenant_id, role, email, password_hash) VALUES ($1,$2,'tenant_admin','login@c.test',$3)`, [USER_C, C, hash]);
  await c.end();
});

after(async () => {
  await closeDb();
});

function ctx(req: unknown): never {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

test("login 成功 → JWT payload 含 tenant/role", async () => {
  const { access_token } = await auth.login("login@c.test", "pw123");
  const payload = jwt.verify<{ role: string; tenant_id: string }>(access_token);
  assert.equal(payload.role, "tenant_admin");
  assert.equal(payload.tenant_id, C);
});

test("login 密碼錯 → Unauthorized", async () => {
  await assert.rejects(() => auth.login("login@c.test", "wrong"));
});

test("login 帳號不存在 → Unauthorized", async () => {
  await assert.rejects(() => auth.login("nobody@x.test", "pw123"));
});

test("JwtAuthGuard 無 token → 擋", async () => {
  const guard = new JwtAuthGuard(jwt, new Reflector());
  await assert.rejects(() => guard.canActivate(ctx({ headers: {} })));
});

test("JwtAuthGuard 有效 token → 過並掛 req.user", async () => {
  const token = await jwt.signAsync({ user_id: "u1", role: "group_owner", tenant_id: C, department_id: null });
  const req = { headers: { authorization: `Bearer ${token}` } } as { headers: Record<string, string>; user?: { role: string } };
  assert.equal(await new JwtAuthGuard(jwt, new Reflector()).canActivate(ctx(req)), true);
  assert.equal(req.user?.role, "group_owner");
});

test("RolesGuard 角色不符 → 擋", () => {
  const guard = new RolesGuard({ getAllAndOverride: () => ["tenant_admin"] } as never);
  assert.throws(() => guard.canActivate(ctx({ user: { role: "group_owner" } })));
});

test("RolesGuard 角色相符 → 過", () => {
  const guard = new RolesGuard({ getAllAndOverride: () => ["tenant_admin", "group_owner"] } as never);
  assert.equal(guard.canActivate(ctx({ user: { role: "group_owner" } })), true);
});
