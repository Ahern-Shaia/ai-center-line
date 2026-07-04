// M3 測試：簽核狀態機 + 低信心防呆 + warroom ÷N 重算。跑真 Docker Postgres。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTenant, txStore, closeDb, type Db } from "../src/db/client.js";
import { SignoffService } from "../src/signoff/signoff.service.js";
import { WarroomService } from "../src/warroom/warroom.service.js";

const T = "44444444-4444-4444-4444-444444444444"; // 專用租戶，避免與其他測試檔平行衝突
const U = "40000000-0000-0000-0000-000000000444";
const dA = "d0000000-0000-0000-0000-0000000000a1";
const dB = "d0000000-0000-0000-0000-0000000000b1";
const dC = "d0000000-0000-0000-0000-0000000000c1";
const tAhigh = "50000000-0000-0000-0000-0000000000a1";
const tAlow = "50000000-0000-0000-0000-0000000000a2";
const tBsigned = "50000000-0000-0000-0000-0000000000b1";
const tChigh = "50000000-0000-0000-0000-0000000000c1";

const ctx = { tenantId: T, role: "tenant_admin" as const };
const signoff = new SignoffService();
const warroom = new WarroomService();

// 在租戶交易＋txStore 上下文中執行 service（模擬 TenantTxInterceptor）
function inTx<X>(fn: (tx: Db) => Promise<X>): Promise<X> {
  return withTenant(ctx, (tx) => txStore.run(tx, () => fn(tx)));
}

before(async () => {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'T4')`, [T]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table) VALUES
     ($1,$4,'A','GA','s','R'),($2,$4,'B','GB','s','R'),($3,$4,'C','GC','s','R')`,
    [dA, dB, dC, T],
  );
  await c.query(`INSERT INTO users (user_id, tenant_id, role, email) VALUES ($1,$2,'tenant_admin','u4@t.test')`, [U, T]);
  await c.query(
    `INSERT INTO tickets (ticket_id, tenant_id, department_id, summary, confidence, confirm_status, needs_review, created_at) VALUES
     ($1,$5,$6,'A-high','high','待簽核',false,now()),
     ($2,$5,$6,'A-low','low','待簽核',true,now()),
     ($3,$5,$7,'B-signed','high','已簽核',false,now()),
     ($4,$5,$8,'C-high','high','待簽核',false,now())`,
    [tAhigh, tAlow, tBsigned, tChigh, T, dA, dB, dC],
  );
  await c.end();
});

after(async () => {
  await closeDb();
});

test("warroom 初始：dept_count=3、已簽 1（dB）、signoff=1/3（÷N）", async () => {
  const w = await inTx(() => warroom.warroom());
  assert.equal(w.dept_count, 3);
  assert.equal(w.signed_depts, 1);
  assert.ok(Math.abs(w.signoff_rate - 1 / 3) < 0.001);
});

test("confirm 一般單：待簽核→已簽核，warroom ÷N 重算 1/3→2/3", async () => {
  const r = await inTx(() => signoff.confirm(U, [tChigh]));
  assert.deepEqual(r.confirmed, [tChigh]);
  const w = await inTx(() => warroom.warroom());
  assert.equal(w.signed_depts, 2); // dB + dC
  assert.ok(Math.abs(w.signoff_rate - 2 / 3) < 0.001);
});

test("confirm 低信心單：blocked、不簽（防呆）", async () => {
  const r = await inTx(() => signoff.confirm(U, [tAlow]));
  assert.equal(r.confirmed.length, 0);
  assert.equal(r.blocked.length, 1);
  assert.equal(r.blocked[0].ticket_id, tAlow);
});

test("confirm 已簽核單：skipped（不重複簽）", async () => {
  const r = await inTx(() => signoff.confirm(U, [tBsigned]));
  assert.equal(r.confirmed.length, 0);
  assert.deepEqual(r.skipped, [tBsigned]);
});
