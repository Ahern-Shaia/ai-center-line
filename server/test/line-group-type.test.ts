// 群組類型 · docs/modules/group-type-classification.md v0.4（migration 0068）
//
// ⭐ 這支守的是**判準**，不是欄位：
//    「有群、但一個部門群都沒有」→ 不是組織單位（有你真好／報工及車輛調度）
//    「一個群都沒有」            → 仍是組織單位（售後服務・剛建好還沒接群）
//    兩者混為一談的話，剛建好的部門會憑空消失，而使用者只會看到「我的部門不見了」。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closeDb, withTenant, txStore, type Db } from "../src/db/client.js";
import { OrgOverviewService } from "../src/tenant-admin/org-overview.service.js";

const T = "d0da0000-0000-4000-8000-00000000d001";
const BOT = "d0da0000-0000-4000-8000-00000000db01";
const D_REAL = "d0da0000-0000-4000-8000-00000000de01";   // 真部門（有部門群）
const D_ANN = "d0da0000-0000-4000-8000-00000000de02";    // 只裝全員群
const D_EMPTY = "d0da0000-0000-4000-8000-00000000de03";  // 一個群都沒有

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
const svc = new OrgOverviewService();

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'GT測試')`, [T]);
  // line_group_id / extraction_schema / ragic_table 是 0001 留下的 NOT NULL 廢欄位。
  // ⚠️ 佔位值刻意各不相同：0022 移除了 UNIQUE (tenant_id, line_group_id)，但
  //    `npm run migrate` 會從 0001 重跑而 0001 又建了它 —— 本機常常還留著。
  //    給不同值的話兩種狀態都過（同 pitfall_migrate_runner_reverts_policies）。
  await c.query(`INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table) VALUES
                 ($1,$4,'業務一部','-gt1','-','-'),($2,$4,'有你真好','-gt2','-','-'),($3,$4,'售後服務','-gt3','-','-')`,
                [D_REAL, D_ANN, D_EMPTY, T]);
  // 欄位照實際 schema：name（不是 bot_name）· *_enc 是 bytea · 沒有 webhook_secret
  await c.query(`INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_id, channel_secret_enc, channel_access_token_enc, status)
                 VALUES ($1,$2,'GT機器人','Ugt0000','gt-1','\\x00'::bytea,'\\x00'::bytea,'active')`, [BOT, T]);
  // 部門群 + 全員群 · 兩個都掛在各自的部門下（department_id 一律保留）
  // line_group 沒有 tenant_id —— 租戶是透過 bot_id join line_bot 得到的
  await c.query(`INSERT INTO line_group (bot_id, group_id, display_name, department_id, status, group_type) VALUES
                 ($1,'Cgt001','福祉集團-業務部',$2,'active','department'),
                 ($1,'Cgt002','有你真好',$3,'active','announcement')`, [BOT, D_REAL, D_ANN]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM line_group WHERE bot_id=$1`, [BOT]);
  await c.query(`DELETE FROM line_bot WHERE bot_id=$1`, [BOT]);
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [T]);
  await c.end();
  await closeDb();
});

const asAiproot = <R>(fn: () => Promise<R>): Promise<R> =>
  withTenant({ tenantId: T, role: "aiproot_admin", departmentId: null, userId: null },
    (tx: Db) => txStore.run(tx, fn));

test("⭐⭐ 只裝全員群的『部門』不是組織單位 · 不進部門樹", async () => {
  const org = await asAiproot(() => svc.get(T));
  const names = org.departments.map((d) => d.name).sort();
  assert.deepEqual(names, ["售後服務", "業務一部"].sort(),
    "「有你真好」應被排除 —— 它唯一的群是 announcement 型");
});

test("⭐⭐ 一個群都沒有的部門**仍是**組織單位（剛建好還沒接群 ≠ 分類錯）", async () => {
  const org = await asAiproot(() => svc.get(T));
  assert.ok(org.departments.some((d) => d.name === "售後服務"),
    "沒有群 ≠ 只有非部門群 · 混為一談會讓剛建好的部門憑空消失");
});

test("⭐ 非部門群移到「跨部門群組」· 帶類型與人數", async () => {
  const org = await asAiproot(() => svc.get(T));
  assert.equal(org.crossGroups.length, 1);
  assert.equal(org.crossGroups[0].name, "有你真好");
  assert.equal(org.crossGroups[0].groupType, "announcement");
});

test("⭐ 部門卡上不再列出非部門群", async () => {
  const org = await asAiproot(() => svc.get(T));
  const all = org.departments.flatMap((d) => d.groups);
  assert.equal(all.includes("有你真好"), false, "全員群不該掛在任何部門卡上");
  assert.ok(all.includes("福祉集團-業務部"));
});

test("⭐⭐ department_id 一律保留 —— 任務仍有地方掛（tickets.department_id 是 NOT NULL）", async () => {
  const c = admin(); await c.connect();
  const r = await c.query(
    `SELECT department_id FROM line_group WHERE group_id='Cgt002'`);
  await c.end();
  assert.ok(r.rows[0].department_id,
    "改成 announcement 不可以連帶把 department_id 清掉 · 清了材料化建卡會失敗");
});

test("預設是 department · 不回填就與 0068 之前同行為", async () => {
  const c = admin(); await c.connect();
  await c.query(`INSERT INTO line_group (bot_id, group_id, display_name, status)
                 VALUES ($1,'Cgt003','新進來的群','active')`, [BOT]);
  const r = await c.query(`SELECT group_type FROM line_group WHERE group_id='Cgt003'`);
  await c.query(`DELETE FROM line_group WHERE group_id='Cgt003'`);
  await c.end();
  assert.equal(r.rows[0].group_type, "department");
});
