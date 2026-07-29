// 逾時判定 · 進欄與 pill 必須用同一個門檻
//
// 這支測試存在的理由：先前兩邊各寫一次 7 天，而且寫法不同 ——
//   進欄：now - created > 7×24h        （7.5 天 → 成立）
//   pill：floor(天數) > 7               （7.5 天 → floor=7 → 不成立）
// 於是 7～8 天之間的票**在逾時欄裡卻沒有 pill**，看起來像 pill 壞了。
// 型別檢查與畫面截圖都看不出來，只有剛好卡在那一天的資料才會現形。
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, txStore } from "../src/db/client.js";
import { WarroomTasksService } from "../src/warroom/warroom-tasks.service.js";

const svc = new WarroomTasksService();

async function seed() {
  return withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null },
    async (tx) => {
      const g = await tx.execute<{ tenant_id: string; department_id: string }>(sql`
        SELECT b.tenant_id::text, g.department_id::text
          FROM line_group g JOIN line_bot b ON b.bot_id = g.bot_id
         WHERE g.department_id IS NOT NULL LIMIT 1
      `);
      if (!g.rows[0]) throw new Error("測試資料不足：找不到已分派部門的群（別讓它靜默跳過）");
      return { tenantId: g.rows[0].tenant_id, deptId: g.rows[0].department_id };
    });
}

/**
 * ⚠️ listTasks 走 `currentTx()`（AsyncLocalStorage），而 `withTenant` **只把 tx
 * 當參數傳、不設 ALS**（正式路徑是 TenantTxInterceptor 設的）。
 * 少了 txStore.run 這層，service 會直接拋「無租戶交易上下文」。
 */
const asTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
  withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId: null },
    (tx) => txStore.run(tx, fn));

/** 建一張 N 天前的待簽核票（N 可為小數，用來打門檻邊界） */
async function addAged(s: { tenantId: string; deptId: string }, tag: string, daysAgo: number) {
  await asTenant(s.tenantId, async () => {
    const { currentTx } = await import("../src/db/client.js");
    await currentTx().execute(sql`
      INSERT INTO tickets (tenant_id, department_id, summary, confirm_status, created_at)
      VALUES (${s.tenantId}::uuid, ${s.deptId}::uuid, ${tag}, '待簽核',
              now() - ${`${daysAgo * 24} hours`}::interval)
    `);
  });
}

const cleanup = (tenantId: string, tag: string) =>
  asTenant(tenantId, async () => {
    const { currentTx } = await import("../src/db/client.js");
    await currentTx().execute(sql`DELETE FROM tickets WHERE summary LIKE ${`${tag}%`}`);
  });

async function board(tenantId: string) {
  return asTenant(tenantId, () => svc.listTasks({}));
}

test("⭐ 在逾時欄裡的票一定有天數（進欄與 pill 同一個門檻）", async () => {
  const s = await seed();
  const tag = `ovd-${randomUUID().slice(0, 8)}`;
  try {
    // 7.5 天 —— 正是先前「在欄裡卻沒 pill」的那個縫
    await addAged(s, `${tag}-7.5`, 7.5);
    await addAged(s, `${tag}-9`, 9);
    await addAged(s, `${tag}-3`, 3);

    const b = await board(s.tenantId);
    const mine = b.kanban.overdue.filter((t) => t.summary.startsWith(tag));
    for (const t of mine) {
      assert.notEqual(
        t.overdueDays, null,
        `「${t.summary}」在逾時欄卻沒有天數 —— 兩邊門檻又漂移了`,
      );
    }
    // 3 天的不該進逾時欄
    assert.ok(!mine.some((t) => t.summary.endsWith("-3")), "還沒過寬限期的不該進逾時欄");
  } finally { await cleanup(s.tenantId, tag); }
});

test("⭐ 「逾時 N 天」的 N 是超過期限幾天，不是建立至今幾天", async () => {
  const s = await seed();
  const tag = `ovd2-${randomUUID().slice(0, 8)}`;
  try {
    await addAged(s, `${tag}-25`, 25);
    const b = await board(s.tenantId);
    const t = b.kanban.overdue.find((x) => x.summary.startsWith(tag));
    assert.ok(t, "25 天的票應該在逾時欄");
    // 寬限期 7 天 → 25 天的票逾時 18 天。顯示 25 是誇大（標籤要跟實際相符）
    assert.equal(t!.overdueDays, 18, "顯示 age 的話「逾時 25 天」會誇大 —— 實際只逾了 18 天");
  } finally { await cleanup(s.tenantId, tag); }
});

test("剛好在寬限期邊界的不顯示「逾時 0 天」", async () => {
  const s = await seed();
  const tag = `ovd3-${randomUUID().slice(0, 8)}`;
  try {
    await addAged(s, `${tag}-7.2`, 7.2);
    const b = await board(s.tenantId);
    const all = [...b.kanban.overdue, ...b.kanban.pending].filter((t) => t.summary.startsWith(tag));
    for (const t of all) {
      assert.notEqual(t.overdueDays, 0, "「逾時 0 天」是沒有意義的顯示");
    }
  } finally { await cleanup(s.tenantId, tag); }
});
