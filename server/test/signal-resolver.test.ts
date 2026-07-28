// 完成訊號的對應段（M3b）· docs/modules/task-completion-tracking.md §2.2
//
// ⭐ 這裡驗的是 v2.3 那輪查驗逼出來的設計反轉：
// prod 材料化涵蓋率只有 11%，三則真正的完成回覆原訊息**全部**沒被材料化。
// 若要求「原訊息必須已經是任務」，這個功能一則都接不住 ——
// 所以完成回覆落在非任務訊息上時要**回頭補建**。
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, withSystemTx } from "../src/db/client.js";
import { SignalResolverService } from "../src/task-completion/signal-resolver.service.js";

const svc = new SignalResolverService();

// ⚠️ tickets 的 RLS 是 AND-only、**沒有 actor_role 逃生門** ——
//    withSystemTx（只有 actor_role='system'）讀會回 0 筆、寫會被擋。
//    本專案第 7 次踩這個坑，所以測試裡動 tickets 一律走這個。
const asTenant = <T>(tenantId: string, fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
  withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId: null }, fn);

interface Seed {
  tenantId: string; groupId: string; botId: string; departmentId: string;
  msgId: string; cleanup: () => Promise<void>;
}

async function seed(msgText = "@小陳 麻煩把三號機軸承換一下"): Promise<Seed | null> {
  return withSystemTx(async (tx) => {
    const g = await tx.execute<{ group_id: string; tenant_id: string; bot_id: string; department_id: string }>(sql`
      SELECT g.group_id, b.tenant_id::text, b.bot_id::text, g.department_id::text
        FROM line_group g JOIN line_bot b ON b.bot_id = g.bot_id
       WHERE g.department_id IS NOT NULL LIMIT 1
    `);
    const grp = g.rows[0];
    if (!grp) return null;
    const msgId = `MSG_${randomUUID().slice(0, 12)}`;
    await tx.execute(sql`
      INSERT INTO line_message (message_id, tenant_id, bot_id, group_id, sender_line_id,
                                message_type, text_content, chat_context, sent_at, raw_event)
      VALUES (${msgId}, ${grp.tenant_id}::uuid, ${grp.bot_id}::uuid, ${grp.group_id}, 'U_boss',
              'text', ${msgText}, 'group', now(), '{}'::jsonb)
    `);
    return {
      tenantId: grp.tenant_id, groupId: grp.group_id, botId: grp.bot_id,
      departmentId: grp.department_id, msgId,
      // tickets 的刪除要帶 tenant，否則靜默刪 0 筆、留一堆髒資料在庫裡
      cleanup: async () => {
        await withTenant({ tenantId: grp.tenant_id, role: "tenant_admin", departmentId: null, userId: null },
          (t2) => t2.execute(sql`DELETE FROM tickets WHERE source_message_ids @> ARRAY[${msgId}]::text[]`));
        await withSystemTx(async (t2) => {
          await t2.execute(sql`DELETE FROM pending_completion_signal WHERE quoted_message_id = ${msgId}`);
          await t2.execute(sql`DELETE FROM line_message WHERE message_id = ${msgId}`);
        });
      },
    };
  });
}

async function addSignal(s: Seed, intent: string, note = "換好了") {
  await withSystemTx((tx) => tx.execute(sql`
    INSERT INTO pending_completion_signal
      (tenant_id, group_id, reply_message_id, quoted_message_id, replier_line_user_id, intent, note)
    VALUES (${s.tenantId}::uuid, ${s.groupId}, ${`RP_${randomUUID().slice(0, 12)}`},
            ${s.msgId}, 'U_worker', ${intent}, ${note})
  `));
}

async function addTicket(s: Seed, summary = "換三號機軸承") {
  return asTenant(s.tenantId, async (tx) => {
    const r = await tx.execute<{ id: string }>(sql`
      INSERT INTO tickets (tenant_id, department_id, summary, confirm_status, source_message_ids)
      VALUES (${s.tenantId}::uuid, ${s.departmentId}::uuid, ${summary}, '待簽核',
              ARRAY[${s.msgId}]::text[])
      RETURNING ticket_id::text AS id
    `);
    return r.rows[0].id;
  });
}

const ticketOf = (s: Seed) =>
  withTenant({ tenantId: s.tenantId, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
    const r = await tx.execute<{
      work_status: string; work_outcome: string | null; work_closed_via: string | null;
      work_closed_line_user_id: string | null; work_last_report_note: string | null; confirm_status: string;
    }>(sql`
      SELECT work_status, work_outcome, work_closed_via, work_closed_line_user_id,
             work_last_report_note, confirm_status
        FROM tickets WHERE source_message_ids @> ARRAY[${s.msgId}]::text[] LIMIT 1
    `);
    return r.rows[0];
  });

const resolutionOf = (s: Seed) =>
  withTenant({ tenantId: s.tenantId, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
    const r = await tx.execute<{ resolution: string | null }>(sql`
      SELECT resolution FROM pending_completion_signal WHERE quoted_message_id = ${s.msgId} LIMIT 1
    `);
    return r.rows[0]?.resolution;
  });

test("⭐ 對得上任務 → 關掉，並記下是誰在 LINE 回報的", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s);
    await addSignal(s, "completion");
    const r = await svc.resolvePending(s.tenantId, s.groupId);
    assert.equal(r.closed, 1);

    const t = await ticketOf(s);
    assert.equal(t.work_status, "closed");
    assert.equal(t.work_outcome, "完成");
    assert.equal(t.work_closed_via, "line_reply");
    assert.equal(t.work_closed_line_user_id, "U_worker", "沒有系統帳號也要留得下身分");
  } finally { await s.cleanup(); }
});

test("⭐⭐ 對不上任務但是完成語意 → 回頭補建（材料化涵蓋率只有 11%）", async () => {
  const s = await seed("@Wang C 麻煩鮮湧的10支產品BOM先完成");
  if (!s) return;
  try {
    // 刻意不建任務 —— 這正是 prod 三則真完成回覆的處境
    await addSignal(s, "completion", "鮮湧 10 支產品 BOM已完成（沒有料號的除外）");
    const r = await svc.resolvePending(s.tenantId, s.groupId);
    assert.equal(r.created, 1, "人願意回報完成，那則訊息就是任務 —— 這是人工標註");

    const t = await ticketOf(s);
    assert.equal(t.work_status, "closed");
    assert.equal(t.work_outcome, "完成");
    assert.equal(t.confirm_status, "存查", "事情已經做完，再讓主管簽核一次只是多一個要清的佇列");
    assert.equal(await resolutionOf(s), "created_ticket");
  } finally { await s.cleanup(); }
});

test("⭐ 進度回報對不上任務時不補建（否則每句『零件週四到』都長出一張已完成卡）", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addSignal(s, "progress", "零件已叫，週四到貨");
    const r = await svc.resolvePending(s.tenantId, s.groupId);
    assert.equal(r.created, 0);
    assert.equal(r.noMatch, 1);
    assert.equal(await resolutionOf(s), "no_match", "這才是真的材料化漏接，可以拿去校準門檻");
  } finally { await s.cleanup(); }
});

test("進度回報對得上任務 → 記一筆，任務留著", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s);
    await addSignal(s, "progress", "零件已叫，週四到貨");
    await svc.resolvePending(s.tenantId, s.groupId);

    const t = await ticketOf(s);
    assert.equal(t.work_status, "open", "有進展不等於做完");
    assert.equal(t.work_last_report_note, "零件已叫，週四到貨", "主管靠這個分辨久懸 vs 有進展");
  } finally { await s.cleanup(); }
});

test("⭐ 已經被結掉的任務不再蓋一次（人可能已在網頁補登）", async () => {
  const s = await seed();
  if (!s) return;
  try {
    const tid = await addTicket(s);
    await asTenant(s.tenantId, (tx) => tx.execute(sql`
      UPDATE tickets SET work_status='closed', work_outcome='不用做了',
             work_closed_at=now(), work_closed_via='web'
       WHERE ticket_id = ${tid}::uuid
    `));
    await addSignal(s, "completion");
    await svc.resolvePending(s.tenantId, s.groupId);

    const t = await ticketOf(s);
    assert.equal(t.work_outcome, "不用做了", "人的決定優先，不被後到的訊號蓋掉");
    assert.equal(await resolutionOf(s), "superseded");
  } finally { await s.cleanup(); }
});

test("⭐ 問過但還沒回答的先留著（人可能等一下才按）", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s);
    await addSignal(s, "asked", "快好了");
    const r = await svc.resolvePending(s.tenantId, s.groupId);
    assert.equal(r.asked, 1);
    assert.equal(await resolutionOf(s), null, "還沒消化 —— 不是 no_match，別拿去校準門檻");
    assert.equal((await ticketOf(s)).work_status, "open");
  } finally { await s.cleanup(); }
});

test("消化過的訊號不會被重掃（跑兩次結果一樣）", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s);
    await addSignal(s, "completion");
    await svc.resolvePending(s.tenantId, s.groupId);
    const second = await svc.resolvePending(s.tenantId, s.groupId);
    assert.equal(second.closed, 0);
    assert.equal(second.created, 0);
  } finally { await s.cleanup(); }
});
