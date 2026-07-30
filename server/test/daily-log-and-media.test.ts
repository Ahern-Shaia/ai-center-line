// 2026-07-29 客戶回報的三件事（都在「畫面上看不出哪裡不對」這一類）
//
// ① 同一個群在同一天出現**兩張卡片**，內容還略有出入
//    → 排程跑一次、有人又手動重跑一次，各留一列 analysis_upload，前端全列出來。
// ② 任務詳情裡的原文只有「[照片]」三個字
//    → 照片早就存在 line_media，只是從沒接到任務詳情，於是主管無法判斷該不該立案。
// ③ AI 抽出 11 項，任務看板卻一張都沒有
//    → 那個群**沒有分派部門**，materializer 直接整批 skip。
//      而這件事只寫在 server log 的一行 warn，畫面上什麼都沒有 ——
//      使用者只能猜「是不是內容不符合形成任務的條件」（客戶原話）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { withTenant, txStore, currentTx, closeDb } from "../src/db/client.js";
import { WarroomTasksService } from "../src/warroom/warroom-tasks.service.js";
import { TaskConfigService } from "../src/task-config/task-config.service.js";

const svc = new WarroomTasksService(new TaskConfigService());

/** 專用租戶 —— 這支會塞 analysis_upload，共用現成的會污染別的測試 */
const T = "d1d1d1d1-0000-4000-8000-00000000d10g".replace("g", "0");
const DEPT = "d1d1d1d1-0000-4000-8000-00000000dep0".replace("p", "0");
const BOT = "d1d1d1d1-0000-4000-8000-0000000b0700";
const G_OK = "Cdl_with_dept_0000000000000001";
const G_NODEPT = "Cdl_no_dept_00000000000000001";
const G_FAIL = "Cdl_analysis_failed_00000000001";
const G_RERUN = "Cdl_rerun_failed_000000000001";
const TODAY = new Date().toISOString().slice(0, 10);

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

const asTenant = <R>(fn: () => Promise<R>) =>
  withTenant({ tenantId: T, role: "tenant_admin", departmentId: null, userId: null },
    (tx) => txStore.run(tx, fn));

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1, 'DL-TEST')`, [T]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1, $2, 'dl-dept', $3, 'x', 'x')`, [DEPT, T, G_OK]);
  const key = process.env.LINE_CONFIG_ENC_KEY ?? "test-only-line-enc-key-32chars---";
  await c.query(
    `INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_secret_enc, channel_access_token_enc)
     VALUES ($1,$2,'dl-bot','U_dl_bot', pgp_sym_encrypt('s',$3), pgp_sym_encrypt('t',$3))`, [BOT, T, key]);
  await c.query(
    `INSERT INTO line_group (bot_id, group_id, department_id, analyze_enabled, display_name)
     VALUES ($1,$2,$3,true,'有部門的群'), ($1,$4,NULL,true,'測試群 · 沒分派部門'),
            ($1,$5,$3,true,'分析失敗的群'), ($1,$6,$3,true,'重跑失敗的群')`,
    [BOT, G_OK, DEPT, G_NODEPT, G_FAIL, G_RERUN]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM analysis_upload WHERE tenant_id = $1`, [T]);
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);   // cascade 其餘
  await c.end();
  await closeDb();
});

/** 建一次分析紀錄。同一組 (group, date) 呼叫兩次＝排程跑完又有人手動重跑 */
async function addAnalysis(groupId: string, note: string, status = "done") {
  const r = await withTenant({ tenantId: null, role: "system", departmentId: null, userId: null },
    (tx) => tx.execute<{ id: number }>(sql`
      INSERT INTO analysis_upload (tenant_id, tenant_slug, filename, raw_content, status, source, group_id, batch_date)
      VALUES (${T}::uuid, 'batch', ${note}, '', ${status}, 'webhook', ${groupId}, ${TODAY}::date)
      RETURNING id`));
  const id = r.rows[0].id;
  await withTenant({ tenantId: null, role: "system", departmentId: null, userId: null },
    (tx) => tx.execute(sql`
      INSERT INTO analysis_result (upload_id, messages, records, daily_reports)
      VALUES (${id}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`));
  return id;
}

test("⭐ 同一個群同一天分析兩次，日誌只顯示最新那一張（不是兩張）", async () => {
  await addAnalysis(G_OK, "第一次 · 排程");
  await addAnalysis(G_OK, "第二次 · 手動重跑");

  const r = await asTenant(() => svc.listDailyReports({ fromDate: TODAY, toDate: TODAY }));
  const mine = (r.days[0]?.uploads ?? []).filter((u) => u.groupId === G_OK);
  assert.equal(
    mine.length, 1,
    "重跑的用意是取代前一次 —— 兩張都列出來，客戶看到的是同一個群重複出現、內容還略有出入",
  );
});

test("⭐ 沒分派部門的群要看得出來（不然使用者只能猜為什麼沒有任務）", async () => {
  await addAnalysis(G_NODEPT, "沒部門的群");

  const r = await asTenant(() => svc.listDailyReports({ fromDate: TODAY, toDate: TODAY }));
  const card = (r.days[0]?.uploads ?? []).find((u) => u.groupId === G_NODEPT);
  assert.ok(card, "這個群的分析結果本身還是要顯示");
  assert.equal(
    card!.departmentId, null,
    "departmentId 要如實回 null，前端才有辦法說「此群尚未分派部門 · 不會變成任務」",
  );

  const withDept = (r.days[0]?.uploads ?? []).find((u) => u.groupId === G_OK);
  assert.ok(withDept?.departmentId, "有部門的群不可被誤標成沒有");
});

test("⭐⭐ 照片要掛在它自己那一則訊息上（索引對齊）", async () => {
  // 這支驗的是整條對照鏈：
  //   analysis_result.messages[i].id  是解析索引
  //   → analysis_upload.source_message_ids[i] 是該則的真實 LINE 訊息 id
  //   → line_media
  // 對錯一格就會把照片掛到隔壁那則訊息上，而畫面看起來一樣正常 ——
  // 所以中間那則刻意是照片，前後刻意是文字。
  const tag = randomUUID().slice(0, 8);
  const ids = [`dl-a-${tag}`, `dl-b-${tag}`, `dl-c-${tag}`];
  const mediaId = randomUUID();

  const uploadId = await withTenant({ tenantId: null, role: "system", departmentId: null, userId: null },
    async (tx) => {
      for (const [i, mid] of ids.entries()) {
        await tx.execute(sql`
          INSERT INTO line_message
            (message_id, tenant_id, bot_id, group_id, department_id, sender_line_id,
             message_type, text_content, sent_at, raw_event, chat_context)
          VALUES (${mid}, ${T}::uuid, ${BOT}::uuid, ${G_OK}, ${DEPT}::uuid, 'Udltest',
                  ${i === 1 ? "image" : "text"}, ${i === 1 ? null : `第 ${i} 則`},
                  now(), '{}'::jsonb, 'group')`);
      }
      await tx.execute(sql`
        INSERT INTO line_media (media_id, tenant_id, message_id, media_type, storage_backend, content_type)
        VALUES (${mediaId}::uuid, ${T}::uuid, ${ids[1]}, 'image', 's3', 'image/jpeg')`);

      const up = await tx.execute<{ id: number }>(sql`
        INSERT INTO analysis_upload
          (tenant_id, tenant_slug, filename, raw_content, status, source, group_id, batch_date, source_message_ids)
        VALUES (${T}::uuid, 'batch', ${`chain-${tag}`}, '', 'done', 'webhook', ${G_OK}, ${TODAY}::date,
                ARRAY[${ids[0]}, ${ids[1]}, ${ids[2]}]::text[])
        RETURNING id`);
      const id = up.rows[0].id;
      await tx.execute(sql`
        INSERT INTO analysis_result (upload_id, messages, records, daily_reports)
        VALUES (${id},
          '[{"id":0,"time":"10:18","sender":"客服","text":"這個中區維修","kind":"text"},
            {"id":1,"time":"10:18","sender":"客服","text":"[照片]","kind":"image"},
            {"id":2,"time":"10:19","sender":"客服","text":"這個可以嗎","kind":"text"}]'::jsonb,
          '[{"title":"中區維修確認","source_ids":[0,1,2],"confidence":"high"}]'::jsonb,
          '[]'::jsonb)`);
      return id;
    });

  const ticketId = await asTenant(async () => {
    const r = await currentTx().execute<{ id: string }>(sql`
      INSERT INTO tickets (tenant_id, department_id, summary, confirm_status,
                           source_upload_id, source_record_index, source_message_ids)
      VALUES (${T}::uuid, ${DEPT}::uuid, 'dl-鏈結測試', '待簽核',
              ${uploadId}, 0, ARRAY[${ids[0]}, ${ids[1]}, ${ids[2]}]::text[])
      RETURNING ticket_id::text AS id`);
    return r.rows[0].id;
  });

  const src = await asTenant(() => svc.ticketSource(ticketId));
  assert.equal(src.hasSourceLink, true);
  assert.equal(src.messages.length, 3, "三則來源訊息都要回");
  assert.equal(src.messages[0].media, null, "第 0 則是文字");
  assert.equal(
    src.messages[1].media?.mediaId, mediaId,
    "照片要掛在第 1 則 —— 掛到 0 或 2 的話畫面一樣正常，但「這個可以嗎」就指錯圖了",
  );
  assert.equal(src.messages[2].media, null, "第 2 則是文字");
});

test("沒有來源訊息 id 的舊任務不會炸，只是沒有照片", async () => {
  const ticketId = await asTenant(async () => {
    const r = await currentTx().execute<{ id: string }>(sql`
      INSERT INTO tickets (tenant_id, department_id, summary, confirm_status)
      VALUES (${T}::uuid, ${DEPT}::uuid, 'dl-舊任務', '待簽核')
      RETURNING ticket_id::text AS id`);
    return r.rows[0].id;
  });
  const src = await asTenant(() => svc.ticketSource(ticketId));
  assert.equal(
    src.hasSourceLink, false,
    "沒有連結要講出來 —— 跟「這幾則訊息確定沒有照片」是兩件事，都留白的話分不出來",
  );
  assert.deepEqual(src.messages.filter((m) => m.media), [], "沒有連結就沒有照片可掛");
});

// ── 分析未完成不可長得像「當日無資料」（batch-status-reconciliation M1.5）──
//
// 原本查詢有 `AND au.status = 'done'`，失敗的那一列**整列被過濾掉**，
// 畫面於是顯示「當日無資料」——跟「那天真的很閒」完全分不出來。
// 客戶看到的是後者，所以不會來問，我們也就不知道漏了一天。

test("⭐⭐ 分析失敗的群仍要出現在日誌，並標成未完成", async () => {
  await addAnalysis(G_FAIL, "分析失敗", "failed");

  const r = await asTenant(() => svc.listDailyReports({ fromDate: TODAY, toDate: TODAY }));
  const card = (r.days[0]?.uploads ?? []).find((u) => u.groupId === G_FAIL);
  assert.ok(card, "⚠️ 失敗的群整列消失＝畫面顯示「當日無資料」，跟那天真的很閒分不出來");
  assert.equal(card!.analysisIncomplete, true, "要標出來，前端才能說「尚未完成」而不是「無資料」");
});

test("⭐ 排了沒跑（pending）也算未完成 —— 那是最難查的形狀，完全沒有錯誤訊息", async () => {
  await addAnalysis(G_FAIL, "排了沒跑", "pending");
  const r = await asTenant(() => svc.listDailyReports({ fromDate: TODAY, toDate: TODAY }));
  const card = (r.days[0]?.uploads ?? []).find((u) => u.groupId === G_FAIL);
  assert.equal(card!.analysisIncomplete, true);
});

test("⭐⭐ 重跑失敗**不可以**蓋掉同一天先前成功的分析", async () => {
  // 把失敗的列一起撈進來之後，若只按 uploaded_at 取最新，一次重跑失敗
  // 就會把有內容的卡片變成一句警語 —— 那是退步。成功優先。
  await addAnalysis(G_RERUN, "第一次 · 成功", "done");
  await addAnalysis(G_RERUN, "第二次 · 重跑失敗", "failed");

  const r = await asTenant(() => svc.listDailyReports({ fromDate: TODAY, toDate: TODAY }));
  const mine = (r.days[0]?.uploads ?? []).filter((u) => u.groupId === G_RERUN);
  assert.equal(mine.length, 1, "仍然只留一張");
  assert.equal(
    mine[0].analysisIncomplete, false,
    "⚠️ 客戶要看得到那天已經抽出來的內容 —— 重跑失敗是營運問題，走 aiproot 的對帳表",
  );
});

test("分析成功的群 analysisIncomplete 必須是 false（不要反過來到處長警語）", async () => {
  await addAnalysis(G_OK, "成功");
  const r = await asTenant(() => svc.listDailyReports({ fromDate: TODAY, toDate: TODAY }));
  const card = (r.days[0]?.uploads ?? []).find((u) => u.groupId === G_OK);
  assert.equal(card!.analysisIncomplete, false);
});
