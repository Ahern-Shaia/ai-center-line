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

/** 直接照 materializer 的規則插一張卡（不跑整條 pipeline，只釘住分流本身）*/
const RECORD_CATEGORIES = new Set(["daily_report", "attendance", "chitchat"]);
const workStatusFor = (category: string | null) =>
  RECORD_CATEGORIES.has(category ?? "") ? "record" : "open";

const CASES: Array<[string | null, string]> = [
  ["daily_report", "record"],
  ["attendance", "record"],
  ["chitchat", "record"],
  ["maintenance", "open"],
  ["rnd", "open"],
  ["procurement", "open"],
  ["sales", "open"],
  ["it_support", "open"],
  [null, "open"],
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
  for (const [cat, ws] of CASES) {
    await c.query(
      `INSERT INTO tickets (tenant_id, department_id, category, summary, confidence, confirm_status, work_status)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'high', '待簽核', $5)`,
      [TENANT, DEPT, cat, `RCN-${i++}`, ws]);
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

test("⭐⭐ 日報／出勤／閒聊 → record，其餘 → open", () => {
  for (const [cat, expected] of CASES) {
    assert.equal(workStatusFor(cat), expected, `category=${cat}`);
  }
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
  assert.equal(cats.length, 6, "5 個任務類 + 1 個沒有分類的");
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
  assert.equal(Number(r.rows[0].open), 6, "分母只算真正的任務");
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
