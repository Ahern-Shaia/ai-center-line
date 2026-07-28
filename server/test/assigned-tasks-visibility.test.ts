// 簽核之後任務要留在當責人手上（M6）· docs/modules/task-completion-tracking.md §1.3b
//
// 這支測試盯的是一個**既有缺陷**：
// 原本的條件是 confirm_status IN ('待簽核','逾時警示')，
// 意思是主管一簽核，任務就從當責人的清單消失 ——
// 但簽核代表「AI 抽對了」，不是「工作做完了」。
// 負責的人在「這被確認是一件真任務」的那一刻失去了它。
//
// 直接測 SQL 而不是打 endpoint：這條規則就是那段 WHERE，
// 走 controller 要造 JWT 與一整套 request context，測到的還是同一句話。
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, withSystemTx } from "../src/db/client.js";

interface Seed { tenantId: string; userId: string; deptId: string; cleanup: () => Promise<void> }

async function seed(): Promise<Seed | null> {
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
    const tag = `vis-${randomUUID().slice(0, 8)}`;
    return {
      tenantId: grp.tenant_id, userId: u.rows[0].user_id, deptId: grp.department_id,
      cleanup: () => withTenant({ tenantId: grp.tenant_id, role: "tenant_admin", departmentId: null, userId: null },
        (t) => t.execute(sql`DELETE FROM tickets WHERE summary LIKE ${`${tag}%`}`)).then(() => undefined),
      // tag 透過 summary 前綴帶出去
      ...({ tag } as object),
    } as Seed & { tag: string };
  });
}

const asTenant = <T>(tenantId: string, fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
  withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId: null }, fn);

async function addTicket(s: Seed, summary: string, confirm: string, workStatus: "open" | "closed") {
  await asTenant(s.tenantId, (tx) => tx.execute(sql`
    INSERT INTO tickets (tenant_id, department_id, summary, confirm_status,
                         assignee_user_id, assign_status, work_status,
                         work_outcome, work_closed_at)
    VALUES (${s.tenantId}::uuid, ${s.deptId}::uuid, ${summary}, ${confirm},
            ${s.userId}::uuid, 'assigned', ${workStatus},
            ${workStatus === "closed" ? "完成" : null},
            ${workStatus === "closed" ? sql`now()` : sql`NULL`})
  `));
}

/** 這就是 personal-daily-report.controller.ts 那段 WHERE */
async function visibleTo(s: Seed): Promise<string[]> {
  return asTenant(s.tenantId, async (tx) => {
    const r = await tx.execute<{ summary: string }>(sql`
      SELECT summary FROM tickets
       WHERE assignee_user_id = ${s.userId}::uuid
         AND confirm_status IN ('待簽核', '已簽核', '逾時警示')
         AND work_status = 'open'
       ORDER BY created_at DESC
    `);
    return r.rows.map((x) => x.summary);
  });
}

test("⭐ 主管簽核後，任務仍留在當責人手上（本案要修的既有缺陷）", async () => {
  const s = await seed();
  if (!s) return;
  const tag = (s as Seed & { tag: string }).tag;
  try {
    await addTicket(s, `${tag} 已簽核但還沒做`, "已簽核", "open");
    const list = await visibleTo(s);
    assert.ok(
      list.some((x) => x.startsWith(tag)),
      "簽核代表『AI 抽對了』不是『工作做完了』—— 不該在這一刻把任務從他手上拿走",
    );
  } finally { await s.cleanup(); }
});

test("⭐ 本人標完成之後才消失", async () => {
  const s = await seed();
  if (!s) return;
  const tag = (s as Seed & { tag: string }).tag;
  try {
    await addTicket(s, `${tag} 已回報完成`, "已簽核", "closed");
    const list = await visibleTo(s);
    assert.equal(list.filter((x) => x.startsWith(tag)).length, 0, "本人回報完成才是結束的條件");
  } finally { await s.cleanup(); }
});

test("待簽核的照舊看得到", async () => {
  const s = await seed();
  if (!s) return;
  const tag = (s as Seed & { tag: string }).tag;
  try {
    await addTicket(s, `${tag} 待簽核中`, "待簽核", "open");
    assert.ok((await visibleTo(s)).some((x) => x.startsWith(tag)));
  } finally { await s.cleanup(); }
});

test("⭐ 待確認的不進清單（主管還沒認可為任務）", async () => {
  const s = await seed();
  if (!s) return;
  const tag = (s as Seed & { tag: string }).tag;
  try {
    await addTicket(s, `${tag} 中信心待確認`, "待確認", "open");
    assert.equal(
      (await visibleTo(s)).filter((x) => x.startsWith(tag)).length, 0,
      "提早出現＝要他做一件公司還沒決定要做的事（F-6）",
    );
  } finally { await s.cleanup(); }
});

test("存查與已忽略不進清單", async () => {
  const s = await seed();
  if (!s) return;
  const tag = (s as Seed & { tag: string }).tag;
  try {
    await addTicket(s, `${tag} 公告`, "存查", "open");
    await addTicket(s, `${tag} 不用追`, "已忽略", "open");
    assert.equal((await visibleTo(s)).filter((x) => x.startsWith(tag)).length, 0);
  } finally { await s.cleanup(); }
});
