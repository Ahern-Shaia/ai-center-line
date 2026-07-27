// 任務歸屬解析 · docs/modules/task-to-personal-report.md §3
//
// 這支測試的重點不是「能不能對到人」，而是「**對不到的時候會不會亂猜**」。
// 把 A 的工作寫進 B 的日報 = 資料錯誤 + 隱私外洩 + 信任崩塌（doc §2 · FMEA F-1/F-2 皆 P0）；
// 不歸屬的代價只是主管手動派。代價完全不對稱 → 寧可不歸屬，不可歸錯人。
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AssigneeResolverService } from "../src/warroom-task-board/assignee-resolver.service.js";
import { withTenant } from "../src/db/client.js";
import { sql } from "drizzle-orm";

const svc = new AssigneeResolverService();
const TENANT = "77777777-0000-0000-0000-000000000001";

// ⚠️ 不能用 withSystemTx：users 的 RLS policy 只認 'aiproot_admin'（或 tenant 相符），
//    不認 'system' —— INSERT 會被靜默擋下。今天已在 tenants 表踩過同一個坑。
const asAdmin = <T>(fn: (tx: Parameters<typeof svc.resolve>[0]) => Promise<T>) =>
  withTenant({ tenantId: TENANT, role: "aiproot_admin" }, fn);

test("沒有人名 → none（AI 沒抽到，不是解析失敗）", async () => {
  await asAdmin(async (tx) => {
    for (const v of [null, "", "   "]) {
      const r = await svc.resolve(tx, TENANT, v);
      assert.equal(r.status, "none");
      assert.equal(r.userId, null);
    }
  });
});

test("查無此人 → unclaimed 且不亂配（絕不回 assigned）", async () => {
  await asAdmin(async (tx) => {
    const r = await svc.resolve(tx, TENANT, `不存在的人_${randomUUID().slice(0, 8)}`);
    assert.equal(r.status, "unclaimed");
    assert.equal(r.userId, null);
    assert.equal(r.reason, "not_in_directory");
  });
});

test("唯一命中系統帳號 → assigned", async () => {
  await asAdmin(async (tx) => {
    const name = `測試員_${randomUUID().slice(0, 8)}`;
    const uid = randomUUID();
    await tx.execute(sql`
      INSERT INTO users (user_id, tenant_id, role, display_name, email)
      VALUES (${uid}::uuid, ${TENANT}::uuid, 'employee', ${name}, ${`${uid}@t.test`})
    `);
    try {
      const r = await svc.resolve(tx, TENANT, name);
      assert.equal(r.status, "assigned");
      assert.equal(r.userId, uid);
      // 大小寫/前後空白不該影響（LINE 顯示名常帶空格）
      const r2 = await svc.resolve(tx, TENANT, `  ${name}  `);
      assert.equal(r2.status, "assigned");
    } finally {
      await tx.execute(sql`DELETE FROM users WHERE user_id = ${uid}::uuid`);
    }
  });
});

test("⭐ 同名多人 → unclaimed · 不用任何啟發式猜測（FMEA F-2 · P0）", async () => {
  await asAdmin(async (tx) => {
    const name = `同名_${randomUUID().slice(0, 8)}`;
    const a = randomUUID(); const b = randomUUID();
    await tx.execute(sql`
      INSERT INTO users (user_id, tenant_id, role, display_name, email) VALUES
        (${a}::uuid, ${TENANT}::uuid, 'employee', ${name}, ${`${a}@t.test`}),
        (${b}::uuid, ${TENANT}::uuid, 'employee', ${name}, ${`${b}@t.test`})
    `);
    try {
      const r = await svc.resolve(tx, TENANT, name);
      assert.equal(r.status, "unclaimed", "同名多人時猜對沒有獎勵，猜錯要付三種代價");
      assert.equal(r.userId, null);
      assert.equal(r.reason, "ambiguous");
    } finally {
      await tx.execute(sql`DELETE FROM users WHERE user_id IN (${a}::uuid, ${b}::uuid)`);
    }
  });
});

test("⭐ 跨租戶同名 → 不得對到別家的人（FMEA F-1 · P0）", async () => {
  await asAdmin(async (tx) => {
    const name = `跨租戶_${randomUUID().slice(0, 8)}`;
    const other = randomUUID();
    const otherTenant = await tx.execute<{ tenant_id: string }>(sql`
      SELECT tenant_id::text FROM tenants WHERE tenant_id <> ${TENANT}::uuid LIMIT 1
    `);
    if (otherTenant.rows.length === 0) return;   // 本機只有一個租戶就跳過
    await tx.execute(sql`
      INSERT INTO users (user_id, tenant_id, role, display_name, email)
      VALUES (${other}::uuid, ${otherTenant.rows[0].tenant_id}::uuid, 'employee', ${name}, ${`${other}@t.test`})
    `);
    try {
      const r = await svc.resolve(tx, TENANT, name);
      assert.notEqual(r.status, "assigned", "別家租戶的同名者絕不可被指派");
      assert.equal(r.userId, null);
    } finally {
      await tx.execute(sql`DELETE FROM users WHERE user_id = ${other}::uuid`);
    }
  });
});

test("directory · 回該租戶可 grounding 的人名候選集", async () => {
  await asAdmin(async (tx) => {
    const names = await svc.directory(tx, TENANT);
    assert.ok(Array.isArray(names));
    assert.ok(names.every((n) => typeof n === "string" && n.trim().length > 0), "不可含空字串");
  });
});
