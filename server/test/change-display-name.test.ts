// 自服務改顯示名稱（含 LINE 登入用戶）· 只改自己那一列 · RLS 擋跨租戶
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTenant, txStore, closeDb } from "../src/db/client.js";
import { AuthService } from "../src/auth/auth.service.js";

const svc = new AuthService({} as never, {} as never, {} as never);
const T1 = "b0da0000-0000-4000-8000-00000000e301";
const T2 = "b0da0000-0000-4000-8000-00000000e302";
const U = "b0da0000-0000-4000-8000-0000000000e3";
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
const nameOf = async () => {
  const c = admin(); await c.connect();
  const r = await c.query<{ display_name: string | null }>(`SELECT display_name FROM users WHERE user_id=$1`, [U]);
  await c.end(); return r.rows[0]?.display_name ?? null;
};

before(async () => {
  const c = admin(); await c.connect();
  for (const t of [T1, T2]) await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'甲'),($2,'乙')`, [T1, T2]);
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email)
                 VALUES ($1,$2,'group_owner','line-user',$3)`, [U, T1, "u@line.local"]);
  await c.end();
});
after(async () => {
  const c = admin(); await c.connect();
  for (const t of [T1, T2]) await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]);
  await c.end(); await closeDb();
});

test("⭐ 本人改自己的顯示名稱 → 生效", async () => {
  const out = await withTenant({ tenantId: T1, role: "group_owner", departmentId: null, userId: U },
    (tx) => txStore.run(tx, () => svc.changeDisplayName(U, "王小明")));
  assert.equal(out, "王小明");
  assert.equal(await nameOf(), "王小明");
});

test("⭐⭐ 跨租戶擋：別租戶的 context 改不到這個人（RLS → 找不到）", async () => {
  await assert.rejects(
    () => withTenant({ tenantId: T2, role: "group_owner", departmentId: null, userId: U },
      (tx) => txStore.run(tx, () => svc.changeDisplayName(U, "駭客改的"))),
    /使用者不存在/,
  );
  assert.equal(await nameOf(), "王小明", "名字不可被別租戶改動");
});
