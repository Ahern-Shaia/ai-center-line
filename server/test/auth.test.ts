// 認證/授權測試：login（bcrypt→JWT）、JwtAuthGuard、RolesGuard。直接 new，不經 NestJS DI。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import bcrypt from "bcryptjs";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { AuthService } from "../src/auth/auth.service.js";
import { PasswordPolicyService } from "../src/auth/password-policy.service.js";
import { PasswordHistoryRepository } from "../src/auth/password-history.repository.js";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard.js";
import { RolesGuard } from "../src/auth/roles.guard.js";
import { closeDb } from "../src/db/client.js";

const C = "33333333-3333-3333-3333-333333333333"; // 專用租戶，避免與 rls.test 平行衝突
const USER_C = "00000000-000c-0000-0000-0000000000cc";
const jwt = new JwtService({ secret: process.env.JWT_SECRET ?? "dev-only-change-me", signOptions: { expiresIn: "8h" } });
// ⚠️ 三個 constructor 參數都要給。之前只傳 jwt，login 一進去就在 this.policy.isLocked 炸掉，
// 「login 成功」直接紅，而「login 密碼錯 → Unauthorized」反而**假綠**——它只檢查有沒有丟例外，
// 丟的是 TypeError 也算過。失敗跟成功長得一樣，測試就等於沒有。
const auth = new AuthService(jwt, new PasswordPolicyService(), new PasswordHistoryRepository());

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

/**
 * ⚠️ 假 Reflector 必須**依 key 回不同值**。
 * 原本寫成 `getAllAndOverride: () => [...]` —— 對每一個 key 都回同一個陣列，
 * 於是守衛查 IS_PUBLIC_KEY 時拿到 truthy 就直接放行，測試「為了錯的理由」而過。
 * 守衛從 fail-open 改 fail-closed 多了分支之後，這個偷懶就穿幫了。
 */
const reflector = (m: Record<string, unknown>) =>
  ({ getAllAndOverride: (key: string) => m[key] } as never);

test("RolesGuard 角色不符 → 擋", () => {
  const guard = new RolesGuard(reflector({ roles: ["tenant_admin"] }));
  assert.throws(() => guard.canActivate(ctx({ user: { role: "group_owner" } })), /角色無權限/);
});

test("RolesGuard 角色相符 → 過", () => {
  const guard = new RolesGuard(reflector({ roles: ["tenant_admin", "group_owner"] }));
  assert.equal(guard.canActivate(ctx({ user: { role: "group_owner" } })), true);
});

// ── fail-closed（M0.9）──────────────────────────────────────────
// 沒有宣告存取層級 = 拒絕。忘記寫的懲罰要是「炸在開發階段」，
// 不是「安靜地放行到 prod」。

test("⭐ RolesGuard 沒有任何宣告 → 擋（fail-closed）", () => {
  const guard = new RolesGuard(reflector({}));
  assert.throws(
    () => guard.canActivate(ctx({ user: { role: "tenant_admin" } })),
    /未宣告存取層級/,
    "改回 fail-open 的話這條會紅 —— 那正是本專案踩過的坑",
  );
});

test("@AllowAnyUser 明示不限角色 → 過", () => {
  const guard = new RolesGuard(reflector({ allowAnyUser: true }));
  assert.equal(guard.canActivate(ctx({ user: { role: "employee" } })), true);
});

test("@RequirePermission 交給下一道 PermissionGuard 判 → 這裡放行", () => {
  const guard = new RolesGuard(reflector({ require_permission: ["departments:view"] }));
  assert.equal(guard.canActivate(ctx({ user: { role: "employee" } })), true);
});

test("@Public → 過（JwtAuthGuard 負責）", () => {
  const guard = new RolesGuard(reflector({ isPublic: true }));
  assert.equal(guard.canActivate(ctx({})), true);
});

// 登入是公開路由 · TenantTxInterceptor 看到沒有 req.user 就跳過，
// 所以登入紀錄必須由 AuthService 自己寫。沒有這兩支測試，
// 稽核頁的「只看登入」會再次悄悄變成永遠空白（2026-07-28 就是這樣被發現的）。
async function loginAuditCount(result: "allowed" | "denied"): Promise<number> {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `SELECT count(*)::int n FROM audit_log
      WHERE actor_user_id=$1 AND action='POST /auth/login' AND result=$2`,
    [USER_C, result],
  );
  await c.end();
  return r.rows[0].n as number;
}

test("⭐ 登入成功 → 寫一筆稽核", async () => {
  const before = await loginAuditCount("allowed");
  await auth.login("login@c.test", "pw123");
  assert.equal(await loginAuditCount("allowed"), before + 1);
});

test("⭐ 密碼錯 → 也要寫稽核（標記已擋下）· 這才是查得到暴力嘗試的關鍵", async () => {
  const before = await loginAuditCount("denied");
  await assert.rejects(() => auth.login("login@c.test", "wrong"));
  assert.equal(await loginAuditCount("denied"), before + 1);
});
