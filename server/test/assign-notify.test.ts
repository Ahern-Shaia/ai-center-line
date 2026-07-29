// 人工指派後通知當事人 · docs/modules/task-assign-notify.md
//
// 這支釘的是 FMEA 裡最貴的兩條：
//   A-1（P0）送不出去而畫面沒說 → **主管以為對方知道了**，事情卡在那裡
//   A-4（P1）主管改來改去 → 當事人被連續私訊 → 關掉通知 → 整個系統失去觸達
//
// ⚠️ 不打真的 LINE API：注入一個假的 LineApiClient，斷言「有沒有送、送給誰、送什麼」。
//    打真的的話測試會依賴外部服務，而且會真的私訊到人。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { withTenant, txStore, currentTx, closeDb } from "../src/db/client.js";
import { AssignNotifyService } from "../src/warroom/assign-notify.service.js";
import { TaskConfigService } from "../src/task-config/task-config.service.js";
import type { LineApiClient } from "../src/line-ingest/line-api.client.js";

const T = "e1e1e1e1-0000-4000-8000-00000000e101";
const DEPT = "e1e1e1e1-0000-4000-8000-00000000de02";
const BOT = "e1e1e1e1-0000-4000-8000-0000000b0703";
const U_BOUND = "e1e1e1e1-0000-4000-8000-000000u50001".replace(/u/g, "5");
const U_UNBOUND = "e1e1e1e1-0000-4000-8000-000000550002";
const LINE_ID = "Uassignnotify0000000000000000001";

/** 假的 LINE client · 記下每次推播 */
const sent: Array<{ token: string; to: string; text: string }> = [];
const fakeLine = {
  pushMessage: async (token: string, to: string, messages: unknown[]) => {
    sent.push({ token, to, text: (messages[0] as { text: string }).text });
    return { messageId: `push-${sent.length}` };
  },
} as unknown as LineApiClient;

const svc = new AssignNotifyService(fakeLine, new TaskConfigService());

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
const asTenant = <R>(fn: () => Promise<R>) =>
  withTenant({ tenantId: T, role: "tenant_admin", departmentId: null, userId: null },
    (tx) => txStore.run(tx, fn));

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'AN-TEST')`, [T]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1,$2,'an-dept','Can','x','x')`, [DEPT, T]);
  const key = process.env.LINE_CONFIG_ENC_KEY ?? "test-only-line-enc-key-32chars---";
  await c.query(
    `INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_secret_enc, channel_access_token_enc)
     VALUES ($1,$2,'an-bot','U_an_bot', pgp_sym_encrypt('sec',$3), pgp_sym_encrypt('TOKEN-AN',$3))`,
    [BOT, T, key]);
  await c.query(
    `INSERT INTO users (user_id, tenant_id, email, display_name, role, must_change_password)
     VALUES ($1,$2,'bound@an.test','有綁定的小明','group_owner',false),
            ($3,$2,'unbound@an.test','沒綁定的小華','group_owner',false)`,
    [U_BOUND, T, U_UNBOUND]);
  await c.query(
    `INSERT INTO user_line_binding (user_id, bot_id, line_user_id, binding_method, status)
     VALUES ($1,$2,$3,'aiproot_manual','active')`, [U_BOUND, BOT, LINE_ID]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.end();
  await closeDb();
});

async function newTicket(summary: string): Promise<string> {
  return asTenant(async () => {
    const r = await currentTx().execute<{ id: string }>(sql`
      INSERT INTO tickets (tenant_id, department_id, summary, confirm_status)
      VALUES (${T}::uuid, ${DEPT}::uuid, ${summary}, '待簽核')
      RETURNING ticket_id::text AS id`);
    return r.rows[0].id;
  });
}

test("⭐ 指派給有綁定的人 → 用該租戶自己的 bot 私訊他", async () => {
  sent.length = 0;
  const id = await newTicket(`派給小明-${randomUUID().slice(0, 6)}`);
  const r = await asTenant(() => svc.onAssigned(currentTx(), {
    ticketId: id, assigneeUserId: U_BOUND, summary: "三號機軸承要換", actorName: "王經理",
  }));

  assert.equal(r.notified, true);
  assert.equal(sent.length, 1, "只推一則");
  assert.equal(sent[0].to, LINE_ID, "推給他本人，不是群組");
  assert.equal(sent[0].token, "TOKEN-AN", "用該租戶自己綁的 bot（跨租戶用錯 token 是 P0）");
  assert.ok(sent[0].text.includes("王經理"), "要說是誰指派的");
  assert.ok(sent[0].text.includes("三號機軸承要換"), "要帶摘要");
  assert.ok(!/日前完成|期限/.test(sent[0].text), "不可寫期限 —— due_at 在 prod 是 100% null");
  // 0046：第一版寫「去群組裡引用訊息回覆」，但完成訊號當時只掛在群組分支，
  // 而人收到私訊會直接在私訊回 → 得到「✓ 已記錄」、任務不動、他以為回報過了。
  assert.ok(!/群組/.test(sent[0].text), "⚠️ 不可以把他導去群組 —— 回報要能在這個私訊裡完成");
});

test("⭐ 記下推播那則的 messageId · 他回覆它時才對得回這張票（快路徑）", async () => {
  sent.length = 0;
  const id = await newTicket(`記 messageId-${randomUUID().slice(0, 6)}`);
  await asTenant(() => svc.onAssigned(currentTx(), {
    ticketId: id, assigneeUserId: U_BOUND, summary: "要記 id", actorName: "王經理",
  }));
  const r = await asTenant(() => currentTx().execute<{ mid: string | null }>(sql`
    SELECT assign_notify_message_id AS mid FROM tickets WHERE ticket_id = ${id}::uuid`));
  assert.equal(r.rows[0].mid, "push-1");
});

test("⭐⭐ 對方沒綁定 → 不推，而且要把原因講出來（A-1 · P0）", async () => {
  sent.length = 0;
  const id = await newTicket(`派給小華-${randomUUID().slice(0, 6)}`);
  const r = await asTenant(() => svc.onAssigned(currentTx(), {
    ticketId: id, assigneeUserId: U_UNBOUND, summary: "客戶回電", actorName: "王經理",
  }));

  assert.equal(sent.length, 0, "沒綁定就不該有推播");
  assert.equal(r.notified, false);
  assert.equal(
    r.skipReason, "no_binding",
    "⚠️ 回 null 或靜默成功的話，主管會以為對方知道了 —— 那是這個模組最貴的失敗",
  );
});

test("⭐ 同一張票對同一人只推一次（A-4 · 不然改來改去就變連續騷擾）", async () => {
  sent.length = 0;
  const id = await newTicket(`重複派-${randomUUID().slice(0, 6)}`);
  await asTenant(() => svc.onAssigned(currentTx(), {
    ticketId: id, assigneeUserId: U_BOUND, summary: "同一件事", actorName: "王經理",
  }));
  const second = await asTenant(() => svc.onAssigned(currentTx(), {
    ticketId: id, assigneeUserId: U_BOUND, summary: "同一件事", actorName: "王經理",
  }));

  assert.equal(sent.length, 1, "第二次不再推");
  assert.equal(second.skipReason, "already_notified");
});

test("⭐ 取消指派 → 只通知原本推過的那個人（A-6）", async () => {
  sent.length = 0;
  const id = await newTicket(`取消-${randomUUID().slice(0, 6)}`);
  await asTenant(() => svc.onAssigned(currentTx(), {
    ticketId: id, assigneeUserId: U_BOUND, summary: "先派給你", actorName: "王經理",
  }));
  assert.equal(sent.length, 1);

  await asTenant(() => svc.onUnassigned(currentTx(), { ticketId: id, summary: "先派給你" }));
  assert.equal(sent.length, 2, "推過的人要被告知不用做了");
  assert.ok(sent[1].text.includes("改由他人處理"));
});

test("沒推過的票取消時不通知（他根本不知道有這件事）", async () => {
  sent.length = 0;
  const id = await newTicket(`沒派過-${randomUUID().slice(0, 6)}`);
  await asTenant(() => svc.onUnassigned(currentTx(), { ticketId: id, summary: "沒人知道" }));
  assert.equal(sent.length, 0);
});

test("⭐ 客戶把通知關掉 → 不推，但指派本身照常（OQ-TAN-4）", async () => {
  sent.length = 0;
  await asTenant(() => currentTx().execute(sql`
    INSERT INTO tenant_task_config (tenant_id, overdue_grace_days, reminder_tier_days, assign_notify_enabled)
    VALUES (${T}::uuid, 7, ARRAY[3,7]::int[], false)
    ON CONFLICT (tenant_id) DO UPDATE SET assign_notify_enabled = false`));
  try {
    const id = await newTicket(`關閉通知-${randomUUID().slice(0, 6)}`);
    const r = await asTenant(() => svc.onAssigned(currentTx(), {
      ticketId: id, assigneeUserId: U_BOUND, summary: "不該推", actorName: "王經理",
    }));
    assert.equal(sent.length, 0);
    assert.equal(r.skipReason, "disabled", "關掉也要講出來，不是靜默");
  } finally {
    await asTenant(() => currentTx().execute(
      sql`DELETE FROM tenant_task_config WHERE tenant_id = ${T}::uuid`));
  }
});

test("⭐ 推播失敗不可以讓指派失敗（A-8）", async () => {
  const boom = {
    pushMessage: async () => { throw new Error("LINE 429 rate limit"); },
  } as unknown as LineApiClient;
  const failing = new AssignNotifyService(boom, new TaskConfigService());

  const id = await newTicket(`推播失敗-${randomUUID().slice(0, 6)}`);
  const r = await asTenant(() => failing.onAssigned(currentTx(), {
    ticketId: id, assigneeUserId: U_BOUND, summary: "會失敗", actorName: "王經理",
  }));

  assert.equal(r.notified, false);
  assert.equal(r.skipReason, "push_failed", "指派已寫進 DB，通知失敗只回報不拋錯");
});
