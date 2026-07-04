// 整合測試：租戶隔離（RLS）。跑在真 Docker Postgres（app_rw 受 RLS 約束）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { of, firstValueFrom } from "rxjs";
import { eq } from "drizzle-orm";
import { withTenant, withAuthLookup, txStore, currentTx, closeDb, type Db } from "../src/db/client.js";
import { tickets, users, auditLog } from "../src/db/schema.js";
import { TenantTxInterceptor } from "../src/tenant/tenant.interceptor.js";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const DEPT_A1 = "a1a1a1a1-0000-0000-0000-000000000001";
const DEPT_A2 = "a2a2a2a2-0000-0000-0000-000000000002";
const DEPT_B1 = "b1b1b1b1-0000-0000-0000-000000000001";
const USER_A = "00000000-000a-0000-0000-0000000000aa";

before(async () => {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id IN ($1,$2)`, [A, B]); // FK cascade 清 A/B
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'A'),($2,'B')`, [A, B]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table) VALUES
     ($1,$4,'技術','GA1','daily','HR_A'),($2,$4,'售後','GA2','svc','CRM_A'),($3,$5,'技術','GB1','daily','HR_B')`,
    [DEPT_A1, DEPT_A2, DEPT_B1, A, B],
  );
  await c.query(`INSERT INTO users (user_id, tenant_id, role, email) VALUES ($1,$2,'tenant_admin','a@t.test')`, [USER_A, A]);
  await c.query(
    `INSERT INTO tickets (tenant_id, department_id, summary, confidence, confirm_status) VALUES
     ($1,$3,'A-技術','high','待簽核'),($1,$4,'A-售後','medium','待簽核'),($2,$5,'B-技術','high','待簽核')`,
    [A, B, DEPT_A1, DEPT_A2, DEPT_B1],
  );
  await c.end();
});

after(async () => {
  await closeDb();
});

test("tenant_admin@A 只看得到 A（2 筆）", async () => {
  const rows = await withTenant({ tenantId: A, role: "tenant_admin" }, (tx) => tx.select().from(tickets));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.tenantId === A));
});

test("tenant_admin@B 看不到 A（跨租戶隔離，1 筆）", async () => {
  const rows = await withTenant({ tenantId: B, role: "tenant_admin" }, (tx) => tx.select().from(tickets));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenantId, B);
});

test("group_owner@A/DEPT_A1 只看得到本部門（1 筆，看不到 A 售後）", async () => {
  const rows = await withTenant({ tenantId: A, role: "group_owner", departmentId: DEPT_A1 }, (tx) => tx.select().from(tickets));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].departmentId, DEPT_A1);
});

test("未設租戶 → deny by default（0 筆）", async () => {
  const rows = await withTenant({ tenantId: null, role: "tenant_admin" }, (tx) => tx.select().from(tickets));
  assert.equal(rows.length, 0);
});

test("寫入 WITH CHECK：A 情境不可寫入 B 的 ticket", async () => {
  await assert.rejects(
    withTenant({ tenantId: A, role: "tenant_admin" }, (tx) =>
      tx.insert(tickets).values({ tenantId: B, departmentId: DEPT_B1, summary: "越界" }).returning(),
    ),
  );
});

test("withAuthLookup 可跨租戶讀 users（供登入查帳號）", async () => {
  const rows = await withAuthLookup((tx) => tx.select().from(users).where(eq(users.email, "a@t.test")));
  assert.equal(rows.length, 1);
});

test("currentTx：無上下文丟錯；txStore.run 後可取得", () => {
  assert.throws(() => currentTx());
  const fake = { marker: true } as unknown as Db;
  assert.equal(
    txStore.run(fake, () => currentTx()),
    fake,
  );
});

test("TenantTxInterceptor：包租戶交易、回傳 handler 結果、寫 audit_log", async () => {
  const interceptor = new TenantTxInterceptor();
  const req = {
    method: "GET",
    url: "/signoff",
    user: { user_id: USER_A, role: "tenant_admin" as const, tenant_id: A, department_id: null },
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as never;
  const next = { handle: () => of({ ok: true }) } as never;
  const result = await firstValueFrom(interceptor.intercept(ctx, next));
  assert.deepEqual(result, { ok: true });
  const audits = await withTenant({ tenantId: A, role: "tenant_admin" }, (tx) => tx.select().from(auditLog));
  assert.ok(audits.some((a) => a.action === "GET /signoff"));
});
