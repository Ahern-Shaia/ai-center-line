// 補跑個人日報 · runPendingForTenant
//
// 2026-08-11：這支上 prod 後第一次執行就炸 `cannot cast type record to date[]`（42846）——
// drizzle 的 sql`` 把 JS 陣列展開成 record，`ANY(${dates}::date[])` 不成立。
// tsc 綠、既有測試綠，因為**這個路徑從沒被執行過**。所以這裡用真 DB 實際跑一次。
//
// 釘住兩件事：
//   1. 查詢跑得起來（回歸上面那個 42846）
//   2. 已有日報的 (user, date) 一律跳過 —— upsertDraft 會把 confirmed 打回 draft，
//      補歷史不該把成員已確認的日報退回未確認。

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closeDb } from "../src/db/client.js";
import { PersonalReportSchedulerService } from "../src/personal-daily-report/personal-report-scheduler.service.js";

const T = "bf000000-0000-4000-8000-00000000bf01";
const BOT = "bf000000-0000-4000-8000-0000000000b1";
const DEPT = "bf000000-0000-4000-8000-0000000000d1";
const U_HAS = "bf000000-0000-4000-8000-0000000000a1";   // 今天已有日報 → 應跳過
const U_NONE = "bf000000-0000-4000-8000-0000000000a2";  // 沒日報 → 應嘗試產生

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });

// generate 會呼叫 LLM —— 這裡只驗「有沒有被挑中」，所以把它換掉，不打真 API。
const attempted: Array<{ userId: string; reportDate: string }> = [];
const svc = new PersonalReportSchedulerService({
  generate: async (args: { tenantId: string; userId: string; reportDate: string }) => {
    attempted.push({ userId: args.userId, reportDate: args.reportDate });
    return { reportId: null, status: "empty" as const, itemCount: 0 };
  },
} as never);

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name, batch_enabled) VALUES ($1,$2,false)`,
    [T, "BACKFILL-TEST"]);   // 刻意 false —— 手動補跑要忽略這個旗標
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1,$2,'測試',$3,'x','x')`, [DEPT, T, `G_${DEPT.slice(-4)}`]);
  await c.query(
    `INSERT INTO line_bot (bot_id, tenant_id, kind, name, bot_user_id, channel_secret_enc, channel_access_token_enc)
     VALUES ($1,$2,'analysis','BF','Ubf0000000000000000000000000000bf','\\x00'::bytea,'\\x00'::bytea)`,
    [BOT, T]);
  for (const [uid, name] of [[U_HAS, "已有日報"], [U_NONE, "沒有日報"]]) {
    await c.query(
      `INSERT INTO users (user_id, tenant_id, role, department_id, display_name, email)
       VALUES ($1,$2,'employee',$3,$4,$5)`, [uid, T, DEPT, name, `${uid}@t.test`]);
    await c.query(
      `INSERT INTO user_line_binding (user_id, bot_id, line_user_id, binding_method, status)
       VALUES ($1,$2,$3,'aiproot_manual','active')`, [uid, BOT, `U${uid.replace(/-/g, "").slice(0, 32)}`]);
  }
  // U_HAS 今天已有一份「已確認」的日報
  await c.query(
    `INSERT INTO personal_daily_report (tenant_id, user_id, report_date, status, ai_items, final_items)
     VALUES ($1,$2,$3,'confirmed','[]'::jsonb,'[]'::jsonb)`, [T, U_HAS, today()]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.end();
  await closeDb();
});

test("⭐⭐ 補跑查詢跑得起來（回歸 42846 · ANY(array) 在 drizzle 不成立）", async () => {
  attempted.length = 0;
  const res = await svc.runPendingForTenant(T, 2);
  assert.ok(res, "有回結果就代表 SQL 沒炸");
  assert.equal(typeof res.scanned, "number");
});

test("⭐⭐ 已有日報的日子跳過（重跑會把 confirmed 打回 draft）", async () => {
  attempted.length = 0;
  await svc.runPendingForTenant(T, 2);

  const todayStr = today();
  const hitHasToday = attempted.some((a) => a.userId === U_HAS && a.reportDate === todayStr);
  assert.equal(hitHasToday, false, "U_HAS 今天已有日報 · 不可再跑");

  const hitNoneToday = attempted.some((a) => a.userId === U_NONE && a.reportDate === todayStr);
  assert.equal(hitNoneToday, true, "U_NONE 今天沒日報 · 應該要補");

  // U_HAS 昨天沒日報 → 仍要補（只跳過「已有的那一天」，不是整個人跳過）
  const y = new Date(`${todayStr}T00:00:00+08:00`);
  y.setDate(y.getDate() - 1);
  const yStr = y.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  assert.equal(
    attempted.some((a) => a.userId === U_HAS && a.reportDate === yStr), true,
    "跳過的粒度是 (人, 日期) 不是整個人",
  );
});

test("⭐ 手動補跑忽略 batch_enabled（旗標關著正是需要補跑的主因）", async () => {
  attempted.length = 0;
  await svc.runPendingForTenant(T, 1);
  assert.ok(attempted.length > 0, "租戶 batch_enabled=false 仍要能補跑");
});
