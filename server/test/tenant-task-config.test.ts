// 每家公司的任務時間設定 · navigation-and-capability-gating M2
//
// 這支測試守的是一個**失敗跟成功長得一樣**的情境：
// 如果 forCurrentTenant 讀不到設定（RLS 擋掉、上下文沒設、SQL 寫錯），
// 它會安靜地回預設值 7 —— 看板照常運作、沒有任何錯誤、畫面也正常。
// 「設定沒有生效」與「設定剛好等於預設」在畫面上完全無法分辨。
//
// 所以這裡不驗「函式有沒有被呼叫」，驗的是**同一張票在不同設定下算出不同答案**。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { withTenant, txStore, currentTx, closeDb } from "../src/db/client.js";
import { WarroomTasksService } from "../src/warroom/warroom-tasks.service.js";
import { TaskConfigService, DEFAULT_TASK_CONFIG } from "../src/task-config/task-config.service.js";
import { rejectsWithConstraint } from "./pg-constraint.js";

const cfgSvc = new TaskConfigService();
const svc = new WarroomTasksService(cfgSvc);

const asTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
  withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId: null },
    (tx) => txStore.run(tx, fn));

/**
 * ⚠️ 專用租戶，**不可**共用現成的。
 * 這支測試會改該租戶的寬限期，而 overdue-threshold.test.ts 同時在同一家算逾時天數 ——
 * node --test 各檔案是平行的 process，於是那邊會拿到這邊改到一半的設定，
 * 出現「單獨跑綠、全套跑紅」的鬼打牆。改設定的測試一定要有自己的租戶。
 */
const T = "c0c0c0c0-0000-4000-8000-00000000c0f6";
const DEPT = "c0c0c0c0-0000-4000-8000-00000000de07";
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1, 'TTC-TEST')`, [T]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1, $2, 'ttc-dept', 'ttc-grp', 'x', 'x')`, [DEPT, T]);
  await c.end();
});

async function seed() {
  return { tenantId: T, deptId: DEPT };
}

const setGrace = (tenantId: string, days: number, tiers: [number, number] = [3, 7]) =>
  asTenant(tenantId, () => currentTx().execute(sql`
    INSERT INTO tenant_task_config (tenant_id, overdue_grace_days, reminder_tier_days)
    VALUES (${tenantId}::uuid, ${days}, ARRAY[${tiers[0]}, ${tiers[1]}]::int[])
    ON CONFLICT (tenant_id) DO UPDATE
      SET overdue_grace_days = EXCLUDED.overdue_grace_days,
          reminder_tier_days = EXCLUDED.reminder_tier_days`));

const clearConfig = (tenantId: string) =>
  asTenant(tenantId, () => currentTx().execute(
    sql`DELETE FROM tenant_task_config WHERE tenant_id = ${tenantId}::uuid`));

/** ⚠️ 多減 1 小時：整天邊界上的資料會讓 floor 因毫秒抖動少 1，測試就時綠時紅 */
const addAged = (s: { tenantId: string; deptId: string }, tag: string, daysAgo: number) =>
  asTenant(s.tenantId, () => currentTx().execute(sql`
    INSERT INTO tickets (tenant_id, department_id, summary, confirm_status, created_at)
    VALUES (${s.tenantId}::uuid, ${s.deptId}::uuid, ${tag}, '待簽核',
            now() - ${`${daysAgo * 24 + 1} hours`}::interval)`));

const cleanup = (tenantId: string, tag: string) =>
  asTenant(tenantId, () => currentTx().execute(
    sql`DELETE FROM tickets WHERE summary LIKE ${`${tag}%`}`));

test("⭐⭐ 同一張票，寬限期不同就算出不同的逾時天數", async () => {
  const s = await seed();
  const tag = `ttc-${randomUUID().slice(0, 8)}`;
  try {
    await addAged(s, tag, 10);            // 建立至今 10 天

    await setGrace(s.tenantId, 7);
    const a = await asTenant(s.tenantId, () => svc.listTasks({}));
    const ta = a.kanban.overdue.find((t) => t.summary === tag);
    assert.ok(ta, "10 天的票在寬限期 7 天下應該逾時");
    assert.equal(ta!.overdueDays, 3, "10 − 7 = 3");

    await setGrace(s.tenantId, 4);
    const b = await asTenant(s.tenantId, () => svc.listTasks({}));
    const tb = b.kanban.overdue.find((t) => t.summary === tag);
    assert.equal(
      tb!.overdueDays, 6,
      "10 − 4 = 6。還是 3 的話表示設定根本沒被讀到 —— "
      + "而那個失敗不會報錯，只會安靜地退回預設值 7",
    );
  } finally {
    await clearConfig(s.tenantId);
    await cleanup(s.tenantId, tag);
  }
});

test("⭐ 寬限期拉長之後，原本逾時的票會退出逾時欄（即時重算 · OQ-NAV-8）", async () => {
  const s = await seed();
  const tag = `ttc2-${randomUUID().slice(0, 8)}`;
  try {
    await addAged(s, tag, 10);
    await setGrace(s.tenantId, 30);
    const b = await asTenant(s.tenantId, () => svc.listTasks({}));
    assert.ok(
      !b.kanban.overdue.some((t) => t.summary === tag),
      "寬限期 30 天時，10 天的票不該還在逾時欄",
    );
  } finally {
    await clearConfig(s.tenantId);
    await cleanup(s.tenantId, tag);
  }
});

test("⭐ 「受影響筆數」必須跟看板的逾時欄算出同一組票", async () => {
  // 2026-07-29 實測到的不一致：儲存後 toast 說「沒有任務落在逾時範圍」，
  // 而同一刻看板顯示「逾時 15 天」。原因是計數寫成 `status <> 'closed'`，
  // 而 status 多半是 NULL —— `NULL <> 'closed'` 是 NULL，整批被濾掉。
  // 數字對不上比沒有數字更糟：它會讓人不再相信畫面上的其他數字。
  const s = await seed();
  const tag = `ttc3-${randomUUID().slice(0, 8)}`;
  try {
    await addAged(s, `${tag}-a`, 12);
    await addAged(s, `${tag}-b`, 12);
    await addAged(s, `${tag}-c`, 1);                 // 沒過寬限期
    const user = { user_id: null, role: "tenant_admin", tenant_id: s.tenantId } as never;
    const r = await asTenant(s.tenantId,
      () => cfgSvc.update(user, s.tenantId, { graceDays: 5, tierDays: [3, 7] }));
    const board = await asTenant(s.tenantId, () => svc.listTasks({}));
    assert.equal(
      r.affectedTickets, board.kanban.overdue.length,
      "toast 講的數字要跟看板算出來的是同一組票",
    );
    assert.equal(r.affectedTickets, 2, "12 天的兩張過了 5 天寬限期，1 天的那張沒有");
  } finally {
    await clearConfig(s.tenantId);
    await cleanup(s.tenantId, tag);
  }
});

test("沒有設定列 = 用預設，不是錯誤（不強迫每家 onboarding 先建一列）", async () => {
  const s = await seed();
  await clearConfig(s.tenantId);
  const cfg = await asTenant(s.tenantId, () => cfgSvc.forCurrentTenant(currentTx()));
  assert.deepEqual(cfg, DEFAULT_TASK_CONFIG);
});

test("⭐ 讀設定不可靠 RLS 過濾 —— aiproot 上下文不該撈到別家的設定當自己的", async () => {
  const s = await seed();
  try {
    await setGrace(s.tenantId, 21);
    // aiproot 的 read policy 有跨租戶逃生門：若查詢寫成 `SELECT ... LIMIT 1`，
    // 這裡會拿到上面那家的 21 天。正確行為是「沒有自己的設定 → 預設」
    const cfg = await withTenant(
      { tenantId: null, role: "aiproot_admin", departmentId: null, userId: null },
      (tx) => cfgSvc.forCurrentTenant(tx));
    assert.deepEqual(
      cfg, DEFAULT_TASK_CONFIG,
      "撈到 21 的話，表示查詢是靠 RLS 過濾而不是明寫 current_tenant —— "
      + "那在跨租戶角色底下會拿到別家的設定",
    );
  } finally { await clearConfig(s.tenantId); }
});

test("範圍與形狀在 DB 就擋掉（N-5：0 全部逾時 / 999 永不逾時）", async () => {
  const s = await seed();
  const C = "tenant_task_config_grace_range";
  await rejectsWithConstraint(() => setGrace(s.tenantId, 0), C, "0 天＝所有票立刻逾時");
  await rejectsWithConstraint(() => setGrace(s.tenantId, 999), C, "999 天＝永遠不逾時，等於關掉這個功能");
  // 階梯寫反不會報錯但 tierFor 會永遠回同一級 —— 失敗跟成功長得一樣
  await rejectsWithConstraint(() => setGrace(s.tenantId, 7, [7, 3]),
    "tenant_task_config_tier_shape", "階梯寫反了");
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);   // cascade 清 departments / tickets / config
  await c.end();
  await closeDb();
});
