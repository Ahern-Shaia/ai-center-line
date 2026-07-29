// 材料化 · docs/modules/task-materialization-gate.md
//
// 這支測試存在的理由：materializer 的 UPSERT 是一段長 SQL，
// 純函式測試（ticket-lane.test.ts）不會執行到它。
// 2026-07-28 就在這條路徑上寫了 `= ANY(${jsArray})`——Drizzle 展成 tuple、
// Postgres 42809，型別檢查與單元測試全綠，要真的跑一次分析才會炸。
import { test } from "node:test";
import { constraintOf } from "./pg-constraint.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client.js";
import { TicketMaterializerService } from "../src/warroom-task-board/ticket-materializer.service.js";
import { AssigneeResolverService } from "../src/warroom-task-board/assignee-resolver.service.js";

const svc = new TicketMaterializerService(new AssigneeResolverService());

const admin = <T>(fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
  withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null }, fn);

/** 建一份「已分析完成、有 records」的 upload，回傳 uploadId */
// ⚠️ tickets 的 RLS 沒有 actor_role 逃生門 —— 讀寫都必須帶 current_tenant，
//    只給 aiproot_admin 會靜默回 0 筆（本專案第 6 次踩這個坑）
const asTenant = <T>(tenantId: string, fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
  withTenant({ tenantId, role: "aiproot_admin", departmentId: null, userId: null }, fn);

async function seedUpload(
  records: unknown[],
  /** 0035 · M1 · 這批 blob 逐行對應的 LINE 訊息 id · 不給則沿用舊行為（沒有溯源） */
  opts?: { sourceMessageIds?: string[]; parsedMessageCount?: number },
): Promise<{ uploadId: number; tenantId: string; cleanup: () => Promise<void> } | null> {
  return admin(async (tx) => {
    const g = await tx.execute<{ group_id: string; tenant_id: string }>(sql`
      SELECT g.group_id, b.tenant_id::text
        FROM line_group g JOIN line_bot b ON b.bot_id = g.bot_id
       WHERE g.department_id IS NOT NULL LIMIT 1
    `);
    const grp = g.rows[0];
    if (!grp) return null;
    const u = await tx.execute<{ user_id: string }>(sql`
      SELECT user_id::text FROM users WHERE tenant_id = ${grp.tenant_id}::uuid LIMIT 1
    `);
    if (!u.rows[0]) return null;

    const up = await tx.execute<{ id: string }>(sql`
      INSERT INTO analysis_upload (tenant_id, tenant_slug, filename, raw_content, uploaded_by, status, group_id,
                                   source_message_ids)
      VALUES (${grp.tenant_id}::uuid, 'twh', ${`mat-${randomUUID().slice(0, 8)}.txt`}, '',
              ${u.rows[0].user_id}::uuid, 'done', ${grp.group_id},
              ${opts?.sourceMessageIds
                  ? sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(opts.sourceMessageIds)}::jsonb))::text[]`
                  : sql`NULL::text[]`})
      RETURNING id::text
    `);
    const uploadId = Number(up.rows[0].id);
    // messages 的長度就是「parser 解出幾則」· materializer 用它跟 source_message_ids 對長度
    const msgs = Array.from(
      { length: opts?.parsedMessageCount ?? opts?.sourceMessageIds?.length ?? 0 },
      (_, i) => ({ id: i, text: `m${i}` }),
    );
    await tx.execute(sql`
      INSERT INTO analysis_result (upload_id, records, messages)
      VALUES (${uploadId}, ${JSON.stringify(records)}::jsonb, ${JSON.stringify(msgs)}::jsonb)
    `);
    return {
      uploadId,
      tenantId: grp.tenant_id,
      cleanup: () => asTenant(grp.tenant_id, async (t2) => {
        await t2.execute(sql`DELETE FROM tickets WHERE source_upload_id = ${uploadId}`);
        await t2.execute(sql`DELETE FROM analysis_upload WHERE id = ${uploadId}`);
      }).then(() => undefined),
    };
  });
}

const rec = (title: string, confidence: string, status: string) => ({
  category: "maintenance", title, detail: title, status,
  person: null, machine_code: null, work_order: null,
  source_ids: [1], confidence,
});

async function lanes(tenantId: string, uploadId: number): Promise<Record<string, number>> {
  return asTenant(tenantId, async (tx) => {
    const r = await tx.execute<{ confirm_status: string; n: number }>(sql`
      SELECT confirm_status, count(*)::int AS n FROM tickets
       WHERE source_upload_id = ${uploadId} GROUP BY 1
    `);
    return Object.fromEntries(r.rows.map((x) => [x.confirm_status, x.n]));
  });
}

test("⭐ materialize 的 SQL 真的跑得起來，並按 status 分區", async () => {
  const seeded = await seedUpload([
    rec("待辦一", "high", "open"),
    rec("處理中一", "high", "in_progress"),
    rec("開會通知", "high", "info"),
    rec("已修好", "high", "resolved"),
    rec("中信心待辦", "medium", "open"),
    rec("中信心公告", "medium", "info"),
    rec("低信心", "low", "open"),
  ]);
  if (!seeded) return;
  try {
    const res = await svc.materialize(seeded.uploadId);
    assert.equal(res.inserted, 5, "high 4 張 + medium 待辦 1 張 = 5");
    assert.equal(res.skipped, 2, "中信心公告與低信心不建卡");

    const l = await lanes(seeded.tenantId, seeded.uploadId);
    assert.equal(l["待簽核"], 2, "高信心的待辦才進簽核佇列");
    assert.equal(l["存查"], 2, "公告與已完成轉存查 —— 不是消失");
    assert.equal(l["待確認"], 1, "中信心待辦等主管定奪");
  } finally { await seeded.cleanup(); }
});

test("⭐ 重跑不可復活主管標「不用追」的事（F-3）", async () => {
  const seeded = await seedUpload([rec("中信心待辦", "medium", "open")]);
  if (!seeded) return;
  try {
    await svc.materialize(seeded.uploadId);
    // 主管說不用追
    await asTenant(seeded.tenantId, (tx) => tx.execute(sql`
      UPDATE tickets SET confirm_status = '已忽略' WHERE source_upload_id = ${seeded.uploadId}
    `));
    // 群組重新分析
    await svc.materialize(seeded.uploadId);
    const l = await lanes(seeded.tenantId, seeded.uploadId);
    assert.equal(l["已忽略"], 1, "重跑後又冒出來的話，主管第二次就不會再點了");
    assert.equal(l["待確認"], undefined);
  } finally { await seeded.cleanup(); }
});

test("⭐ 重跑不可蓋掉已簽核", async () => {
  const seeded = await seedUpload([rec("待辦", "high", "open")]);
  if (!seeded) return;
  try {
    await svc.materialize(seeded.uploadId);
    await asTenant(seeded.tenantId, (tx) => tx.execute(sql`
      UPDATE tickets SET confirm_status = '已簽核' WHERE source_upload_id = ${seeded.uploadId}
    `));
    await svc.materialize(seeded.uploadId);
    assert.equal((await lanes(seeded.tenantId, seeded.uploadId))["已簽核"], 1);
  } finally { await seeded.cleanup(); }
});

test("沒人動過的區可以隨重新分析改變（狀態從公告變成待辦）", async () => {
  const seeded = await seedUpload([rec("原本標成公告", "high", "info")]);
  if (!seeded) return;
  try {
    await svc.materialize(seeded.uploadId);
    assert.equal((await lanes(seeded.tenantId, seeded.uploadId))["存查"], 1);
    // 重新分析後 AI 改判成待辦
    await admin((tx) => tx.execute(sql`
      UPDATE analysis_result
         SET records = ${JSON.stringify([rec("原本標成公告", "high", "open")])}::jsonb
       WHERE upload_id = ${seeded.uploadId}
    `));
    await svc.materialize(seeded.uploadId);
    assert.equal((await lanes(seeded.tenantId, seeded.uploadId))["待簽核"], 1, "沒人動過就該跟著 AI 重算");
  } finally { await seeded.cleanup(); }
});

// ── 0035 · M1 · 任務 → 原始 LINE 訊息的鏈 ────────────────────────────
//
// 這條鏈在 prod 斷了很久（35 張任務 0 張有 source_message_ids），
// 而 LINE 引用回覆要靠它才知道該關哪一張任務。斷了就整個功能落空，
// 所以這裡用斷言把它釘住。

const recWithSrc = (title: string, srcIds: number[]) => ({
  category: "maintenance", title, detail: title, status: "open",
  person: null, machine_code: null, work_order: null,
  source_ids: srcIds, confidence: "high",
});

async function srcMsgIds(tenantId: string, uploadId: number): Promise<Record<string, string[] | null>> {
  return asTenant(tenantId, async (tx) => {
    const r = await tx.execute<{ summary: string; ids: string[] | null }>(sql`
      SELECT summary, source_message_ids AS ids FROM tickets WHERE source_upload_id = ${uploadId}
    `);
    return Object.fromEntries(r.rows.map((x) => [x.summary, x.ids]));
  });
}

test("⭐ source_ids 的索引被翻成真實的 LINE 訊息 id", async () => {
  const seeded = await seedUpload(
    [recWithSrc("換軸承", [0, 2]), recWithSrc("叫料", [1])],
    { sourceMessageIds: ["LINE_AAA", "LINE_BBB", "LINE_CCC"] },
  );
  if (!seeded) return;
  try {
    await svc.materialize(seeded.uploadId);
    const m = await srcMsgIds(seeded.tenantId, seeded.uploadId);
    assert.deepEqual(m["換軸承"], ["LINE_AAA", "LINE_CCC"], "索引 0,2 要翻成第 1、第 3 則");
    assert.deepEqual(m["叫料"], ["LINE_BBB"], "索引 1 要翻成第 2 則");
  } finally { await seeded.cleanup(); }
});

test("⭐ 訊息數對不上時寧可留 null，不給錯的溯源", async () => {
  // 來源 3 則、但 parser 只解出 2 則 —— 照索引翻會錯位歸到別則訊息
  const seeded = await seedUpload(
    [recWithSrc("換軸承", [0, 1])],
    { sourceMessageIds: ["LINE_AAA", "LINE_BBB", "LINE_CCC"], parsedMessageCount: 2 },
  );
  if (!seeded) return;
  try {
    await svc.materialize(seeded.uploadId);
    const m = await srcMsgIds(seeded.tenantId, seeded.uploadId);
    assert.equal(m["換軸承"], null, "對不上長度就不寫 —— 錯的溯源比沒有溯源更糟");
  } finally { await seeded.cleanup(); }
});

test("重跑不可把已經有的溯源洗成 null", async () => {
  const seeded = await seedUpload(
    [recWithSrc("換軸承", [0])],
    { sourceMessageIds: ["LINE_AAA"] },
  );
  if (!seeded) return;
  try {
    await svc.materialize(seeded.uploadId);
    // 模擬「第二次跑時對照表不見了」（例如舊 upload 沒有這欄）
    await admin((tx) => tx.execute(sql`
      UPDATE analysis_upload SET source_message_ids = NULL WHERE id = ${seeded.uploadId}
    `));
    await svc.materialize(seeded.uploadId);
    const m = await srcMsgIds(seeded.tenantId, seeded.uploadId);
    assert.deepEqual(m["換軸承"], ["LINE_AAA"], "翻不出來時要保留舊值");
  } finally { await seeded.cleanup(); }
});

// ── 0036 · M2 · 第四條軸不可被 AI 洗掉（F-2 · P0）────────────────────
//
// status 是 AI 讀到的（推論）、work_status 是本人回報的（承諾）。
// materializer 的 UPSERT 沒有把 work_* 列進更新清單，這支測試把它釘住 ——
// 少了它，重跑一次就把人的回報蓋掉，而且不會有任何錯誤訊息。

test("⭐ 重跑不可洗掉本人回報的完成（work_* 不在 UPSERT 更新清單）", async () => {
  const seeded = await seedUpload([rec("換軸承", "high", "open")]);
  if (!seeded) return;
  try {
    await svc.materialize(seeded.uploadId);
    // 當責人在 LINE 回「已完成」
    await asTenant(seeded.tenantId, (tx) => tx.execute(sql`
      UPDATE tickets
         SET work_status = 'closed', work_outcome = '完成',
             work_closed_at = now(), work_closed_via = 'line_reply',
             work_closed_line_user_id = 'U_test', work_note = '換好了'
       WHERE source_upload_id = ${seeded.uploadId}
    `));
    // 隔天重新分析同一批對話
    await svc.materialize(seeded.uploadId);

    const r = await asTenant(seeded.tenantId, (tx) => tx.execute<{
      work_status: string; work_outcome: string | null; work_closed_line_user_id: string | null;
    }>(sql`
      SELECT work_status, work_outcome, work_closed_line_user_id
        FROM tickets WHERE source_upload_id = ${seeded.uploadId}
    `));
    assert.equal(r.rows[0].work_status, "closed", "人的回報不可被 AI 重跑蓋掉");
    assert.equal(r.rows[0].work_outcome, "完成");
    assert.equal(r.rows[0].work_closed_line_user_id, "U_test", "誰回報的也要留著");
  } finally { await seeded.cleanup(); }
});

test("新建的任務預設是 open（尚未確認完成）", async () => {
  const seeded = await seedUpload([rec("換軸承", "high", "open")]);
  if (!seeded) return;
  try {
    await svc.materialize(seeded.uploadId);
    const r = await asTenant(seeded.tenantId, (tx) => tx.execute<{ ws: string; wo: string | null }>(sql`
      SELECT work_status AS ws, work_outcome AS wo FROM tickets WHERE source_upload_id = ${seeded.uploadId}
    `));
    assert.equal(r.rows[0].ws, "open");
    assert.equal(r.rows[0].wo, null, "沒結束就不該有結束原因（跨軸約束）");
  } finally { await seeded.cleanup(); }
});

test("⭐ 跨軸約束擋掉「結束了卻沒說為什麼」", async () => {
  const seeded = await seedUpload([rec("換軸承", "high", "open")]);
  if (!seeded) return;
  try {
    await svc.materialize(seeded.uploadId);
    let thrown: unknown = null;
    try {
      await asTenant(seeded.tenantId, (tx) => tx.execute(sql`
        UPDATE tickets SET work_status = 'closed', work_closed_at = now()
         WHERE source_upload_id = ${seeded.uploadId}
      `));
    } catch (e) { thrown = e; }
    assert.ok(thrown, "沒有這條約束，第一個忘記寫 outcome 的路徑就會製造出永遠算不出來的票");
    assert.equal(
      constraintOf(thrown), "tickets_work_outcome_matches_status",
      "要是被別的原因擋下來（例如 RLS 回 0 筆），這條測試就會為了錯的理由而通過",
    );
  } finally { await seeded.cleanup(); }
});
