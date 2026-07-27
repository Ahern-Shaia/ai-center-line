// 稽核記錄 · 讀 audit_log
//
// 盯三件事：
//   1. SQL 跑得起來（scope 是 SQL 內的三分支條件，型別檢查看不出寫壞）
//   2. 租戶隔離 —— 稽核記錄會寫著「誰做了什麼」，跨租戶看到就是外洩
//   3. 路徑轉中文的正規化 —— UUID 沒被抽掉的話，每筆都會變成一條沒人看得懂的長路徑
import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { withTenant, txStore, type Db } from "../src/db/client.js";
import { AuditService } from "../src/audit/audit.service.js";

const svc = new AuditService();

const asRole = <T>(ctx: { tenantId: string | null; role: string }, fn: () => Promise<T>): Promise<T> =>
  withTenant(
    { tenantId: ctx.tenantId, role: ctx.role as never, departmentId: null, userId: null },
    (tx: Db) => txStore.run(tx, fn),
  );

async function anyTenant(): Promise<string | null> {
  return withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
    const r = await tx.execute<{ tenant_id: string }>(sql`SELECT tenant_id::text FROM tenants LIMIT 1`);
    return r.rows[0]?.tenant_id ?? null;
  });
}

test("三種 scope 的 SQL 都跑得起來", async () => {
  const tenantId = await anyTenant();
  if (!tenantId) return;
  for (const scope of ["all", "write", "login"] as const) {
    const res = await asRole({ tenantId, role: "tenant_admin" }, () => svc.list({ scope }));
    assert.ok(Array.isArray(res.items), `${scope} 應回陣列`);
    assert.equal(res.page, 1);
    assert.equal(typeof res.hasNext, "boolean");
  }
});

test("⭐ write scope 只回變更類 · 不可混進查看紀錄", async () => {
  const tenantId = await anyTenant();
  if (!tenantId) return;
  const res = await asRole({ tenantId, role: "aiproot_admin" }, () => svc.list({ scope: "write" }));
  assert.ok(res.items.every((i) => i.isWrite), "write scope 不該出現 GET");
});

test("⭐ 租戶隔離 · 不存在的租戶看到 0 筆（不會退回全平台）", async () => {
  const res = await asRole(
    { tenantId: "00000000-0000-0000-0000-0000000000ff", role: "tenant_admin" },
    () => svc.list(),
  );
  assert.equal(res.items.length, 0);
});

test("⭐ 路徑轉中文 · UUID 與 query string 要被抽掉，不能整條原文噴出來", async () => {
  const tenantId = await anyTenant();
  if (!tenantId) return;
  const res = await asRole({ tenantId, role: "aiproot_admin" }, () => svc.list({ scope: "all" }));
  for (const i of res.items) {
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(i.action), `動作不該含 UUID：${i.action}`);
    assert.ok(!i.action.includes("?"), `動作不該含 query string：${i.action}`);
  }
});

test("翻頁 · 第二頁不會回到第一頁的內容", async () => {
  const tenantId = await anyTenant();
  if (!tenantId) return;
  const p1 = await asRole({ tenantId, role: "aiproot_admin" }, () => svc.list({ page: 1 }));
  if (!p1.hasNext) return;
  const p2 = await asRole({ tenantId, role: "aiproot_admin" }, () => svc.list({ page: 2 }));
  const ids = new Set(p1.items.map((i) => i.id));
  assert.ok(p2.items.every((i) => !ids.has(i.id)), "第二頁不該重複第一頁的紀錄");
});
