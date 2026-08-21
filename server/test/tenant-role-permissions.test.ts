// 租戶自管角色權限 · docs/modules/tenant-role-permissions.md
//
// ⭐ 這支測試存在的主要理由是 **P0-D**：分岔（複製角色）時漏改部分使用者的
//    `users.role_id`，那些人會靜默沿用內建角色 —— 而畫面上看起來一切正常。
//    前三個 P0（全域共用／平台權限外洩／自我提權）有結構解，這個只能靠測試守。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closeDb, withTenant, txStore, type Db } from "../src/db/client.js";
import { PermissionService } from "../src/permission/permission.service.js";
import { TenantRolesService } from "../src/permission/tenant-roles.service.js";

const T = "c0da0000-0000-4000-8000-00000000c001";
const OTHER = "c0da0000-0000-4000-8000-00000000c002";
const U_TEXT = "c0da0000-0000-4000-8000-00000000ca01";   // 只有 role 字串，role_id 為 NULL
const U_ID = "c0da0000-0000-4000-8000-00000000ca02";     // 已經有 role_id 指向內建角色
const U_OTHER = "c0da0000-0000-4000-8000-00000000ca03";  // 別家租戶的同角色 · 不可被動到

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
const svc = new TenantRolesService(new PermissionService());

/** 跟 TenantTxInterceptor 走同一條路：開租戶交易並放進 txStore，currentTx() 才取得到 */
const asTenant = <R>(tenantId: string, fn: () => Promise<R>): Promise<R> =>
  withTenant({ tenantId, role: "tenant_admin", departmentId: null, userId: null },
    (tx: Db) => txStore.run(tx, fn));

before(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T, OTHER]) {
    await c.query(`DELETE FROM roles WHERE tenant_id=$1`, [t]);
    await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]);
  }
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'TRP甲'),($2,'TRP乙')`, [T, OTHER]);
  const gid = (await c.query(`SELECT role_id FROM roles WHERE role_key='group_owner' AND is_system=true`)).rows[0].role_id;
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email)
                 VALUES ($1,$2,'group_owner','無role_id','trp1@t.test')`, [U_TEXT, T]);
  await c.query(`INSERT INTO users (user_id, tenant_id, role, role_id, display_name, email)
                 VALUES ($1,$2,'group_owner',$3,'有role_id','trp2@t.test')`, [U_ID, T, gid]);
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email)
                 VALUES ($1,$2,'group_owner','別家的','trp3@t.test')`, [U_OTHER, OTHER]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T, OTHER]) {
    await c.query(`UPDATE users SET role_id=NULL WHERE tenant_id=$1`, [t]);
    await c.query(`DELETE FROM roles WHERE tenant_id=$1`, [t]);
    await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [t]);
  }
  await c.end();
  await closeDb();
});

const roleIdsOf = async (tenantId: string) => {
  const c = admin(); await c.connect();
  const r = await c.query(`SELECT user_id, role_id FROM users WHERE tenant_id=$1 ORDER BY user_id`, [tenantId]);
  await c.end();
  return r.rows as Array<{ user_id: string; role_id: string | null }>;
};

test("⭐ 租戶只看得到 tenant / department 級權限（platform 那 34 項不回傳）", async () => {
  const perms = await asTenant(T, () => svc.listPermissions());
  assert.ok(perms.length > 0);
  const scopes = new Set(perms.map((p) => p.scope));
  assert.deepEqual([...scopes].sort(), ["department", "tenant"]);
  // binding:aiproot-view 是跨租戶檢視別家客戶的綁定稽核 —— 絕不可出現
  assert.equal(perms.some((p) => p.permissionId === "binding:aiproot-view"), false,
    "平台權限不可以出現在租戶清單裡");
});

test("⭐ 角色清單只有白名單那兩個 · tenant_admin 與 assistant 都不在裡面", async () => {
  const roles = await asTenant(T, () => svc.listRoles(T));
  assert.deepEqual(roles.map((r) => r.roleKey).sort(), ["employee", "group_owner"]);
  assert.equal(roles.every((r) => !r.isCustomized), true, "還沒改過，全部應為系統預設");
});

test("⭐⭐ assistant 不可以回到清單裡 —— 它是平台角色不是租戶角色", async () => {
  // 2026-08-21：原本錯放在 TENANT_EDITABLE_ROLE_KEYS 裡。它的兩項權限都是 scope=platform，
  // 而 notification_rule / notify_config / ragic_account 的 policy 是
  // app_is_platform_ops()＝純角色白名單、**沒有租戶條件**。
  // 租戶只要生得出一個 assistant，那個人就讀得到所有租戶的通知規則與 Ragic API 金鑰。
  const roles = await asTenant(T, () => svc.listRoles(T));
  assert.equal(roles.some((r) => r.roleKey === "assistant"), false,
    "assistant 是 AIPROOT 內部角色 · 放進租戶清單＝跨租戶金鑰外洩（P0）");

  await assert.rejects(
    () => asTenant(T, () => svc.updatePermissions({ tenantId: T, roleKey: "assistant", permissionIds: [] })),
    /不開放自行調整/,
    "就算繞過前端直接打 API 也要擋",
  );
});

test("⭐⭐ 權限數只算租戶看得見的 —— 不然畫面會出現『已勾 N』但一個勾都找不到", async () => {
  // listPermissions 只回 tenant/department 級，若 listRoles 的計數含 platform 級，
  // 使用者會看到「已勾 2 / 32」然後在 32 項裡遍尋不著那 2 項。
  const [roles, perms] = await asTenant(T, async () =>
    [await svc.listRoles(T), await svc.listPermissions()] as const);
  const visible = new Set(perms.map((p) => p.permissionId));
  for (const r of roles) {
    const strays = r.permissions.filter((id) => !visible.has(id));
    assert.deepEqual(strays, [], `「${r.roleName}」算進了畫面上看不到的權限：${strays.join(", ")}`);
  }
});

test("⭐⭐ 分岔時『所有』該角色的使用者都要改到 role_id（P0-D · 漏一個就靜默沿用內建）", async () => {
  const before = await roleIdsOf(T);
  assert.equal(before.find((u) => u.user_id === U_TEXT)!.role_id, null, "前提：這位原本沒有 role_id");

  const res = await asTenant(T, () => svc.updatePermissions({
    tenantId: T, roleKey: "group_owner", permissionIds: ["warroom:view", "signoff:view"],
  }));
  assert.equal(res.forked, true);

  const after = await roleIdsOf(T);
  const forked = after.find((u) => u.user_id === U_TEXT)!.role_id;
  assert.ok(forked, "原本 role_id 為 NULL 的人也必須被指到副本");
  assert.equal(after.find((u) => u.user_id === U_ID)!.role_id, forked,
    "原本已有 role_id（指向內建）的人也必須改指到副本 —— 只比對 role 字串會漏掉他");
  assert.equal(after.every((u) => u.role_id === forked), true, "該租戶用這個角色的人一個都不能漏");
});

test("⭐⭐ 分岔不可以動到別家租戶的人", async () => {
  const other = await roleIdsOf(OTHER);
  assert.equal(other.find((u) => u.user_id === U_OTHER)!.role_id, null,
    "乙公司的 group_owner 不該因為甲公司分岔而變動");
});

test("⭐ 改完之後權限就是新的那一組（分岔後讀到的是租戶版）", async () => {
  const roles = await asTenant(T, () => svc.listRoles(T));
  const go = roles.find((r) => r.roleKey === "group_owner")!;
  assert.equal(go.isCustomized, true);
  assert.deepEqual([...go.permissions].sort(), ["signoff:view", "warroom:view"]);
  assert.equal(go.memberCount, 2, "甲公司有兩位 group_owner");
});

test("⭐⭐ 不接受前端傳來的平台權限（不信 client）", async () => {
  await assert.rejects(
    () => asTenant(T, () => svc.updatePermissions({
      tenantId: T, roleKey: "group_owner", permissionIds: ["warroom:view", "binding:aiproot-view"],
    })),
    /不開放調整/,
    "夾帶 platform 權限必須被擋 —— 端點沒回傳不代表打不進來",
  );
});

test("⭐⭐ 不可以編輯 tenant_admin（自我提權）", async () => {
  await assert.rejects(
    () => asTenant(T, () => svc.updatePermissions({
      tenantId: T, roleKey: "tenant_admin", permissionIds: ["warroom:view"],
    })),
    /不開放自行調整/,
  );
});

test("⭐ 還原成系統預設 · 人要指回內建角色、租戶版要被刪掉", async () => {
  const r = await asTenant(T, () => svc.resetToDefault({ tenantId: T, roleKey: "group_owner" }));
  assert.equal(r.restored, true);

  const c = admin(); await c.connect();
  const sys = (await c.query(`SELECT role_id FROM roles WHERE role_key='group_owner' AND is_system=true`)).rows[0].role_id;
  const left = await c.query(`SELECT count(*)::int AS n FROM roles WHERE tenant_id=$1`, [T]);
  await c.end();
  assert.equal(left.rows[0].n, 0, "租戶版角色應已刪除");

  const after = await roleIdsOf(T);
  assert.equal(after.every((u) => u.role_id === sys), true,
    "要指回內建角色 —— 指到已刪除的 role 或留 NULL 都可能讓那個人失去權限");

  const roles = await asTenant(T, () => svc.listRoles(T));
  assert.equal(roles.find((x) => x.roleKey === "group_owner")!.isCustomized, false);
});

test("沒改過就按還原 · 回 restored=false，不報錯", async () => {
  const r = await asTenant(T, () => svc.resetToDefault({ tenantId: T, roleKey: "employee" }));
  assert.equal(r.restored, false);
});
