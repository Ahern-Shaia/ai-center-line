// 私訊裡的完成回報 · docs/modules/task-assign-notify.md §2.6
//
// 這支釘的是使用者當場戳出來的那個問題：
//   「做完後回一句『好了』」—— **可是如果他手上有多個任務，那不就會誤判？**
// 答案不能是「挑最新的那張」。挑錯的下場是**系統宣稱一件沒做完的事做完了**，
// 而且把它從當責人手上拿走 —— 沒有人會發現。所以多張時一律改成問他。
//
// 另外釘一條 IDOR：postback 的 data 是從 client 送回來的，
// 改掉裡面的 ticketId 就能關掉同租戶**別人**的任務（RLS 只擋跨租戶）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";
import { withTenant, txStore, currentTx, closeDb } from "../src/db/client.js";
import { PrivateCompletionService } from "../src/task-completion/private-completion.service.js";

const T = "c0dec0de-0000-4000-8000-00000000c101";
const DEPT = "c0dec0de-0000-4000-8000-00000000de02";
const ME = "c0dec0de-0000-4000-8000-000000005001";
const OTHER = "c0dec0de-0000-4000-8000-000000005002";
const MY_LINE = "Uprivatecompletion00000000000001";

const svc = new PrivateCompletionService();

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
const asTenant = <R>(fn: () => Promise<R>) =>
  withTenant({ tenantId: T, role: "tenant_admin", departmentId: null, userId: null },
    (tx) => txStore.run(tx, fn));

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'PC-TEST')`, [T]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1,$2,'pc-dept','Cpc','x','x')`, [DEPT, T]);
  await c.query(
    `INSERT INTO users (user_id, tenant_id, email, display_name, role, must_change_password)
     VALUES ($1,$2,'me@pc.test','小明','group_owner',false),
            ($3,$2,'other@pc.test','小華','group_owner',false)`, [ME, T, OTHER]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.end();
  await closeDb();
});

/** 建一張指派給某人的開放任務 · notifyMessageId 給了就是「已推播過的那則」 */
async function assignedTicket(
  summary: string, to = ME, notifyMessageId: string | null = null,
): Promise<string> {
  return asTenant(async () => {
    const r = await currentTx().execute<{ id: string }>(sql`
      INSERT INTO tickets (tenant_id, department_id, summary, confirm_status,
                           assignee_user_id, assign_status, assigned_at, assign_notify_message_id)
      VALUES (${T}::uuid, ${DEPT}::uuid, ${summary}, '待簽核',
              ${to}::uuid, 'assigned', now(), ${notifyMessageId})
      RETURNING ticket_id::text AS id`);
    return r.rows[0].id;
  });
}

async function clearTickets(): Promise<void> {
  await asTenant(() => currentTx().execute(sql`DELETE FROM tickets WHERE tenant_id = ${T}::uuid`));
}

const workStatus = (id: string) => asTenant(async () => {
  const r = await currentTx().execute<{ s: string }>(sql`
    SELECT work_status AS s FROM tickets WHERE ticket_id = ${id}::uuid`);
  return r.rows[0]?.s;
});

const say = (text: string, quotedMessageId: string | null = null) => svc.handleText({
  tenantId: T, userId: ME, lineUserId: MY_LINE, text, messageId: "msg-1", quotedMessageId,
});

test("⭐ 手上只有一張 → 直接關掉，不用問", async () => {
  await clearTickets();
  const id = await assignedTicket("三號機軸承要換");

  const reply = await say("好了");
  assert.ok(reply, "要接手（不可以掉回『✓ 已記錄』那條死路）");
  assert.equal(await workStatus(id), "closed");
  const text = (reply![0] as { text: string }).text;
  assert.ok(text.includes("三號機軸承要換"), "要講出關掉的是哪一件 —— 不然他無從發現我們對錯了");
});

test("⭐⭐ 手上有多張 → 一張都不關，出按鈕問他是哪一件", async () => {
  await clearTickets();
  const a = await assignedTicket("三號機軸承要換");
  const b = await assignedTicket("客戶回電確認出貨");

  const reply = await say("好了");
  assert.ok(reply);
  assert.equal(await workStatus(a), "open", "⚠️ 不可以挑一張關掉 —— 這正是使用者擔心的誤判");
  assert.equal(await workStatus(b), "open");

  const tpl = reply![0] as { template?: { actions?: Array<{ data: string }> } };
  const actions = tpl.template?.actions ?? [];
  assert.equal(actions.length, 2, "兩張任務要有兩顆按鈕");
  const targets = actions.map((x) => x.data).sort();
  assert.deepEqual(targets, [`done:${a}`, `done:${b}`].sort(), "按鈕要帶 ticketId，不是編號");
});

test("⭐ 多張時他點了按鈕 → 只關那一張", async () => {
  await clearTickets();
  const a = await assignedTicket("三號機軸承要換");
  const b = await assignedTicket("客戶回電確認出貨");

  await svc.handlePostback({
    tenantId: T, userId: ME, lineUserId: MY_LINE, messageId: "", data: `done:${b}`,
  });
  assert.equal(await workStatus(b), "closed");
  assert.equal(await workStatus(a), "open", "沒點到的那張不可以被波及");
});

test("⭐⭐ postback 改成別人的 ticketId → 關不掉（RLS 只擋跨租戶，擋不住同租戶的別人）", async () => {
  await clearTickets();
  const mine = await assignedTicket("我的事");
  const his = await assignedTicket("小華的事", OTHER);

  const reply = await svc.handlePostback({
    tenantId: T, userId: ME, lineUserId: MY_LINE, messageId: "", data: `done:${his}`,
  });
  assert.equal(await workStatus(his), "open", "⚠️ 不是指派給他的，不可以讓他關掉");
  assert.equal(await workStatus(mine), "open");
  // 講「已改由他人處理」而不是「已完成」—— 後者是假話，而他多半是按到聊天室裡的舊按鈕
  assert.ok((reply![0] as { text: string }).text.includes("改由他人處理"));
});

test("⭐ 快路徑：回覆我們推的那則通知 → 即使手上有多張也精準對到", async () => {
  await clearTickets();
  await assignedTicket("別的事一");
  await assignedTicket("別的事二");
  const target = await assignedTicket("要對到的那件", ME, "push-abc");

  const reply = await say("好了", "push-abc");
  assert.equal(await workStatus(target), "closed", "引用了通知就不該再問他");
  assert.ok((reply![0] as { text: string }).text.includes("要對到的那件"));
});

test("⭐⭐ 疑問句不算完成 —— 「好了嗎」裡面就含「好了」", async () => {
  await clearTickets();
  const id = await assignedTicket("軸承換好了沒");

  const reply = await say("軸承換好了嗎?");
  assert.equal(reply, null, "不接手，讓原本的 ack 照常回");
  assert.equal(await workStatus(id), "open");
});

test("手上沒有指派任務 → 不接手（他那句話不是回報）", async () => {
  await clearTickets();
  assert.equal(await say("好了"), null);
});

test("已經關掉的再點一次 → 講實話，不假裝剛剛關成功", async () => {
  await clearTickets();
  const id = await assignedTicket("只做一次");
  await svc.handlePostback({
    tenantId: T, userId: ME, lineUserId: MY_LINE, messageId: "", data: `done:${id}`,
  });
  const again = await svc.handlePostback({
    tenantId: T, userId: ME, lineUserId: MY_LINE, messageId: "", data: `done:${id}`,
  });
  assert.ok((again![0] as { text: string }).text.includes("已經是完成狀態"));
});
