/**
 * 「今日預定」（calendar-sync M4）· docs/modules/calendar-sync.md
 *
 * 這一區的價值全在「該出現的有出現、不該出現的沒出現」。
 * 少一項 → 使用者那天查無此行程（就是客戶原本的抱怨）；
 * 多一項 → 他得自己判斷是不是同一件事，而多一次判斷就是多一次出錯。
 *
 * ⚠️⚠️ 特別釘住**兩個來源**。只做 tickets 那條的話，
 *    客戶原本抱怨的情境（私訊報的「8/24 行程」）永遠不會出現 —— 功能對他無效。
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTenant, txStore, closeDb } from "../src/db/client.js";
import { PersonalDailyReportController } from "../src/personal-daily-report/personal-daily-report.controller.js";
import { PersonalDailyReportRepository } from "../src/personal-daily-report/personal-daily-report.repository.js";

const T = "b0da0000-0000-4000-8000-00000000d001";
const DEPT = "b0da0000-0000-4000-8000-0000000000da";
const EMP = "b0da0000-0000-4000-8000-0000000000d1";
const TICK_TODAY = "b0da0000-0000-4000-8000-000000000d11";   // due_at 是「今天」
const TICK_OTHER = "b0da0000-0000-4000-8000-000000000d12";   // 指派給我但沒有 due_at
const TICK_ALLDAY = "b0da0000-0000-4000-8000-000000000d13";  // 整天事件（00:00）

const D = "2026-08-24";        // 「今天」
const D_PREV = "2026-08-21";   // 先前那份日報的日期

// ⚠️ repo 是**第 2 個**參數（svc, repo, scheduler, notify, bindingService）——
//    位置放錯不會報錯，只會在 getMine 讀 this.repo 時炸得莫名其妙。
const ctrl = new PersonalDailyReportController(
  {} as never, new PersonalDailyReportRepository(), {} as never, {} as never, {} as never,
);

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

/** 以本人身分跑（帶完整 RLS 上下文 —— 少一個變數就會靜默回 0 列）*/
const asEmp = <R>(fn: () => Promise<R>) =>
  withTenant({ tenantId: T, role: "employee", departmentId: DEPT, userId: EMP },
    (tx) => txStore.run(tx, fn));

type Planned = { key: string; title: string; time: string | null; noteDate: string | null };
const mine = async (date = D) =>
  asEmp(() => ctrl.getMine({ user_id: EMP, tenant_id: T, role: "employee", department_id: DEPT } as never, date)) as
    Promise<{ plannedToday: Planned[]; assignedTasks: Array<{ ticketId: string }> }>;

let skip = false;

before(async () => {
  const c = admin();
  try { await c.connect(); } catch { skip = true; return; }
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'PT-test')`, [T]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1,$2,'業務部','G_PT','x','x')`, [DEPT, T]);
  await c.query(
    `INSERT INTO users (user_id, tenant_id, role, department_id, display_name, email)
     VALUES ($1,$2,'employee',$3,'員工',$4)`, [EMP, T, DEPT, "pt@t.test"]);

  const mkTicket = (id: string, summary: string, dueAt: string | null) =>
    c.query(
      `INSERT INTO tickets (ticket_id, tenant_id, department_id, assignee_user_id, summary,
                            confirm_status, work_status, due_at)
       VALUES ($1,$2,$3,$4,$5,'待簽核','open',$6)`,
      [id, T, DEPT, EMP, summary, dueAt]);
  await mkTicket(TICK_TODAY, "北部港區看實車", `${D}T14:00:00+08:00`);
  await mkTicket(TICK_OTHER, "沒有預定日期的任務", null);
  await mkTicket(TICK_ALLDAY, "送樣車回原廠", `${D}T00:00:00+08:00`);

  // 先前（8/21）那份日報，裡面有一項預定在 8/24 —— **這就是客戶抱怨的情境**
  await c.query(
    `INSERT INTO personal_daily_report (tenant_id, user_id, report_date, ai_items, message_count, status)
     VALUES ($1,$2,$3,$4::jsonb,1,'draft')`,
    [T, EMP, D_PREV, JSON.stringify([
      { title: "8/21 當天做完的事", detail: "" },                                  // 沒有 dueAt · 不該出現
      { title: "8/24 要去客戶端交車", dueAt: `${D}T09:30:00+08:00`, dueText: "8/24 9:30" },
    ])]);
  await c.end();
});

after(async () => {
  if (skip) return;
  const c = admin(); await c.connect();
  await c.query(`DELETE FROM personal_daily_report WHERE tenant_id = $1`, [T]);
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.end(); await closeDb();
});

test("⭐⭐ 兩個來源都要進 —— 群組任務卡 ＋ 先前私訊日報裡記下的", async () => {
  if (skip) return;
  const { plannedToday } = await mine();
  const keys = plannedToday.map((p) => p.key);
  assert.ok(keys.includes(`ticket:${TICK_TODAY}`), "群組任務卡沒進來");
  // ⚠️ 這一條是重點：客戶原本抱怨的就是私訊這條路。
  //    只做 tickets 的話這裡會紅，而功能對他完全無效。
  assert.ok(keys.some((k) => k.startsWith("pdr:")),
    "先前日報裡記下的預定沒進來 —— 客戶抱怨的情境（私訊報 8/24 行程）還是查無此行程");
});

test("⭐ 沒有預定日期的任務不進今日預定（它留在「指派給我的任務」）", async () => {
  if (skip) return;
  const { plannedToday, assignedTasks } = await mine();
  assert.ok(!plannedToday.some((p) => p.key === `ticket:${TICK_OTHER}`));
  assert.ok(assignedTasks.some((t) => t.ticketId === TICK_OTHER), "它應該還在指派任務區");
});

test("⭐⭐ 同一張卡不可以兩區都出現 —— 多一次判斷就是多一次出錯", async () => {
  if (skip) return;
  const { plannedToday, assignedTasks } = await mine();
  assert.ok(plannedToday.some((p) => p.key === `ticket:${TICK_TODAY}`));
  assert.ok(!assignedTasks.some((t) => t.ticketId === TICK_TODAY),
    "預定日是今天的卡已經在今日預定列過了，指派任務區不該再列一次");
});

test("⭐ 整天事件顯示「—」不是 00:00（否則看起來像半夜有事）", async () => {
  if (skip) return;
  const { plannedToday } = await mine();
  const allday = plannedToday.find((p) => p.key === `ticket:${TICK_ALLDAY}`);
  assert.ok(allday, "整天事件不見了");
  assert.equal(allday.time, null, "只有日期沒時間的應該回 null，由前端顯示「—」");
  const timed = plannedToday.find((p) => p.key === `ticket:${TICK_TODAY}`);
  assert.equal(timed?.time, "14:00", "有時間的要照時間顯示（台北時區）");
});

test("⭐ 先前日報來的要帶「哪天記下的」—— 不然使用者不知道這是什麼時候講的", async () => {
  if (skip) return;
  const { plannedToday } = await mine();
  const fromPdr = plannedToday.find((p) => p.key.startsWith("pdr:"));
  assert.equal(fromPdr?.noteDate, D_PREV);
  assert.equal(fromPdr?.time, "09:30");
});

test("⭐ 同一天日報自己的項目不算「預定」（它已經在畫面上了）", async () => {
  if (skip) return;
  // 把一項預定在 8/24 的內容放進 8/24 當天的日報 —— 不該又出現在上方
  const c = admin(); await c.connect();
  await c.query(
    `INSERT INTO personal_daily_report (tenant_id, user_id, report_date, ai_items, message_count, status)
     VALUES ($1,$2,$3,$4::jsonb,1,'draft')`,
    [T, EMP, D, JSON.stringify([{ title: "今天自己的項目", dueAt: `${D}T16:00:00+08:00` }])]);
  await c.end();
  try {
    const { plannedToday } = await mine();
    assert.ok(!plannedToday.some((p) => p.title === "今天自己的項目"),
      "同一天日報裡的項目又被列成「預定」＝要他把自己加進自己");
  } finally {
    const c2 = admin(); await c2.connect();
    await c2.query(`DELETE FROM personal_daily_report WHERE tenant_id=$1 AND report_date=$2`, [T, D]);
    await c2.end();
  }
});

test("⭐⭐ 加過的不再出現 —— 否則使用者以為系統沒記住他按過", async () => {
  if (skip) return;
  const c = admin(); await c.connect();
  await c.query(
    `INSERT INTO personal_daily_report (tenant_id, user_id, report_date, final_items, ai_items, message_count, status)
     VALUES ($1,$2,$3,$4::jsonb,'[]'::jsonb,1,'draft')`,
    [T, EMP, D, JSON.stringify([
      { title: "北部港區看實車", plannedKey: `ticket:${TICK_TODAY}` },
    ])]);
  await c.end();
  try {
    const { plannedToday } = await mine();
    assert.ok(!plannedToday.some((p) => p.key === `ticket:${TICK_TODAY}`),
      "已經加進今天日報的預定還留在上方 —— 他會重複加第二次");
    // ⚠️ 對照：沒加過的仍要在（不然「全部消失」也會讓上面那條通過）
    assert.ok(plannedToday.some((p) => p.key === `ticket:${TICK_ALLDAY}`),
      "沒加過的也一起消失了 —— 排除條件寫太寬");
  } finally {
    const c2 = admin(); await c2.connect();
    await c2.query(`DELETE FROM personal_daily_report WHERE tenant_id=$1 AND report_date=$2`, [T, D]);
    await c2.end();
  }
});
