// 材料化 · docs/modules/task-materialization-gate.md
//
// 這支測試存在的理由：materializer 的 UPSERT 是一段長 SQL，
// 純函式測試（ticket-lane.test.ts）不會執行到它。
// 2026-07-28 就在這條路徑上寫了 `= ANY(${jsArray})`——Drizzle 展成 tuple、
// Postgres 42809，型別檢查與單元測試全綠，要真的跑一次分析才會炸。
import { test } from "node:test";
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

async function seedUpload(records: unknown[]): Promise<{ uploadId: number; tenantId: string; cleanup: () => Promise<void> } | null> {
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
      INSERT INTO analysis_upload (tenant_id, tenant_slug, filename, raw_content, uploaded_by, status, group_id)
      VALUES (${grp.tenant_id}::uuid, 'twh', ${`mat-${randomUUID().slice(0, 8)}.txt`}, '',
              ${u.rows[0].user_id}::uuid, 'done', ${grp.group_id})
      RETURNING id::text
    `);
    const uploadId = Number(up.rows[0].id);
    await tx.execute(sql`
      INSERT INTO analysis_result (upload_id, records)
      VALUES (${uploadId}, ${JSON.stringify(records)}::jsonb)
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
