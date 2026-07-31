// 跨批標記洞察（label-driven-improvement M1+M2）· LabelService.getInsights
//
// 守：① 準確率 correct/total 依 target_type 正確彙總
//     ② 「標錯誤」案例能對回內容（classification=訊息 id / record=index）
//     ③ tenantId 過濾：aiproot(null) 看全、指定租戶只看自家
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closeDb } from "../src/db/client.js";
import { LabelService } from "../src/conversation-analysis/label.service.js";

const svc = new LabelService();
const T1 = "b0da0000-0000-4000-8000-00000000b101";
const T2 = "b0da0000-0000-4000-8000-00000000b102";
const U = "b0da0000-0000-4000-8000-00000000b1c1";     // labeled_by
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
let up1 = 0, up2 = 0;

// labeled_by → users 無 cascade：刪租戶會 cascade user，但 label 還指著它 → 先刪 label
async function cleanup(c: pg.Client) {
  await c.query(`DELETE FROM analysis_label WHERE labeled_by=$1`, [U]);
  await c.query(`DELETE FROM tenants WHERE tenant_id = ANY($1)`, [[T1, T2]]);
  await c.query(`DELETE FROM users WHERE user_id=$1`, [U]);
}

before(async () => {
  const c = admin();
  await c.connect();
  await cleanup(c);   // 冪等：清掉上次失敗殘留
  for (const t of [T1, T2]) {
    await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,$2)`, [t, `LI-${t.slice(-3)}`]);
  }
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email) VALUES ($1,$2,'aiproot_admin','標記者',$3)`,
    [U, T1, "li@t.test"]);
  const mkUpload = async (tenant: string, slug: string) => {
    const r = await c.query<{ id: number }>(
      `INSERT INTO analysis_upload (tenant_id, tenant_slug, filename, raw_content) VALUES ($1,$2,$3,'x') RETURNING id`,
      [tenant, slug, `${slug}.txt`]);
    return r.rows[0].id;
  };
  up1 = await mkUpload(T1, "twh");
  up2 = await mkUpload(T2, "other");
  // up1 內容：一則被誤分類的訊息 + 一筆記錄
  await c.query(
    `INSERT INTO analysis_result (upload_id, messages, records, daily_reports) VALUES ($1,$2,$3,'[]'::jsonb)`,
    [up1,
      JSON.stringify([{ id: 7, text: "下午請假半天", category: "attendance" }]),
      JSON.stringify([{ title: "側踏完工", category: "maintenance" }])]);
  const mkLabel = (up: number, tt: string, tid: string, correct: boolean) =>
    c.query(`INSERT INTO analysis_label (upload_id, target_type, target_id, correct, labeled_by) VALUES ($1,$2,$3,$4,$5)`,
      [up, tt, tid, correct, U]);
  await mkLabel(up1, "classification", "7", false);   // T1 · 誤分類（請假被當 attendance 之類）· 錯
  await mkLabel(up1, "record", "0", true);            // T1 · 記錄 · 對
  await mkLabel(up2, "classification", "1", false);   // T2 · 錯（別租戶）
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await cleanup(c);
  await c.end();
  await closeDb();
});

test("⭐ 平台層（aiproot·null）看全部租戶的標記", async () => {
  const r = await svc.getInsights(null);
  assert.equal(r.accuracy.classification.total, 2, "兩租戶各 1 筆 classification");
  assert.equal(r.accuracy.classification.correct, 0, "兩筆都標錯");
  assert.equal(r.accuracy.record.total, 1);
  assert.equal(r.accuracy.record.correct, 1);
});

test("⭐ 指定租戶只看自家（不含別租戶的錯誤）", async () => {
  const r = await svc.getInsights(T2);
  assert.equal(r.accuracy.classification.total, 1, "只有 T2 自己那筆");
  assert.equal(r.errors.length, 1, "T2 一筆錯誤");
  assert.equal(r.errors[0].tenantSlug, "other");
});

test("⭐⭐ 錯誤案例對回內容（classification target_id=訊息 id → 訊息文字）", async () => {
  const r = await svc.getInsights(T1);
  const err = r.errors.find((e) => e.uploadId === up1 && e.targetType === "classification");
  assert.ok(err, "T1 的誤分類應出現在錯誤清單");
  assert.equal(err!.content, "下午請假半天", "要對回那則訊息的原文");
  assert.equal(err!.category, "attendance", "帶出被誤標的分類");
});

test("沒有 analysis_result 的 upload（up2）→ content 空字串不炸", async () => {
  const r = await svc.getInsights(T2);
  assert.equal(typeof r.errors[0].content, "string");
});
