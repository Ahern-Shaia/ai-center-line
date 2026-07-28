// 網頁端補登與還原（M5）· docs/modules/task-completion-tracking.md §7
//
// ⚠️ 這條路徑是**補登**不是主要入口 —— 主要入口是 LINE 引用回覆
// （當責人 0 人有系統帳號）。這裡給的是主管，也就是那個佇列的洩壓閥。
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, withSystemTx } from "../src/db/client.js";
import { WorkStatusService } from "../src/task-completion/work-status.service.js";

const svc = new WorkStatusService();

async function seed() {
  return withSystemTx(async (tx) => {
    const g = await tx.execute<{ tenant_id: string; department_id: string }>(sql`
      SELECT b.tenant_id::text, g.department_id::text
        FROM line_group g JOIN line_bot b ON b.bot_id = g.bot_id
       WHERE g.department_id IS NOT NULL LIMIT 1
    `);
    const grp = g.rows[0];
    if (!grp) return null;
    const u = await tx.execute<{ user_id: string }>(sql`
      SELECT user_id::text FROM users WHERE tenant_id = ${grp.tenant_id}::uuid LIMIT 1
    `);
    if (!u.rows[0]) return null;
    return { tenantId: grp.tenant_id, deptId: grp.department_id, userId: u.rows[0].user_id };
  });
}

/** WorkStatusService 走 currentTx()，所以測試要在同一個 tenant tx 內跑 */
const run = <T>(tenantId: string, userId: string, fn: () => Promise<T>) =>
  withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId }, fn);

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
