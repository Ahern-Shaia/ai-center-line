// 批次狀態對帳 · docs/modules/batch-status-reconciliation.md
//
// 起因：`analysis_batch.status` 在 prod 50 筆全部是 `completed`，
// `markFailed()` 從上線到現在沒觸發過一次 —— 一個只有一種值的狀態欄位不帶任何資訊，
// 卻被畫面當成「分析成功」在讀（真正的結果在 `analysis_upload.status`）。
// 其中 6 筆（12%）的分析其實沒完成，而當時沒有任何人知道。
//
// ⚠️ 這裡最重要的是**回寫真的寫進去了**那一條（FMEA §11.1 的 P0）。
//    `analysis_batch` 的 policy 有 `system` 逃生門，但 runJob 用的是裸連線 ——
//    漏設 session 變數的 UPDATE 會**回 0 列而且不報錯**，
//    結果是「裝了儀表但它永遠顯示正常」，比沒裝更糟。已踩 11 次。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";
import { withSystemTx, closeDb } from "../src/db/client.js";
import { deriveAnalysisState, needsAttention, type AnalysisState } from "../src/convo-analysis-realtime/analysis-state.js";
import { AnalysisBatchRepository } from "../src/convo-analysis-realtime/analysis-batch.repository.js";

const T = "b5c00000-0000-4000-8000-00000000b501";
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
/** 應用連線 —— FORCE RLS 對它生效（postgres 是 superuser，會繞過 policy 驗不到東西）*/
const appConn = () => new pg.Client({ connectionString: process.env.DATABASE_URL });

// ⚠️ 回寫測試用**專屬**的 upload/batch（`write`），不共用下面幾筆 ——
//    共用 fixture ＋ 會改資料的測試＝「單獨跑綠、全套跑紅」的經典成因。
//    第一版就是這樣踩到的：回寫測試還原了 status 卻沒還原 error_message。
const ids: { done: number; failed: number; stuck: number; orphan: number; write: number } =
  { done: 0, failed: 0, stuck: 0, orphan: 0, write: 0 };

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'BSR-TEST')`, [T]);

  const mkUpload = async (status: string, err: string | null) => {
    const r = await c.query<{ id: number }>(
      `INSERT INTO analysis_upload (tenant_id, tenant_slug, filename, raw_content, status, error_message)
       VALUES ($1,'bsr','f.txt','x',$2,$3) RETURNING id`, [T, status, err]);
    return r.rows[0].id;
  };
  ids.done = await mkUpload("done", null);
  ids.failed = await mkUpload("failed", "讀不到租戶的抽取模板設定（查詢回 0 列）");
  ids.stuck = await mkUpload("pending", null);
  ids.orphan = await mkUpload("done", null);   // 用來當「手動上傳沒有 batch」
  ids.write = await mkUpload("failed", "回寫測試專用");

  // 四種形狀。completed_at 決定 stale（門檻 30 分鐘 · OQ-BSR-4）
  const mkBatch = async (grp: string, date: string, uploadId: number | null, ago: string) => {
    await c.query(
      `INSERT INTO analysis_batch (tenant_id, group_id, batch_date, upload_id, status, message_count,
                                   triggered_by, started_at, completed_at)
       VALUES ($1,$2,$3,$4,'completed',10,'test', now() - $5::interval, now() - $5::interval)`,
      [T, grp, date, uploadId, ago]);
  };
  await mkBatch("Gdone", "2026-07-20", ids.done, "2 hours");
  await mkBatch("Gfailed", "2026-07-21", ids.failed, "2 hours");
  await mkBatch("Gstuck", "2026-07-22", ids.stuck, "2 hours");    // pending + 超過 30 分 → stuck
  await mkBatch("Gfresh", "2026-07-23", ids.stuck, "1 minute");   // pending + 剛剛 → analyzing
  await mkBatch("Gnoup", "2026-07-24", null, "2 hours");          // 沒有 upload → no_result
  await mkBatch("Gwrite", "2026-07-25", ids.write, "2 hours");    // 回寫測試專用（會被改）
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM analysis_batch WHERE tenant_id = $1`, [T]);
  await c.query(`DELETE FROM analysis_upload WHERE tenant_id = $1`, [T]);
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.end();
  await closeDb();
});

// ── 推導邏輯（純函式）─────────────────────────────────────────────
test("⭐⭐ batch=completed 不代表分析成功 —— 五種結局要分得出來", () => {
  const d = (uploadStatus: string | null, stale: boolean, uploadId: number | null = 1) =>
    deriveAnalysisState({ batchStatus: "completed", uploadId, uploadStatus, stale });

  assert.equal(d("done", true), "analyzed");
  assert.equal(d("failed", true), "analysis_failed");
  assert.equal(d("pending", false), "analyzing", "剛排入不該報成失敗（狼來了會讓人忽略儀表）");
  assert.equal(d("pending", true), "stuck", "排入很久卻沒結果也沒錯誤訊息 —— 最危險的形狀");
  assert.equal(d("running", true), "stuck", "跑到一半死掉也是 stuck（原始 uploadStatus 另外顯示，不猜原因）");
  assert.equal(d(null, true, null), "no_result", "batch 說完成但沒有 upload");
});

test("收訊息階段的失敗與分析階段的失敗不可混為一談", () => {
  const s = (batchStatus: Parameters<typeof deriveAnalysisState>[0]["batchStatus"]) =>
    deriveAnalysisState({ batchStatus, uploadId: null, uploadStatus: null, stale: true });
  assert.equal(s("failed"), "collect_failed");
  assert.equal(s("empty"), "empty", "那天沒訊息不是失敗");
  assert.equal(s("pending"), "queued");
  assert.equal(s("running"), "queued");
});

test("⭐ 需要人看一眼的狀態＝四種（其餘不可混進來製造雜訊）", () => {
  const attention: AnalysisState[] = ["analysis_failed", "stuck", "no_result", "collect_failed"];
  const quiet: AnalysisState[] = ["analyzed", "analyzing", "empty", "queued"];
  for (const s of attention) assert.ok(needsAttention(s), `${s} 應該要人看`);
  for (const s of quiet) assert.ok(!needsAttention(s), `${s} 不該進「需檢查」`);
});

// ── 回寫（FMEA §11.1 的 P0）───────────────────────────────────────
test("⭐⭐ 回寫走 system 上下文時**真的寫進去**（不是 RLS 靜默 0 列）", async () => {
  const res = await withSystemTx((tx) => tx.execute(sql`
    UPDATE analysis_batch SET status='failed', error_message='分析失敗：測試'
     WHERE upload_id = ${ids.write}
  `));
  assert.equal(res.rowCount, 1, "⚠️ 回寫影響 0 列 —— 儀表會永遠顯示正常，比沒有儀表更糟");

  const back = await withSystemTx((tx) => tx.execute<{ status: string }>(sql`
    SELECT status FROM analysis_batch WHERE upload_id = ${ids.write}`));
  assert.equal(back.rows[0].status, "failed", "寫進去了但讀不回來＝policy 兩側不一致");
});

test("⭐⭐ 同一句 UPDATE 少設 session 變數 → 靜默 0 列（這就是為什麼一定要 withSystemTx）", async () => {
  // 這條不是測我們的程式，是**釘住那個危險本身**：
  // 若哪天有人把回寫改成用裸連線，它會安靜地什麼都不做。
  const c = appConn();
  await c.connect();
  try {
    const r = await c.query(
      `UPDATE analysis_batch SET status='failed' WHERE upload_id = $1`, [ids.done]);
    assert.equal(r.rowCount, 0, "若這裡變成 1，表示 analysis_batch 的 RLS 被關掉了 —— 那是另一個問題");
  } finally {
    await c.end();
  }
});

test("手動上傳沒有對應 batch → 回寫 0 列是正常的，不可當成錯誤", async () => {
  const res = await withSystemTx((tx) => tx.execute(sql`
    UPDATE analysis_batch SET status='failed' WHERE upload_id = ${ids.orphan}`));
  assert.equal(res.rowCount, 0, "prod 有 11 筆手動上傳沒有 batch");
});

// ── 列表（M1 · 畫面吃的就是這個）──────────────────────────────────
test("⭐⭐ listByTenant 回的 analysisState 對得上五種形狀", async () => {
  const repo = new AnalysisBatchRepository();
  const rows = await withSystemTx((tx) => repo.listByTenant(tx, { tenantId: T, limit: 50 }));
  const byGroup = new Map(rows.map((r) => [r.groupId, r]));

  assert.equal(byGroup.get("Gdone")?.analysisState, "analyzed");
  assert.equal(byGroup.get("Gfailed")?.analysisState, "analysis_failed");
  assert.equal(byGroup.get("Gstuck")?.analysisState, "stuck");
  assert.equal(byGroup.get("Gfresh")?.analysisState, "analyzing");
  assert.equal(byGroup.get("Gnoup")?.analysisState, "no_result");

  // ⭐ 這五筆的 batch.status **全都是 completed** —— 這就是原本畫面全綠「已完成」的原因。
  //   （Gwrite 不算，它被回寫測試刻意改成 failed。）
  const five = ["Gdone", "Gfailed", "Gstuck", "Gfresh", "Gnoup"];
  for (const g of five) {
    assert.equal(byGroup.get(g)?.status, "completed",
      `fixture 前提：${g} 的 batch.status 要是 completed，差異只在 upload 那側`);
  }
});

test("⭐ 分析階段的錯誤訊息要能帶到畫面（否則只知道失敗、不知道為什麼）", async () => {
  const repo = new AnalysisBatchRepository();
  const rows = await withSystemTx((tx) => repo.listByTenant(tx, { tenantId: T, limit: 50 }));
  const f = rows.find((r) => r.groupId === "Gfailed");
  assert.match(f?.analysisError ?? "", /抽取模板設定/);
  assert.equal(f?.errorMessage, null, "收訊息階段沒失敗，那一欄應該是空的");
});

test("⭐ stuck 時要一起帶原始 uploadStatus（pending＝沒開始 / running＝跑一半，我們不猜）", async () => {
  const repo = new AnalysisBatchRepository();
  const rows = await withSystemTx((tx) => repo.listByTenant(tx, { tenantId: T, limit: 50 }));
  assert.equal(rows.find((r) => r.groupId === "Gstuck")?.uploadStatus, "pending");
});

test("⭐ needsAttention 由後端算並回給前端（避免前後端各存一份狀態集合而漂移）", async () => {
  const repo = new AnalysisBatchRepository();
  const rows = await withSystemTx((tx) => repo.listByTenant(tx, { tenantId: T, limit: 50 }));
  const byGroup = new Map(rows.map((r) => [r.groupId, r]));
  assert.equal(byGroup.get("Gdone")?.needsAttention, false);
  assert.equal(byGroup.get("Gfresh")?.needsAttention, false, "還在跑的不該進需檢查");
  for (const g of ["Gfailed", "Gstuck", "Gnoup"]) {
    assert.equal(byGroup.get(g)?.needsAttention, true, `${g} 應該進「需檢查」`);
  }
});
