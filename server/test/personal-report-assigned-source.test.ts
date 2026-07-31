// 指派任務原始對話 · 部門制 gate（F-3 修訂）· docs/modules/task-to-personal-report.md §6
//
// F-3 是 **P0 隱私**：任務可能來自本人不在的群組。舊版一律只給 summary；改成「部門制」——
// 任務屬本人部門才給原始對話，跨部門仍擋。這支釘住每一條 gate：
//   ① 同部門且指派給本人 → 給（gate 通過）
//   ② 跨部門 → 不給（RLS 先擋 / 或 app 層明擋 · 都不可洩漏）
//   ③ 不是指派給本人 → 不給
//   ④ 本人未分配部門 → 一律不給（安全預設）
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTenant, txStore, closeDb } from "../src/db/client.js";
import { PersonalDailyReportService } from "../src/personal-daily-report/personal-daily-report.service.js";
import { PersonalDailyReportRepository } from "../src/personal-daily-report/personal-daily-report.repository.js";

// service 只有 assignedTaskSource 這條路會被測到 · 其餘依賴傳 stub（不會被呼叫）
const svc = new PersonalDailyReportService(new PersonalDailyReportRepository(), {} as never);

const T1 = "b0da0000-0000-4000-8000-00000000c001";
const DEPT_A = "b0da0000-0000-4000-8000-0000000000ca";
const DEPT_B = "b0da0000-0000-4000-8000-0000000000cb";
const EMP = "b0da0000-0000-4000-8000-0000000000c1";      // 員工 · 部門 A
const OTHER = "b0da0000-0000-4000-8000-0000000000c2";    // 另一員工
const TICK_A = "b0da0000-0000-4000-8000-000000000a01";   // 部門A · 指派給 EMP
const TICK_B = "b0da0000-0000-4000-8000-000000000b01";   // 部門B · 指派給 EMP（跨部門）
const TICK_OTHER = "b0da0000-0000-4000-8000-000000000c03"; // 部門A · 指派給 OTHER

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

// 以員工身分跑（帶 RLS 上下文 · departmentId 決定 current_department）
const runAsEmp = <R>(departmentId: string | null, fn: () => Promise<R>) =>
  withTenant({ tenantId: T1, role: "employee", departmentId, userId: EMP },
    (tx) => txStore.run(tx, fn));

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T1]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'PR-src')`, [T1]);
  for (const [id, name] of [[DEPT_A, "業務部"], [DEPT_B, "技術部"]]) {
    await c.query(
      `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
       VALUES ($1,$2,$3,$4,'x','x')`, [id, T1, name, `G_${id.slice(-4)}`]);
  }
  await c.query(`INSERT INTO users (user_id, tenant_id, role, department_id, display_name, email)
                 VALUES ($1,$2,'employee',$3,'員工',$4)`, [EMP, T1, DEPT_A, "emp@t.test"]);
  await c.query(`INSERT INTO users (user_id, tenant_id, role, department_id, display_name, email)
                 VALUES ($1,$2,'employee',$3,'其他',$4)`, [OTHER, T1, DEPT_A, "other@t.test"]);
  const mkTicket = (id: string, dept: string, assignee: string, summary: string) =>
    c.query(`INSERT INTO tickets (ticket_id, tenant_id, department_id, assignee_user_id, summary)
             VALUES ($1,$2,$3,$4,$5)`, [id, T1, dept, assignee, summary]);
  await mkTicket(TICK_A, DEPT_A, EMP, "A部門任務");
  await mkTicket(TICK_B, DEPT_B, EMP, "B部門任務");
  await mkTicket(TICK_OTHER, DEPT_A, OTHER, "別人的任務");
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T1]);
  await c.end();
  await closeDb();
});

test("⭐ 同部門且指派給本人 → gate 通過（回 summary · 此任務無來源分析故 messages 空）", async () => {
  const res = await runAsEmp(DEPT_A, () => svc.assignedTaskSource(EMP, DEPT_A, TICK_A));
  assert.equal(res.summary, "A部門任務");
  assert.ok(Array.isArray(res.messages), "gate 通過應正常回傳（無來源時 messages 為空）");
});

test("⭐⭐ 跨部門任務 → 不給原始對話（P0 · F-3）", async () => {
  // 員工 current_department=DEPT_A → RLS 先擋 DEPT_B 的 ticket（讀不到 → 404）
  await assert.rejects(
    () => runAsEmp(DEPT_A, () => svc.assignedTaskSource(EMP, DEPT_A, TICK_B)),
    /找不到|其他部門/,
  );
});

test("⭐⭐ 本人未分配部門 → app 層明擋（就算 RLS 放行也不給）", async () => {
  // departmentId=null → current_department 空 → RLS 放行全租戶；但 service 明驗 !departmentId → 403
  await assert.rejects(
    () => runAsEmp(null, () => svc.assignedTaskSource(EMP, null, TICK_B)),
    /其他部門/,
    "未分配部門者不得看任何來源（含跨部門）",
  );
});

test("⭐⭐ 不是指派給本人的任務 → 403（即使同部門）", async () => {
  await assert.rejects(
    () => runAsEmp(DEPT_A, () => svc.assignedTaskSource(EMP, DEPT_A, TICK_OTHER)),
    /不是指派給你/,
  );
});

test("不存在的任務 → 404", async () => {
  await assert.rejects(
    () => runAsEmp(DEPT_A, () => svc.assignedTaskSource(EMP, DEPT_A, "b0da0000-0000-4000-8000-0000000000ff")),
    /找不到/,
  );
});
