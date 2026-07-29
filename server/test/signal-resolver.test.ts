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

async function seed(msgText: string | null = "@小陳 麻煩把三號機軸承換一下",
                    messageType = "text"): Promise<Seed | null> {
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
              ${messageType}, ${msgText}, 'group', now(), '{}'::jsonb)
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
    assert.equal(
      await resolutionOf(s), "progress_logged",
      "⚠️ 原本標成 closed_ticket —— 任務明明還開著。prod 上 2 筆「已關閉」全是這種，"
      + "零筆真的關掉任務，而那個標籤當場誤導了排查（同 F-26：標籤要跟實際相符）",
    );
  } finally { await s.cleanup(); }
});

test("⭐⭐ 掛到的任務被刪掉之後，不可以再算成「已接住」", async () => {
  const s = await seed();
  if (!s) throw new Error("測試資料不足（別讓它靜默跳過）");
  try {
    await addTicket(s);
    await addSignal(s, "completion", "已修好");
    await svc.resolvePending(s.tenantId, s.groupId);
    assert.equal(await resolutionOf(s), "closed_ticket", "先確認真的接住了");

    // 分析結果被刪除／重跑時任務會消失（prod 有人手動刪 · task #37）
    await asTenant(s.tenantId, (tx) => tx.execute(sql`
      DELETE FROM tickets WHERE source_message_ids @> ARRAY[${s.msgId}]::text[]`));

    const row = await asTenant(s.tenantId, (tx) => tx.execute<{
      resolution: string | null; resolved_ticket_id: string | null;
    }>(sql`
      SELECT resolution, resolved_ticket_id::text FROM pending_completion_signal
       WHERE quoted_message_id = ${s.msgId} LIMIT 1`));
    const r = row.rows[0];

    assert.equal(r.resolved_ticket_id, null, "ON DELETE SET NULL 會把連結清掉");
    assert.equal(r.resolution, "closed_ticket", "但 resolution 留著 —— 這正是 Bug B 的形狀");
    assert.ok(
      r.resolution !== null && r.resolved_ticket_id === null,
      "後台要靠這個組合推導出「掛到的任務已被刪除」，不可以繼續算成已接住 —— "
      + "否則畫面說接住了，點進去沒有東西",
    );
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

// ── 0047 · 群組回報要檢查當責人 ─────────────────────────────────────
//
// 原本關票的條件只有 `WHERE ticket_id = ...`，完全不看是誰回報的 ——
// 群裡任何人引用一則任務訊息說「已完成」，那張票就關了，即使它是別人的。
// 私訊那條路有 assignee_user_id 把關，這條沒有。
//
// ⚠️ 但不可以一律要求「回報者＝當責人」：prod 45 張裡 38 張根本沒有當責人，
//    目前 10 筆待處理訊號指到的票**全部**是這種。一律檢查等於讓它們永遠關不掉。

/** 建一張指派給某人的票 · 回傳當責人的 user_id */
async function addAssignedTicket(s: Seed): Promise<string> {
  return asTenant(s.tenantId, async (tx) => {
    const u = await tx.execute<{ id: string }>(sql`
      SELECT user_id::text AS id FROM users WHERE tenant_id = ${s.tenantId}::uuid LIMIT 1`);
    const owner = u.rows[0].id;
    await tx.execute(sql`
      INSERT INTO tickets (tenant_id, department_id, summary, confirm_status,
                           source_message_ids, assignee_user_id, assign_status)
      VALUES (${s.tenantId}::uuid, ${s.departmentId}::uuid, '有當責人的票', '待簽核',
              ARRAY[${s.msgId}]::text[], ${owner}::uuid, 'assigned')`);
    return owner;
  });
}

test("⭐⭐ 票有當責人，別人在群裡說「已完成」→ 不關票，記成進度並標 not_assignee", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addAssignedTicket(s);
    await addSignal(s, "completion", "他弄好了");    // 回報者 U_worker 沒有綁定，不是當責人
    const r = await svc.resolvePending(s.tenantId, s.groupId);

    assert.equal(r.notAssignee, 1);
    assert.equal(r.closed, 0, "⚠️ 別人講的不足以代替當責人自己的回報");
    const t = await ticketOf(s);
    assert.equal(t.work_status, "open");
    assert.equal(t.work_last_report_note, "他弄好了", "但那句話是有價值的，要記成進度");
    assert.equal(await resolutionOf(s), "not_assignee", "後台要看得出為什麼沒關");
  } finally { await s.cleanup(); }
});

test("⭐ 票有當責人，而且回報的就是他 → 照關", async () => {
  const s = await seed();
  if (!s) return;
  let owner = "";
  try {
    owner = await addAssignedTicket(s);
    // ⚠️ 這裡不可以用 withSystemTx：user_line_binding 的 policy 內含
    //    `EXISTS (SELECT 1 FROM users ...)`，而 users 沒有 system 逃生門 → 寫入被 RLS 擋。
    //    （production code 走 withTenant 所以沒事，是這支測試的 setup 自己踩到）
    await asTenant(s.tenantId, (tx) => tx.execute(sql`
      INSERT INTO user_line_binding (user_id, bot_id, line_user_id, binding_method, status)
      VALUES (${owner}::uuid, ${s.botId}::uuid, 'U_worker', 'aiproot_manual', 'active')`));
    await addSignal(s, "completion");
    const r = await svc.resolvePending(s.tenantId, s.groupId);

    assert.equal(r.closed, 1);
    assert.equal(r.notAssignee, 0);
    assert.equal((await ticketOf(s)).work_status, "closed");
  } finally {
    await asTenant(s.tenantId, (tx) => tx.execute(
      sql`DELETE FROM user_line_binding WHERE line_user_id = 'U_worker' AND bot_id = ${s.botId}::uuid`));
    await s.cleanup();
  }
});

test("票沒有當責人 → 維持現狀，誰回報都算（38/45 是這種，一律檢查會全部關不掉）", async () => {
  const s = await seed();
  if (!s) return;
  try {
    await addTicket(s);                              // 不帶 assignee_user_id
    await addSignal(s, "completion");
    const r = await svc.resolvePending(s.tenantId, s.groupId);
    assert.equal(r.closed, 1);
    assert.equal(r.notAssignee, 0);
  } finally { await s.cleanup(); }
});

test("⭐⭐ 引用的是照片（沒有文字）→ 補建的摘要要講得出是什麼，不可以是通用字串", async () => {
  // prod 上線後第一筆真實補建就是這種：有人傳照片、別人引用它回「好了」。
  // 舊版摘要一律落到「（來自 LINE 完成回報）」—— 任務建出來了、照片也存著、
  // 點開看得到圖，但**看板上那一行完全不知道發生了什麼事**。
  const s = await seed(null, "image");
  if (!s) return;
  try {
    await asTenant(s.tenantId, (tx) => tx.execute(sql`
      INSERT INTO line_member (tenant_id, bot_id, group_id, user_id, display_name)
      VALUES (${s.tenantId}::uuid, ${s.botId}::uuid, ${s.groupId}, 'U_boss', '陳師傅')
      ON CONFLICT (bot_id, group_id, user_id) DO UPDATE SET display_name = '陳師傅'`));
    await addSignal(s, "completion", "好了");

    const r = await svc.resolvePending(s.tenantId, s.groupId);
    assert.equal(r.created, 1);

    const t = await ticketOf(s);
    assert.equal(t.work_status, "closed");
    const sum = await withTenant(
      { tenantId: s.tenantId, role: "aiproot_admin", departmentId: null, userId: null },
      async (tx) => (await tx.execute<{ summary: string }>(sql`
        SELECT summary FROM tickets WHERE source_message_ids @> ARRAY[${s.msgId}]::text[] LIMIT 1`)
      ).rows[0].summary);

    assert.ok(!sum.includes("來自 LINE 完成回報"), "不可以再落到那句通用字串");
    assert.ok(sum.includes("照片"), "要講出是什麼型別");
    assert.ok(sum.includes("陳師傅"), "要講出是誰傳的 —— 主管才判斷得出要不要點開");
  } finally {
    await asTenant(s.tenantId, (tx) => tx.execute(
      sql`DELETE FROM line_member WHERE bot_id = ${s.botId}::uuid AND user_id = 'U_boss'`));
    await s.cleanup();
  }
});
