/**
 * 部門日報的租戶篩選（2026-09-02 回報）
 *
 * 症狀：平台後台選了「aiproot」，畫面卻列出所有租戶的人。
 *
 * 根因兩層疊起來：
 *   ① listByRange 完全沒有 WHERE pdr.tenant_id，全靠 RLS
 *   ② personal_daily_report 的 RLS 平台逃生門是**最上層的 OR**：
 *        (tenant_id = current_tenant AND …) OR (actor_role IN ('aiproot_admin',…))
 *      → 對 aiproot_admin 而言整個租戶條件被短路，
 *        set_config('app.current_tenant', …) 設什麼都沒有作用。
 *
 * ⚠️ **這不是客戶看到別家資料。** 客戶角色兩層都擋得住：
 *    resolveTenantId 會對跨租戶請求丟 Forbidden，而他們的 RLS 分支
 *    必須 tenant_id = current_tenant。所以嚴重度是「篩選器在說謊」不是「外洩」——
 *    但會說謊的篩選器一樣要修，它會讓人不再相信這一頁的任何數字。
 *
 * ⚠️⚠️ 下面**兩個方向都要測**。只測「選了 A 看不到 B」的話，
 *    哪天有人把查詢改成永遠回空，這支照樣全綠。
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTenant, txStore, closeDb } from "../src/db/client.js";
import { PersonalDailyReportController } from "../src/personal-daily-report/personal-daily-report.controller.js";
import { PersonalDailyReportRepository } from "../src/personal-daily-report/personal-daily-report.repository.js";

const TA = "b0da0000-0000-4000-8000-00000000f001";   // A 公司
const TB = "b0da0000-0000-4000-8000-00000000f002";   // B 公司
const UA = "b0da0000-0000-4000-8000-0000000000f1";
const UB = "b0da0000-0000-4000-8000-0000000000f2";
const D = "2026-08-20";

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
const ctrl = new PersonalDailyReportController(
  {} as never, new PersonalDailyReportRepository(), {} as never, {} as never, {} as never,
);

/** 以平台管理員身分（跨租戶角色）跑 */
const asPlatform = <R>(fn: () => Promise<R>) =>
  withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null },
    (tx) => txStore.run(tx, fn));

/** 以某家公司的管理員身分跑 */
const asTenantAdmin = <R>(tenantId: string, userId: string, fn: () => Promise<R>) =>
  withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId },
    (tx) => txStore.run(tx, fn));

type Row = { tenantId: string; userDisplayName: string | null };
let skip = false;

before(async () => {
  const c = admin();
  try { await c.connect(); } catch { skip = true; return; }
  for (const [t, nm] of [[TA, "A 公司"], [TB, "B 公司"]]) {
    await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);
    await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,$2)`, [t, nm]);
  }
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email)
                 VALUES ($1,$2,'employee','A員工','a@tf.test')`, [UA, TA]);
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email)
                 VALUES ($1,$2,'employee','B員工','b@tf.test')`, [UB, TB]);
  for (const [t, u] of [[TA, UA], [TB, UB]]) {
    await c.query(
      `INSERT INTO personal_daily_report (tenant_id, user_id, report_date, ai_items, message_count, status)
       VALUES ($1,$2,$3,'[]'::jsonb,1,'sent')`, [t, u, D]);
  }
  await c.end();
});

after(async () => {
  if (skip) return;
  const c = admin(); await c.connect();
  for (const t of [TA, TB]) {
    await c.query(`DELETE FROM personal_daily_report WHERE tenant_id = $1`, [t]);
    await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);
  }
  await c.end(); await closeDb();
});

const jwtPlatform = { user_id: null, tenant_id: null, role: "aiproot_admin", department_id: null } as never;

test("⭐⭐ 平台管理員選了 A 公司，就只能看到 A 公司（RLS 的逃生門擋不住，靠 SQL 的 WHERE）", async () => {
  if (skip) return;
  const res = await asPlatform(() => ctrl.team(jwtPlatform, D, D, TA)) as { reports: Row[] };
  const names = res.reports.map((r) => r.userDisplayName);
  // 正向：A 要在
  assert.ok(names.includes("A員工"), "選了 A 公司卻看不到 A 公司的人 —— 篩選過頭了");
  // 反向：B 不可以在（這就是回報的症狀）
  assert.ok(!names.includes("B員工"),
    "選了 A 公司卻看到 B 公司的人 —— 篩選器在說謊（listByRange 少了 WHERE tenant_id）");
  assert.ok(res.reports.every((r) => r.tenantId === TA), "回傳的列裡混著別家的 tenantId");
});

test("⭐ 換選 B 公司就換成 B（確認不是永遠回同一家）", async () => {
  if (skip) return;
  const res = await asPlatform(() => ctrl.team(jwtPlatform, D, D, TB)) as { reports: Row[] };
  const names = res.reports.map((r) => r.userDisplayName);
  assert.ok(names.includes("B員工"));
  assert.ok(!names.includes("A員工"));
});

test("⭐⭐ 客戶角色傳別家的 tenantId → 擋（這一條是真正的資料邊界）", async () => {
  if (skip) return;
  let thrown: unknown = null;
  try {
    await asTenantAdmin(TA, UA, () =>
      ctrl.team({ user_id: UA, tenant_id: TA, role: "tenant_admin", department_id: null } as never, D, D, TB));
  } catch (e) { thrown = e; }
  assert.ok(thrown, "A 公司的管理員傳 B 公司的 tenantId 沒有被擋 —— 這才是 P0");
});

test("⭐ 客戶角色不傳 tenantId 時，只看得到自己家", async () => {
  if (skip) return;
  const res = await asTenantAdmin(TA, UA, () =>
    ctrl.team({ user_id: UA, tenant_id: TA, role: "tenant_admin", department_id: null } as never, D, D)) as { reports: Row[] };
  assert.ok(res.reports.every((r) => r.tenantId === TA), "看到別家的了");
  assert.ok(res.reports.some((r) => r.userDisplayName === "A員工"), "自己家的反而看不到");
});
