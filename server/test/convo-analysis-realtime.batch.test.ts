// convo-analysis-realtime M2 · Batch pipeline 銜接測試
// 覆蓋 4 case：
// 1. formatAsLineExport · line_message rows → parser.ts 認得的 blob
// 2. listByGroupDay · UTC+8 邊界正確 (23:59 昨天 vs 00:01 今天)
// 3. AnalysisBatchRepository · startBatch 冪等 UNIQUE (tenant, group, date)
// 4. AnalysisBatchRepository · markEmpty / markCompleted / markFailed 狀態轉移

import { test, before, after } from "node:test";
import type { AnalysisBatchService } from "../src/convo-analysis-realtime/analysis-batch.service.js";
import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";
import { withSystemTx, closeDb } from "../src/db/client.js";
import { LineMessageRepository } from "../src/line-ingest/line-message.repository.js";
import { AnalysisBatchRepository } from "../src/convo-analysis-realtime/analysis-batch.repository.js";
import { formatAsLineExport } from "../src/convo-analysis-realtime/line-message.formatter.js";

const T = "77777777-cccc-cccc-cccc-777777777771";
const BOT = "bb000000-0000-0000-0000-000000000c01";
const GROUP_ID = "Ctestbatch-realtime-000000000001";
const MSG_A = "msgbatch-a-000000000001";
const MSG_B = "msgbatch-b-000000000002";
const MSG_C_YESTERDAY = "msgbatch-c-yesterday-000003";

const messageRepo = new LineMessageRepository();
const batchRepo = new AnalysisBatchRepository();

before(async () => {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();

  await c.query(`SET session_replication_role = replica`);
  await c.query(`DELETE FROM analysis_batch WHERE tenant_id = $1`, [T]);
  await c.query(`DELETE FROM analysis_upload WHERE tenant_id = $1`, [T]);
  await c.query(`DELETE FROM line_message WHERE tenant_id = $1`, [T]);
  await c.query(`DELETE FROM line_group WHERE bot_id = $1`, [BOT]);
  await c.query(`DELETE FROM line_bot WHERE bot_id = $1`, [BOT]);
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`SET session_replication_role = origin`);

  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1, 'CAR-M2-T')`, [T]);
  const encKey = process.env.LINE_CONFIG_ENC_KEY ?? "test-only-line-enc-key-32chars---";
  await c.query(
    `INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_secret_enc, channel_access_token_enc)
     VALUES ($1, $2, 'bot-M2', 'U_bot_m2_test', pgp_sym_encrypt('s', $3), pgp_sym_encrypt('t', $3))`,
    [BOT, T, encKey],
  );
  await c.query(
    `INSERT INTO line_group (bot_id, group_id, display_name, analyze_enabled)
     VALUES ($1, $2, 'M2 測試群', false)`,
    [BOT, GROUP_ID],
  );

  // 3 條訊息 · 2 條在 2026-07-21 (UTC+8)· 1 條剛好在 UTC 23:00 屬 2026-07-22 (UTC+8) 邊界
  // 2026-07-21 10:00 UTC = 18:00 台灣 (2026-07-21)
  // 2026-07-21 16:00 UTC = 00:00 台灣 (2026-07-22) · 邊界剛好隔天
  // 2026-07-20 16:00 UTC = 00:00 台灣 (2026-07-21) · 邊界剛好進當天
  await c.query(
    `INSERT INTO line_message (message_id, tenant_id, bot_id, group_id, message_type, text_content, sent_at, raw_event)
     VALUES
       ($1, $4, $5, $6, 'text', '早安 開機測試', '2026-07-20 16:30:00+00', '{}'::jsonb),
       ($2, $4, $5, $6, 'text', '中午吃了鹽酥雞', '2026-07-21 04:00:00+00', '{}'::jsonb),
       ($3, $4, $5, $6, 'text', '前一天訊息',      '2026-07-19 04:00:00+00', '{}'::jsonb)`,
    [MSG_A, MSG_B, MSG_C_YESTERDAY, T, BOT, GROUP_ID],
  );

  await c.end();
});

after(async () => {
  await closeDb();
});

// 1. formatAsLineExport
test("formatAsLineExport · 拼出 parser 認得的 zh-TW 匯出格式", () => {
  const blob = formatAsLineExport("測試群名", "2026-07-21", [
    {
      messageId: "m1",
      senderLineId: "Uabcdef123456",
      senderDisplayName: null,
      messageType: "text",
      textContent: "早安",
      stickerRef: null,
      sentAt: new Date("2026-07-21T00:30:00Z"),   // UTC+8 = 08:30 上午
    },
    {
      messageId: "m2",
      senderLineId: "Uabcdef123456",
      senderDisplayName: null,
      messageType: "image",
      textContent: null,
      stickerRef: null,
      sentAt: new Date("2026-07-21T06:15:00Z"),   // UTC+8 = 14:15 下午
    },
    {
      messageId: "m3",
      senderLineId: null,
      senderDisplayName: null,
      messageType: "sticker",
      textContent: null,
      stickerRef: { packageId: "1", stickerId: "2" },
      sentAt: new Date("2026-07-21T09:00:00Z"),   // UTC+8 = 17:00 下午
    },
  ]);

  assert.match(blob, /^\[LINE\] 測試群名 的聊天記錄/);
  assert.match(blob, /儲存日期：/);
  assert.match(blob, /2026\/7\/21（[一二三四五六日]）/);
  assert.match(blob, /上午8:30\t成員_123456\t早安/);
  assert.match(blob, /下午2:15\t成員_123456\t\[照片\]/);
  assert.match(blob, /下午5:0?0\t\(未知\)\t\[貼圖\]/);
});

// 2. listByGroupDay · UTC+8 邊界
test("listByGroupDay · 抓 2026-07-21 (UTC+8) 該天訊息 · 邊界含頭不含尾", async () => {
  const msgs = await withSystemTx((tx) => messageRepo.listByGroupDay(tx, {
    tenantId: T,
    groupId: GROUP_ID,
    batchDate: "2026-07-21",
  }));
  // 應含 MSG_A (2026-07-21 00:30 台灣) + MSG_B (2026-07-21 12:00 台灣)
  // 不含 MSG_C_YESTERDAY (2026-07-19 12:00 台灣)
  const ids = msgs.map((m) => m.messageId).sort();
  assert.deepEqual(ids, [MSG_A, MSG_B].sort(), `應含 A + B · 得 ${ids.join(",")}`);
});

// 3. startBatch 冪等
test("startBatch 冪等 · 同 (tenant, group, date) 二次不重覆", async () => {
  const first = await withSystemTx((tx) => batchRepo.startBatch(tx, {
    tenantId: T,
    groupId: GROUP_ID,
    batchDate: "2026-07-21",
    triggeredBy: "cron",
  }));
  assert.ok(first.batchId);
  assert.equal(first.isFirst, true, "第一次應 isFirst=true");

  const second = await withSystemTx((tx) => batchRepo.startBatch(tx, {
    tenantId: T,
    groupId: GROUP_ID,
    batchDate: "2026-07-21",
    triggeredBy: "manual:00000000-0000-0000-0000-000000000001",
  }));
  assert.equal(second.batchId, first.batchId, "二次應回同一 batchId (UNIQUE 命中)");
  assert.equal(second.isFirst, false, "二次 isFirst=false");

  // triggered_by 應覆蓋成 manual
  const rows = await withSystemTx((tx) => tx.execute<{ triggered_by: string; status: string }>(sql`
    SELECT triggered_by, status FROM analysis_batch WHERE batch_id = ${first.batchId}::uuid
  `));
  assert.match(rows.rows[0].triggered_by, /^manual:/, "triggered_by 應覆蓋");
  assert.equal(rows.rows[0].status, "running", "狀態應回 running (手動重跑)");
});

// 4. markEmpty / markCompleted / markFailed
test("狀態轉移 · empty / completed / failed 都可 transition", async () => {
  const { batchId: idA } = await withSystemTx((tx) => batchRepo.startBatch(tx, {
    tenantId: T,
    groupId: GROUP_ID,
    batchDate: "2026-08-01",
    triggeredBy: "cron",
  }));
  await withSystemTx((tx) => batchRepo.markEmpty(tx, idA));

  // 先建 stub analysis_upload · 後才能 markCompleted (FK)
  const stubUpload = await withSystemTx((tx) => tx.execute<{ id: string }>(sql`
    INSERT INTO analysis_upload (tenant_id, tenant_slug, filename, raw_content, status, source)
    VALUES (${T}::uuid, 'batch-test', '[stub]', 'stub content', 'done', 'webhook')
    RETURNING id::text
  `));
  const stubUploadId = parseInt(stubUpload.rows[0].id, 10);

  const { batchId: idB } = await withSystemTx((tx) => batchRepo.startBatch(tx, {
    tenantId: T,
    groupId: GROUP_ID,
    batchDate: "2026-08-02",
    triggeredBy: "cron",
  }));
  await withSystemTx((tx) => batchRepo.markCompleted(tx, idB, { uploadId: stubUploadId, messageCount: 5 }));

  const { batchId: idC } = await withSystemTx((tx) => batchRepo.startBatch(tx, {
    tenantId: T,
    groupId: GROUP_ID,
    batchDate: "2026-08-03",
    triggeredBy: "cron",
  }));
  await withSystemTx((tx) => batchRepo.markFailed(tx, idC, "Anthropic 500 test"));

  const rows = await withSystemTx((tx) => tx.execute<{ batch_id: string; status: string; error_message: string | null; message_count: number }>(sql`
    SELECT batch_id, status, error_message, message_count FROM analysis_batch
    WHERE batch_id IN (${idA}::uuid, ${idB}::uuid, ${idC}::uuid)
  `));
  const map = new Map(rows.rows.map((r) => [r.batch_id, r]));
  assert.equal(map.get(idA)!.status, "empty");
  assert.equal(map.get(idB)!.status, "completed");
  assert.equal(map.get(idB)!.message_count, 5);
  assert.equal(map.get(idC)!.status, "failed");
  assert.match(map.get(idC)!.error_message ?? "", /Anthropic 500 test/);
});

// ── 「completed」是批次不是分析 ────────────────────────────────────
//
// 2026-07-29 實際誤判過：手動重跑，API 回 `status: "completed"`，
// 立刻去查 analysis_result 拿到 0 筆，差點認定重跑失敗 ——
// 實際上分析還在背景跑（prod 109 則約 1 分鐘）。
//
// 這條釘的是型別與語意：回應必須另外講清楚分析的去向，
// 不可以讓呼叫端只憑 status 判斷「有沒有結果了」。
test("⭐ 批次回應要分得出「批次完成」與「分析完成」", () => {
  type BatchResult = Awaited<ReturnType<AnalysisBatchService["runBatch"]>>;

  // 編譯期就擋住：少了 analysis 欄位這行過不了
  const queued: BatchResult = {
    batchId: "x", status: "completed", analysis: "queued", uploadId: 1, messageCount: 109,
  };

  assert.equal(
    queued.analysis, "queued",
    "status=completed 只代表訊息收齊、分析已排入；analysis 才說得出有沒有結果",
  );
  // 措辭紀律：呼叫端要靠 analysis 決定講什麼，不是靠 status
  const wording = queued.analysis === "queued" ? "已排入分析" : "完成";
  assert.equal(wording, "已排入分析", "說「完成」會讓人當下重新整理看不到結果就以為失敗");
});
