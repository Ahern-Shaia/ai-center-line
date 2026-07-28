// 完成訊號的即時段（M3a）· docs/modules/task-completion-tracking.md §2.6
//
// 這支測試盯的是**時序**：訊號落地時任務通常還不存在（prod 案例差 21 小時），
// 所以 capture() 刻意不去找任務。純函式測試（completion-intent.test.ts）
// 涵蓋判定邏輯，這裡涵蓋落庫與回話。
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, withSystemTx } from "../src/db/client.js";
import { CompletionSignalService } from "../src/task-completion/completion-signal.service.js";

const svc = new CompletionSignalService();

async function seedGroupMessage(): Promise<{
  tenantId: string; groupId: string; botId: string;
  quotedId: string; quotedSender: string; cleanup: () => Promise<void>;
} | null> {
  return withSystemTx(async (tx) => {
    const g = await tx.execute<{ group_id: string; tenant_id: string; bot_id: string }>(sql`
      SELECT g.group_id, b.tenant_id::text, b.bot_id::text
        FROM line_group g JOIN line_bot b ON b.bot_id = g.bot_id
       WHERE g.department_id IS NOT NULL LIMIT 1
    `);
    const grp = g.rows[0];
    if (!grp) return null;

    const quotedId = `QT_${randomUUID().slice(0, 12)}`;
    const quotedSender = `U_boss_${randomUUID().slice(0, 6)}`;
    await tx.execute(sql`
      INSERT INTO line_message (message_id, tenant_id, bot_id, group_id, sender_line_id,
                                message_type, text_content, chat_context, sent_at, raw_event)
      VALUES (${quotedId}, ${grp.tenant_id}::uuid, ${grp.bot_id}::uuid, ${grp.group_id}, ${quotedSender},
              'text', '@小陳 麻煩把三號機軸承換一下', 'group', now(), '{}'::jsonb)
    `);
    return {
      tenantId: grp.tenant_id, groupId: grp.group_id, botId: grp.bot_id,
      quotedId, quotedSender,
      cleanup: () => withSystemTx(async (t2) => {
        await t2.execute(sql`DELETE FROM pending_completion_signal WHERE quoted_message_id = ${quotedId}`);
        await t2.execute(sql`DELETE FROM line_message WHERE message_id = ${quotedId}`);
      }).then(() => undefined),
    };
  });
}

const capture = (s: NonNullable<Awaited<ReturnType<typeof seedGroupMessage>>>, text: string, replier: string) =>
  withSystemTx((tx) => svc.capture(tx, {
    tenantId: s.tenantId, groupId: s.groupId,
    replyMessageId: `RP_${randomUUID().slice(0, 12)}`,
    quotedMessageId: s.quotedId,
    replierLineUserId: replier,
    replierDisplayName: null,
    text,
  }));

async function signals(tenantId: string, quotedId: string) {
  return withTenant({ tenantId, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
    const r = await tx.execute<{ intent: string; resolved_at: string | null }>(sql`
      SELECT intent, resolved_at::text FROM pending_completion_signal
       WHERE quoted_message_id = ${quotedId} ORDER BY received_at
    `);
    return r.rows;
  });
}

test("⭐ 完成回覆會落地，且**不需要任務存在**（時序解耦）", async () => {
  const s = await seedGroupMessage();
  if (!s) return;
  try {
    const r = await capture(s, "換好了，順便清了濾網", "U_worker");
    assert.equal(r.intent, "completion");
    assert.ok(r.reply?.includes("已收到完成回報"), "要立刻給回饋，不然人下次就不回了");

    const rows = await signals(s.tenantId, s.quotedId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].intent, "completion");
    assert.equal(rows[0].resolved_at, null, "當下不對應任務 —— 那是批次跑完才做的事");
  } finally { await s.cleanup(); }
});

test("⭐ 指派者自己引用自己追進度 → 不落訊號、不回話", async () => {
  const s = await seedGroupMessage();
  if (!s) return;
  try {
    const r = await capture(s, "軸承換好了嗎", s.quotedSender);
    assert.equal(r.intent, "follow_up");
    assert.equal(r.reply, null, "催問回話等於在群裡多嘴");
    assert.equal((await signals(s.tenantId, s.quotedId)).length, 0, "催問不是狀態回報，不該落訊號");
  } finally { await s.cleanup(); }
});

test("⭐ 不確定時就地問一句（問「你剛回覆的這件」不問任務）", async () => {
  const s = await seedGroupMessage();
  if (!s) return;
  try {
    const r = await capture(s, "快好了", "U_worker");
    assert.equal(r.intent, "ask");
    assert.ok(r.reply?.includes("你剛回覆的這件"), "當下任務還不存在，只能指訊息");

    const rows = await signals(s.tenantId, s.quotedId);
    assert.equal(rows[0].intent, "asked", "問過了要記下來，避免重複問同一件");
  } finally { await s.cleanup(); }
});

test("進度回報落地但不回話（每則都回等於洗版）", async () => {
  const s = await seedGroupMessage();
  if (!s) return;
  try {
    const r = await capture(s, "零件已叫，週四到貨", "U_worker");
    assert.equal(r.intent, "progress");
    assert.equal(r.reply, null);
    assert.equal((await signals(s.tenantId, s.quotedId))[0].intent, "progress");
  } finally { await s.cleanup(); }
});

test("⭐ 同一則回覆重送不會落兩筆（webhook 會重送）", async () => {
  const s = await seedGroupMessage();
  if (!s) return;
  try {
    const replyId = `RP_${randomUUID().slice(0, 12)}`;
    const once = () => withSystemTx((tx) => svc.capture(tx, {
      tenantId: s.tenantId, groupId: s.groupId,
      replyMessageId: replyId, quotedMessageId: s.quotedId,
      replierLineUserId: "U_worker", replierDisplayName: null, text: "已完成",
    }));
    await once();
    await once();
    assert.equal((await signals(s.tenantId, s.quotedId)).length, 1);
  } finally { await s.cleanup(); }
});
