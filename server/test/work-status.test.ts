// 網頁端補登與還原（M5）· docs/modules/task-completion-tracking.md §7
//
// ⚠️ 這條路徑是**補登**不是主要入口 —— 主要入口是 LINE 引用回覆
// （當責人 0 人有系統帳號）。這裡給的是主管，也就是那個佇列的洩壓閥。
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, withSystemTx, txStore } from "../src/db/client.js";
import { WorkStatusService } from "../src/task-completion/work-status.service.js";

const svc = new WorkStatusService();

/**
 * ⚠️ 一定要找「**同時**有已分派部門與 users」的租戶。
 *
 * 原本是「拿第一個有部門的群，再查它的 users」—— 那個租戶剛好沒有 users，
 * 於是 seed 回 null，5 個測試全部在 `if (!s) return` 就退出，**綠燈是假的**。
 * 這支測試從寫出來到被發現，一次都沒有真的執行過。
 */
async function seed() {
  // ⚠️ 用 aiproot_admin 不用 withSystemTx —— `users` 的 RLS **不含 system**，
  //    在 withSystemTx 底下查會**靜默回 0 筆**（不報錯），
  //    於是 seed 回 null、測試全部靜默跳過。本專案第 8 次踩「RLS 靜默回 0」。
  return withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
    const r = await tx.execute<{ tenant_id: string; department_id: string; user_id: string }>(sql`
      SELECT b.tenant_id::text, g.department_id::text, u.user_id::text
        FROM line_group g
        JOIN line_bot b ON b.bot_id = g.bot_id
        JOIN users u ON u.tenant_id = b.tenant_id
       WHERE g.department_id IS NOT NULL
       LIMIT 1
    `);
    const row = r.rows[0];
    if (!row) throw new Error("測試資料不足：找不到同時有部門與 users 的租戶（別讓它靜默跳過）");
    return { tenantId: row.tenant_id, deptId: row.department_id, userId: row.user_id };
  });
}

/**
 * WorkStatusService 走 `currentTx()`，那是從 AsyncLocalStorage 取的 ——
 * ⚠️ `withTenant` **只把 tx 當參數傳進來、不會設 ALS**（正式路徑是
 * TenantTxInterceptor 設的）。少了 txStore.run 這一層，service 會直接拋
 * 「無租戶交易上下文」。
 */
const run = <T>(tenantId: string, userId: string, fn: () => Promise<T>) =>
  withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId },
    (tx) => txStore.run(tx, fn));

async function newTicket(s: NonNullable<Awaited<ReturnType<typeof seed>>>): Promise<string> {
  return run(s.tenantId, s.userId, async () => {
    const { currentTx } = await import("../src/db/client.js");
    const r = await currentTx().execute<{ id: string }>(sql`
      INSERT INTO tickets (tenant_id, department_id, summary, confirm_status)
      VALUES (${s.tenantId}::uuid, ${s.deptId}::uuid, ${`ws-${randomUUID().slice(0, 8)}`}, '待簽核')
      RETURNING ticket_id::text AS id
    `);
    return r.rows[0].id;
  });
}

const readBack = (s: { tenantId: string }, id: string) =>
  withTenant({ tenantId: s.tenantId, role: "tenant_admin", departmentId: null, userId: null }, async (tx) => {
    const r = await tx.execute<{
      work_status: string; work_outcome: string | null; work_closed_by: string | null;
      work_closed_via: string | null; work_last_report_note: string | null;
    }>(sql`
      SELECT work_status, work_outcome, work_closed_by::text, work_closed_via, work_last_report_note
        FROM tickets WHERE ticket_id = ${id}::uuid
    `);
    return r.rows[0];
  });

const cleanup = (s: { tenantId: string }, id: string) =>
  withTenant({ tenantId: s.tenantId, role: "tenant_admin", departmentId: null, userId: null },
    (tx) => tx.execute(sql`DELETE FROM tickets WHERE ticket_id = ${id}::uuid`));

test("⭐ 補登結束會記下是誰按的（代結案是必然不是例外）", async () => {
  const s = await seed();
  if (!s) return;
  const id = await newTicket(s);
  try {
    await run(s.tenantId, s.userId, () => svc.close(id, "完成", "現場已處理", s.userId));
    const t = await readBack(s, id);
    assert.equal(t.work_status, "closed");
    assert.equal(t.work_outcome, "完成");
    assert.equal(t.work_closed_via, "web");
    assert.equal(t.work_closed_by, s.userId, "沒記是誰按的話，日後爭議沒有任何證據");
  } finally { await cleanup(s, id); }
});

test("⭐ 可以還原（標錯了沒補救途徑的話沒人敢按）", async () => {
  const s = await seed();
  if (!s) return;
  const id = await newTicket(s);
  try {
    await run(s.tenantId, s.userId, () => svc.close(id, "完成", null, s.userId));
    await run(s.tenantId, s.userId, () => svc.reopen(id, s.userId));
    const t = await readBack(s, id);
    assert.equal(t.work_status, "open");
    assert.equal(t.work_outcome, null, "結束相關欄位要一起清 —— 留半套會被跨軸約束擋下一次寫入");
    assert.equal(t.work_closed_by, null);
  } finally { await cleanup(s, id); }
});

test("⭐ 已結束的不再蓋一次（要改請先還原）", async () => {
  const s = await seed();
  if (!s) return;
  const id = await newTicket(s);
  try {
    await run(s.tenantId, s.userId, () => svc.close(id, "完成", null, s.userId));
    await assert.rejects(
      () => run(s.tenantId, s.userId, () => svc.close(id, "不用做了", null, s.userId)),
      /已經結束/,
      "不擋的話 LINE 回報的紀錄會被網頁悄悄換掉",
    );
    assert.equal((await readBack(s, id)).work_outcome, "完成");
  } finally { await cleanup(s, id); }
});

test("結束原因只認四個值", async () => {
  const s = await seed();
  if (!s) return;
  const id = await newTicket(s);
  try {
    await assert.rejects(
      () => run(s.tenantId, s.userId, () => svc.close(id, "未完成", null, s.userId)),
      /結束原因不正確/,
      "「未完成」這種語意的 outcome 一旦存在，那批票就永遠算不出來（Jira 的經典坑）",
    );
  } finally { await cleanup(s, id); }
});

test("回報進度是低承諾動作 —— 任務留在進行中", async () => {
  const s = await seed();
  if (!s) return;
  const id = await newTicket(s);
  try {
    await run(s.tenantId, s.userId, () => svc.report(id, "零件已叫，週四到貨", s.userId));
    const t = await readBack(s, id);
    assert.equal(t.work_status, "open", "回報不等於結束");
    assert.equal(t.work_last_report_note, "零件已叫，週四到貨");
  } finally { await cleanup(s, id); }
});
