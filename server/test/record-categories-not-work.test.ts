// 紀錄類分類不進工作生命週期（0063）
//
// 2026-08-12：台灣福祉的群組裡，機器人對「大文 8/10 工作日報」回了一句
// 「尚未確認完成 · 做完了就引用那則訊息回一句就好」。
// 日報是**已經做完的紀錄**，不是待辦 —— 那句話讀不通。
//
// 根因：work_status 預設 'open' 對所有 category 一視同仁。
// prod 實查：open 的日報 66 筆、出勤 18 筆、閒聊 3 筆，其中 17 筆已經會顯示給員工、涉及 9 人。
//
// ⚠️ 修法刻意是「把『這不是工作』寫進資料」而不是在每個查詢加 category 過濾 ——
//    消費端有提醒／結案率／任務看板三處，各自加過濾的話第四處一定會漏。

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closeDb } from "../src/db/client.js";

const TENANT = "cc000000-0000-4000-8000-00000000cc01";
const DEPT = "cc000000-0000-4000-8000-00000000cd01";   // tickets.department_id 是 NOT NULL
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

/** 直接用 materializer 那支判準（原本這裡複製了一份，兩邊會各自長大）*/
import { workStatusFor } from "../src/warroom-task-board/ticket-lane.js";

// [category, status, expected]
const CASES: Array<[string | null, string | null, string]> = [
  // 紀錄類分類 —— status 是什麼都不進工作生命週期（0063）
  ["daily_report", "open", "record"],
  ["attendance", "open", "record"],
  ["chitchat", null, "record"],
  // 任務類 · 該追的
  ["maintenance", "open", "open"],
  ["rnd", "in_progress", "open"],
  ["procurement", null, "open"],
  ["sales", "open", "open"],
  ["it_support", "open", "open"],
  [null, "open", "open"],
  // 2026-08-18 · status=info 不是待辦（經驗提醒／法規說明／選型結論）
  ["maintenance", "info", "record"],
  ["rnd", "info", "record"],
  ["sales", "info", "record"],
  // ⭐ resolved 刻意**維持 open** —— AI 讀到「好了」是推論不是本人承諾，留給當事人確認
  ["maintenance", "resolved", "open"],
  ["procurement", "resolved", "open"],
];

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`SELECT set_config('app.actor_role','aiproot_admin',true)`);
  await c.query(`SELECT set_config('app.current_tenant',$1,true)`, [TENANT]);
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [TENANT]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'RCN-測試租戶')`, [TENANT]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1,$2,'RCN-部門','Crcn0000000000000000000000000001','default','rcn')`,
    [DEPT, TENANT]);
  let i = 0;
  for (const [cat, st, ws] of CASES) {    // CASES 是 [category, status, expected]
    await c.query(
      `INSERT INTO tickets (tenant_id, department_id, category, summary, confidence, confirm_status, status, work_status)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'high', '待簽核', $5, $6)`,
      [TENANT, DEPT, cat, `RCN-${i++}`, st, ws]);
  }
  // 有人標過完成的紀錄類 —— migration 不可以翻案
  await c.query(
    // closed 必須同時有 work_closed_at —— tickets_work_outcome_matches_status 會擋
    `INSERT INTO tickets (tenant_id, department_id, category, summary, confidence, confirm_status,
                          work_status, work_outcome, work_closed_at)
     VALUES ($1::uuid,$2::uuid,'daily_report','RCN-已被人結案','high','待簽核','closed','完成',now())`,
    [TENANT, DEPT]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`SELECT set_config('app.actor_role','aiproot_admin',true)`);
  await c.query(`SELECT set_config('app.current_tenant',$1,true)`, [TENANT]);
  await c.query(`DELETE FROM tickets WHERE tenant_id=$1`, [TENANT]);
  await c.query(`DELETE FROM departments WHERE tenant_id=$1`, [TENANT]);
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [TENANT]);
  await c.end();
  await closeDb();
});

test("⭐⭐ 紀錄類分類與 status=info → record，其餘 → open", () => {
  for (const [cat, status, expected] of CASES) {
    assert.equal(workStatusFor(cat, status), expected, `category=${cat} status=${status}`);
  }
});

test("⭐⭐ resolved 不可以被自動擋掉 —— 那是 AI 的推論，要留給當事人確認", () => {
  assert.equal(workStatusFor("maintenance", "resolved"), "open");
  assert.equal(workStatusFor("rnd", "resolved"), "open");
});

test("⭐ 紀錄類不會出現在「尚未確認完成」的查詢裡", async () => {
  const c = admin();
  await c.connect();
  await c.query(`SELECT set_config('app.actor_role','aiproot_admin',true)`);
  await c.query(`SELECT set_config('app.current_tenant',$1,true)`, [TENANT]);
  // 這就是提醒／結案率／看板共用的那個條件
  const r = await c.query(
    `SELECT category FROM tickets WHERE tenant_id=$1::uuid AND work_status='open' ORDER BY category`, [TENANT]);
  await c.end();
  const cats = r.rows.map((x) => x.category);
  for (const rec of ["daily_report", "attendance", "chitchat"]) {
    assert.ok(!cats.includes(rec), `${rec} 不該出現在 open 清單`);
  }
  assert.ok(cats.includes("maintenance"), "真正的任務仍要在");
  assert.equal(cats.length, 8, "6 個任務類 + 2 個 resolved（刻意留給當事人確認）");
});

test("⭐⭐ status=info 不會出現在「尚未確認完成」的查詢裡（2026-08-18）", async () => {
  const c = admin();
  await c.connect();
  await c.query(`SELECT set_config('app.actor_role','aiproot_admin',true)`);
  await c.query(`SELECT set_config('app.current_tenant',$1,true)`, [TENANT]);
  const r = await c.query<{ status: string | null }>(
    `SELECT status FROM tickets WHERE tenant_id=$1::uuid AND work_status='open'`, [TENANT]);
  await c.end();
  const statuses = r.rows.map((x) => x.status);
  assert.ok(!statuses.includes("info"), "純資訊不該躺在任何人的待辦清單裡");
  assert.ok(statuses.includes("resolved"), "resolved 仍要在 —— AI 的推論要留給當事人確認");
});

test("⭐ 結案率的分母排除紀錄類（它們永遠不會被「完成」）", async () => {
  const c = admin();
  await c.connect();
  await c.query(`SELECT set_config('app.actor_role','aiproot_admin',true)`);
  await c.query(`SELECT set_config('app.current_tenant',$1,true)`, [TENANT]);
  const r = await c.query<{ done: string; open: string }>(
    `SELECT count(*) FILTER (WHERE work_outcome='完成') AS done,
            count(*) FILTER (WHERE work_status='open') AS open
       FROM tickets WHERE tenant_id=$1::uuid`, [TENANT]);
  await c.end();
  assert.equal(Number(r.rows[0].open), 8, "分母只算真正的任務");
  assert.equal(Number(r.rows[0].done), 1, "人標過完成的那筆仍然算數");
});

test("⭐⭐ migration 重跑不會翻案人已經標過的（work_outcome 有值就不動）", async () => {
  const c = admin();
  await c.connect();
  await c.query(`SELECT set_config('app.actor_role','aiproot_admin',true)`);
  await c.query(`SELECT set_config('app.current_tenant',$1,true)`, [TENANT]);
  // 重跑 0063 的回填語句
  await c.query(`
    UPDATE tickets SET work_status='record'
     WHERE category IN ('daily_report','attendance','chitchat')
       AND work_status='open' AND work_outcome IS NULL`);
  const r = await c.query(
    `SELECT work_status, work_outcome FROM tickets
      WHERE tenant_id=$1::uuid AND summary='RCN-已被人結案'`, [TENANT]);
  await c.end();
  assert.equal(r.rows[0].work_status, "closed", "人結過案的不可以被改成 record");
  assert.equal(r.rows[0].work_outcome, "完成");
});
