// 通知紀錄分頁 · 時間範圍 · 狀態計數
//
// 2026-08-12：LogsTab 寫死 limit:100，prod 已累積 70 筆（五週）——
// 依現行速度約兩週後開始靜默截斷，「上週三那筆為什麼沒通知」就是查不到。
// 改成時間範圍 + 分頁後，這幾件事必須釘住：
//
// ⚠️ statusCounts 刻意**不受 status 篩選影響**（但受 from / ruleId 影響）。
//    否則點了「推送失敗」之後其他狀態全變 0，篩選列等於失效。
// ⚠️ total 與實際列數對不上是分頁最典型的 off-by-one。

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { HubAuditRepository } from "../src/notification-hub/audit.repository.js";
import { closeDb } from "../src/db/client.js";

const RULE = "ab000000-0000-4000-8000-0000000000a7";
const OTHER_RULE = "ab000000-0000-4000-8000-0000000000b7";
const repo = new HubAuditRepository();
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

// 台北當天 00:00（timestamptz）· DB 跑 UTC，所以邊界一定要用台北算
const T0 = `(date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei')`;

// ⚠️ 全部相對 T0 而非相對 now()：用 `now() - interval '2 hours'` 的話，
//    測試在台北 00:00–02:00 之間跑會掉到前一天 → 時綠時紅的經典成因。
const SEED: Array<{ at: string; status: string }> = [
  { at: `${T0} + interval '1 hour'`,   status: "line_failed" },   // 今天
  { at: `${T0} + interval '30 min'`,   status: "sent" },          // 今天
  { at: `${T0}`,                       status: "sent" },          // ← 邊界：台北 00:00 要含入
  { at: `${T0} - interval '30 min'`,   status: "sent" },          // ← 邊界：昨天 23:30 要排除
  { at: `${T0} - interval '10 days'`,  status: "sent" },
  { at: `${T0} - interval '11 days'`,  status: "sent" },
  { at: `${T0} - interval '12 days'`,  status: "line_failed" },
  { at: `${T0} - interval '13 days'`,  status: "skipped_dedup" },
];

/** 使用者講的「今天」是台北的今天，不是 UTC 的 */
const taipeiToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM notification_log WHERE rule_id = ANY($1::uuid[])`, [[RULE, OTHER_RULE]]);
  let i = 0;
  for (const s of SEED) {
    await c.query(
      `INSERT INTO notification_log (received_at, trigger, sheet_path, record_id, status, latency_ms, rule_id)
       VALUES (${s.at}, 'save', '/paging-test/1', $1, $2, 10, $3::uuid)`,
      [1000 + i++, s.status, RULE]);
  }
  // 另一條規則的資料 · 用來確認 ruleId 篩選真的有隔離
  await c.query(
    `INSERT INTO notification_log (received_at, trigger, sheet_path, record_id, status, latency_ms, rule_id)
     VALUES (now(), 'save', '/paging-test/2', 9001, 'sent', 10, $1::uuid)`, [OTHER_RULE]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM notification_log WHERE rule_id = ANY($1::uuid[])`, [[RULE, OTHER_RULE]]);
  await c.end();
  await closeDb();
});

const list = (o: Partial<Parameters<typeof repo.list>[0]> = {}) =>
  repo.list({ page: 1, pageSize: 25, ruleId: RULE, ...o });

test("⭐ 分頁真的跳過前面的列，且不重複不漏", async () => {
  const p1 = await list({ pageSize: 3, page: 1 });
  const p2 = await list({ pageSize: 3, page: 2 });
  const p3 = await list({ pageSize: 3, page: 3 });
  assert.equal(p1.rows.length, 3);
  assert.equal(p2.rows.length, 3);
  assert.equal(p3.rows.length, 2, "8 筆分 3 頁，最後一頁 2 筆");

  const ids = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.recordId);
  assert.equal(new Set(ids).size, 8, "三頁加起來不可以有重複");
});

test("⭐ total 與實際筆數一致（分頁最典型的 off-by-one）", async () => {
  for (const page of [1, 2, 3]) {
    const r = await list({ pageSize: 3, page });
    assert.equal(r.total, 8, `第 ${page} 頁回報的 total 也要是全部筆數`);
  }
});

test("依 received_at 由新到舊", async () => {
  const r = await list();
  const times = r.rows.map((x) => new Date(x.receivedAt).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test("⭐⭐ statusCounts 不受 status 篩選影響", async () => {
  const all = await list();
  assert.deepEqual(all.statusCounts, { sent: 5, line_failed: 2, skipped_dedup: 1 });

  const filtered = await list({ status: "line_failed" });
  assert.equal(filtered.rows.length, 2, "列表要被篩選");
  assert.equal(filtered.total, 2, "total 要跟著篩選走");
  assert.deepEqual(filtered.statusCounts, { sent: 5, line_failed: 2, skipped_dedup: 1 },
    "但計數不可以跟著變 —— 否則其他狀態全變 0，篩選列失效");
});

test("⭐ statusCounts 受時間範圍影響（近 7 天有幾筆失敗才有意義）", async () => {
  const r = await list({ from: taipeiToday() });
  assert.deepEqual(r.statusCounts, { sent: 2, line_failed: 1 },
    "10 天前那批不算進來；skipped_dedup 整個消失而不是 0");
});

test("⭐⭐ from 邊界用台北時間切，不是 UTC", async () => {
  const r = await list({ from: taipeiToday() });
  assert.equal(r.total, 3,
    "台北 00:00 那筆要含入、昨天 23:30 那筆要排除。DB 跑 UTC，" +
    "若直接拿 `received_at >= from::date` 比，「今天」會從台北早上 8 點才開始");
});

test("from 不給就是不限", async () => {
  const r = await list({ from: null });
  assert.equal(r.total, 8);
});

test("⭐ ruleId 有隔離（別條規則的紀錄不會混進來）", async () => {
  const mine = await list();
  assert.ok(mine.rows.every((r) => r.ruleId === RULE));
  const other = await list({ ruleId: OTHER_RULE });
  assert.equal(other.total, 1);
});

test("超出範圍的頁數回空陣列而不是報錯", async () => {
  const r = await list({ pageSize: 3, page: 99 });
  assert.equal(r.rows.length, 0);
  assert.equal(r.total, 8, "total 仍要回報，前端才知道該退回第幾頁");
});
