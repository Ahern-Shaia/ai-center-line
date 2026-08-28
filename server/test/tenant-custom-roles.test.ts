// 租戶自建角色 · docs/modules/custom-roles.md v0.3（方案 A）
//
// ⭐⭐ 這支測的是 §8.1 FMEA 裡的**五個 P0**。它們的共同特徵是
//     「happy path 全部會過」—— 所以只能靠測試守：
//
//   V-1 防提權   建/指派時把自己沒有的權限給別人 ＝ 自我提權
//   V-2 基準白名單 拿 assistant 當基準 ＝ 跨租戶讀所有通知規則與 Ragic 金鑰
//   V-3 租戶邊界  別家的角色指派得動 ＝ 跨租戶 IDOR
//   V-4 兩欄同寫  role 與 role_id 不同步 → 範圍或權限其中一半是錯的
//   V-7 部門必填  基準是「只看自己部門」但那個人沒部門 → **看得到全租戶**
//
// ⚠️ V-7 特別容易漏：症狀是「看太多」而不是「壞掉」，畫面上完全正常。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closeDb, withTenant, txStore, type Db } from "../src/db/client.js";
import { PermissionService } from "../src/permission/permission.service.js";
import { TenantCustomRolesService } from "../src/permission/tenant-custom-roles.service.js";

const T = "c1da0000-0000-4000-8000-00000000d001";
const OTHER = "c1da0000-0000-4000-8000-00000000d002";
const DEPT = "c1da0000-0000-4000-8000-00000000dd01";
const CALLER = "c1da0000-0000-4000-8000-00000000da01";   // tenant_admin · 建角色的人
const NO_DEPT = "c1da0000-0000-4000-8000-00000000da02";  // 員工 · 沒有部門（V-7 的樣本）
const HAS_DEPT = "c1da0000-0000-4000-8000-00000000da03"; // 員工 · 有部門

/**
 * 提權樣本 —— 一個**租戶級、但沒有人有**的權限。
 *
 * ⚠️ 原本用 `rag:view`（註解寫「tenant_admin 唯一沒有的租戶級權限」）。
 *    2026-08-29 的 migration 0072 把三個示範頁的權限改成 platform scope，
 *    於是它先被「不開放調整」的 scope 檢查擋下來，根本走不到提權判斷 ——
 *    **測試還是紅的，但紅的原因跟它要驗的事情無關。**
 *
 * ⭐ 更關鍵的是：0072 之後 tenant_admin 已經**持有全部租戶級權限**，
 *    現實裡再也找不到一個天然的樣本。所以這裡自己造一個 fixture 權限，
 *    在 before 建、after 刪。它沒有掛給任何角色，
 *    對 listPermissions 的兩支斷言無害（那兩支不比數量）。
 */
const NOT_MINE = "__tcrfixture:view";
const MINE = "warroom:view";

const perms = new PermissionService();
const svc = new TenantCustomRolesService(perms);
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

/** 跟 TenantTxInterceptor 走同一條路 */
const asTenant = <R>(tenantId: string, fn: () => Promise<R>): Promise<R> =>
  withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId: null },
    (tx: Db) => txStore.run(tx, fn));

const cleanup = async (c: pg.Client) => {
  await c.query(`DELETE FROM role_permissions WHERE permission_id=$1`, [NOT_MINE]);
  await c.query(`DELETE FROM permissions WHERE permission_id=$1`, [NOT_MINE]);
  for (const t of [T, OTHER]) {
    await c.query(`UPDATE users SET role_id=NULL WHERE tenant_id=$1`, [t]);
    await c.query(`DELETE FROM roles WHERE tenant_id=$1`, [t]);
    await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]);
  }
};

before(async () => {
  const c = admin();
  await c.connect();
  await cleanup(c);
  // 提權樣本 · 租戶級但不掛給任何角色（見 NOT_MINE 的說明）
  await c.query(
    `INSERT INTO permissions (permission_id, resource, action, description, scope)
     VALUES ($1, '__tcrfixture', 'view', '測試用 · 不掛給任何角色', 'tenant')
     ON CONFLICT (permission_id) DO NOTHING`, [NOT_MINE]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'TCR甲'),($2,'TCR乙')`, [T, OTHER]);
  await c.query(`INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
                 VALUES ($1,$2,'品保部','-tcr1','-','-')`, [DEPT, T]);
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email)
                 VALUES ($1,$2,'tenant_admin','總經理','tcr1@t.test')`, [CALLER, T]);
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email)
                 VALUES ($1,$2,'employee','沒部門的','tcr2@t.test')`, [NO_DEPT, T]);
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email, department_id)
                 VALUES ($1,$2,'employee','有部門的','tcr3@t.test',$3)`, [HAS_DEPT, T, DEPT]);
  await c.end();
  perms.invalidateAll();
});

after(async () => {
  const c = admin();
  await c.connect();
  await cleanup(c);
  await c.query(`DELETE FROM departments WHERE department_id=$1`, [DEPT]);
  await c.end();
  await closeDb();
});

const mk = (over: Partial<Parameters<typeof svc.create>[0]> = {}) => ({
  tenantId: T, callerUserId: CALLER,
  roleName: "品保組長",
  baselineRole: "group_owner", permissionIds: [MINE],
  ...over,
});

const userRow = async (userId: string) => {
  const c = admin(); await c.connect();
  const r = await c.query(`SELECT role, role_id FROM users WHERE user_id=$1`, [userId]);
  await c.end();
  return r.rows[0] as { role: string; role_id: string | null };
};

test("⭐⭐ V-1 建角色時不能放進自己沒有的權限（自我提權）", async () => {
  await assert.rejects(
    () => asTenant(T, () => svc.create(mk({ permissionIds: [MINE, NOT_MINE] }))),
    (e: { message?: string; response?: { status?: string } }) =>
      (e.response?.status ?? "") === "privilege_escalation",
    "K8s 的 escalate 紀律：給不出自己沒有的東西",
  );
  // 確認真的沒建出來（擋下來但已寫入＝更糟）
  const roles = await asTenant(T, () => svc.list(T));
  assert.equal(roles.length, 0);
});

test("⭐⭐ V-2 不可以拿 assistant 當資料範圍基準", async () => {
  for (const bad of ["assistant", "consultant", "aiproot_admin"]) {
    await assert.rejects(
      () => asTenant(T, () => svc.create(mk({ roleName: `X${bad}`, baselineRole: bad }))),
      (e: { response?: { status?: string } }) => (e.response?.status ?? "") === "invalid_baseline",
      `${bad} 是平台角色 · app_is_platform_ops() 沒有租戶條件`,
    );
  }
});

test("⭐ 建立成功 · 只放自己有的權限", async () => {
  const { roleId } = await asTenant(T, () => svc.create(mk()));
  assert.ok(roleId);
  const roles = await asTenant(T, () => svc.list(T));
  assert.equal(roles.length, 1);
  assert.equal(roles[0].roleName, "品保組長");
  assert.equal(roles[0].baselineRole, "group_owner");
  assert.deepEqual(roles[0].permissions, [MINE]);
  assert.equal(roles[0].memberCount, 0);
});

test("⭐⭐ V-7 基準是「只看自己部門」但那個人沒有部門 → 要擋（否則他看得到全租戶）", async () => {
  const roles = await asTenant(T, () => svc.list(T));
  const roleId = roles[0].roleId;

  await assert.rejects(
    () => asTenant(T, () => svc.assign({ tenantId: T, callerUserId: CALLER, userId: NO_DEPT, roleId })),
    (e: { response?: { status?: string } }) => (e.response?.status ?? "") === "department_required",
    "RLS 的 current_department 會是 null → 看得到全租戶 · 症狀是「看太多」不是「壞掉」",
  );

  const after = await userRow(NO_DEPT);
  assert.equal(after.role_id, null, "擋下來就不可以留下任何寫入");
  assert.equal(after.role, "employee");
});

test("⭐⭐ V-4 指派時 role 與 role_id 必須一起寫", async () => {
  const roles = await asTenant(T, () => svc.list(T));
  const roleId = roles[0].roleId;

  const r = await asTenant(T, () => svc.assign({ tenantId: T, callerUserId: CALLER, userId: HAS_DEPT, roleId }));
  assert.equal(r.role, "group_owner");

  const row = await userRow(HAS_DEPT);
  assert.equal(row.role_id, roleId, "role_id 決定他能做什麼（127 個端點）");
  assert.equal(row.role, "group_owner", "role 決定他看得到什麼（35 條 RLS policy）· 少寫這欄範圍就不對");
});

test("⭐⭐ V-3 別家租戶的角色指派不動（跨租戶 IDOR）", async () => {
  const roles = await asTenant(T, () => svc.list(T));
  const roleId = roles[0].roleId;
  await assert.rejects(
    () => asTenant(OTHER, () => svc.assign({ tenantId: OTHER, callerUserId: CALLER, userId: HAS_DEPT, roleId })),
    (e: { response?: { status?: string } }) => (e.response?.status ?? "") === "role_not_found",
    "不洩漏「這個角色存在但不是你的」",
  );
});

test("⭐ V-8 還有人在用就不給刪（直接刪會讓那些人默默退回基準角色）", async () => {
  const roles = await asTenant(T, () => svc.list(T));
  assert.equal(roles[0].memberCount, 1, "上一個測試指派了一位");
  await assert.rejects(
    () => asTenant(T, () => svc.remove({ tenantId: T, roleId: roles[0].roleId })),
    (e: { response?: { status?: string } }) => (e.response?.status ?? "") === "role_in_use",
  );
});

test("⭐ 取消自訂角色 · 退回基準角色（role_id 清掉、role 留著）", async () => {
  await asTenant(T, () => svc.assign({ tenantId: T, callerUserId: CALLER, userId: HAS_DEPT, roleId: null }));
  const row = await userRow(HAS_DEPT);
  assert.equal(row.role_id, null);
  assert.equal(row.role, "group_owner", "退回的是基準本身 —— 不會變回原本的 employee");
});

test("⭐ 角色代號自動產生 · 使用者不用填也看不到", async () => {
  const roles = await asTenant(T, () => svc.list(T));
  assert.match(roles[0].roleKey, /^custom_[0-9a-f]{8}$/,
    "要一位總經理發明一個小寫英文代號，是多一次沒有必要的判斷");
});

test("角色『名稱』重複要回看得懂的中文（名稱才是使用者看得到的東西）", async () => {
  await assert.rejects(
    () => asTenant(T, () => svc.create(mk())),   // 「品保組長」已存在
    (e: { response?: { status?: string; message?: string } }) =>
      (e.response?.status ?? "") === "role_name_exists" &&
      (e.response?.message ?? "").includes("換個名字"),
    "不要把 pg 23505 丟到畫面上",
  );
});
