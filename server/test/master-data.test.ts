// 主檔同步 · docs/modules/master-data-sync.md
//
// 兩個最怕的：
//   ① 同步壞了沒人知道（F-4）—— 主檔停止更新不會有任何畫面變紅
//   ② 來源刪掉的客戶被我們一起刪（F-6）—— 歷史打卡還指著那個名字
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client.js";
import { MasterDataRepository } from "../src/master-data/master-data.repository.js";

const repo = new MasterDataRepository();
const TENANT = "77777777-0000-0000-0000-000000000001";
const CONN = "test-conn";

const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
  withTenant({ tenantId: TENANT, role: "aiproot_admin", departmentId: null, userId: null }, fn);

const cleanup = () => asTenant(async (tx) => {
  await tx.execute(sql`DELETE FROM data_sync_customer WHERE source_connector = ${CONN}`);
  await tx.execute(sql`DELETE FROM master_data_source WHERE tenant_id = ${TENANT}::uuid`);
});

const cust = (id: string, name: string, code: string | null = null) =>
  ({ sourceRecordId: id, name, code, sheetPath: "/customer/6" });

test("⭐ 來源刪掉的客戶標 inactive 不刪（歷史紀錄還指著它 · F-6）", async () => {
  try {
    await asTenant(async (tx) => {
      await repo.replaceCustomers(tx, TENANT, CONN, [cust("1", "雲林順益"), cust("2", "彰化員榮")]);
      assert.equal(await repo.countCustomers(tx, TENANT), 2);
    });
    // 第二次同步只剩一筆 → 另一筆應該停用但還在
    await asTenant(async (tx) => {
      await repo.replaceCustomers(tx, TENANT, CONN, [cust("1", "雲林順益")]);
      assert.equal(await repo.countCustomers(tx, TENANT), 1, "只剩一筆是啟用的");
      const all = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM data_sync_customer WHERE source_connector = ${CONN}
      `);
      assert.equal(all.rows[0].n, 2, "另一筆仍然在資料庫裡，只是停用");
    });
  } finally { await cleanup(); }
});

test("⭐ 拉到 0 筆時不可停用任何客戶（比較可能是 API 壞了，不是客戶刪光名冊）", async () => {
  try {
    await asTenant(async (tx) => {
      await repo.replaceCustomers(tx, TENANT, CONN, [cust("1", "雲林順益"), cust("2", "彰化員榮")]);
      await repo.replaceCustomers(tx, TENANT, CONN, []);
      assert.equal(await repo.countCustomers(tx, TENANT), 2, "空結果一律不動既有資料");
    });
  } finally { await cleanup(); }
});

test("客戶名稱可搜尋（打卡選單與 AI 候選集共用）", async () => {
  try {
    await asTenant(async (tx) => {
      await repo.replaceCustomers(tx, TENANT, CONN, [
        cust("1", "雲林順益斗六廠", "C001"), cust("2", "彰化員榮醫院", "C002"),
      ]);
      const hit = await repo.searchCustomers(tx, TENANT, "雲林");
      assert.equal(hit.length, 1);
      assert.equal(hit[0].name, "雲林順益斗六廠");
      assert.equal(hit[0].code, "C001");
      assert.equal((await repo.searchCustomers(tx, TENANT, "")).length, 2, "空關鍵字回全部");
    });
  } finally { await cleanup(); }
});

test("⭐ 同步失敗必須留下痕跡（否則主檔停更沒人會發現 · F-4）", async () => {
  try {
    await asTenant(async (tx) => {
      await repo.upsertSource(tx, {
        tenantId: TENANT, kind: "customer", provider: "ragic",
        accountId: null, sheetPath: "/customer/6", nameField: "1001", codeField: null,
      });
      const src = await repo.getSource(tx, TENANT);
      assert.ok(src);
      await repo.recordSyncResult(tx, src!.sourceId, null, "API key 過期");

      const after = await repo.getSource(tx, TENANT);
      assert.equal(after!.lastSyncError, "API key 過期");
      assert.ok(after!.lastSyncAt, "失敗也要記時間 —— 否則畫面上看不出多久沒同步了");
    });
  } finally { await cleanup(); }
});

test("成功後要把上次的錯誤清掉（否則會一直顯示舊錯誤）", async () => {
  try {
    await asTenant(async (tx) => {
      await repo.upsertSource(tx, {
        tenantId: TENANT, kind: "customer", provider: "ragic",
        accountId: null, sheetPath: "/customer/6", nameField: "1001", codeField: null,
      });
      const src = (await repo.getSource(tx, TENANT))!;
      await repo.recordSyncResult(tx, src.sourceId, null, "壞掉了");
      await repo.recordSyncResult(tx, src.sourceId, 12, null);
      const after = await repo.getSource(tx, TENANT);
      assert.equal(after!.lastSyncError, null);
      assert.equal(after!.lastSyncCount, 12);
    });
  } finally { await cleanup(); }
});

test("⭐ 一種主檔只准一個來源（UNIQUE 撞則更新，不會長出第二筆）", async () => {
  try {
    await asTenant(async (tx) => {
      for (const path of ["/customer/6", "/customer/9"]) {
        await repo.upsertSource(tx, {
          tenantId: TENANT, kind: "customer", provider: "ragic",
          accountId: null, sheetPath: path, nameField: "1001", codeField: null,
        });
      }
      const n = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM master_data_source WHERE tenant_id = ${TENANT}::uuid
      `);
      assert.equal(n.rows[0].n, 1);
      assert.equal((await repo.getSource(tx, TENANT))!.sheetPath, "/customer/9", "後蓋前");
    });
  } finally { await cleanup(); }
});
