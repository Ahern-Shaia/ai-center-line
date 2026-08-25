// 存查頁 · 分頁＋日期／群組篩選（台灣福祉 ⑥ · M3b）
//
// ⭐⭐ 這支存在的主因是**舊版的天花板是雙層的**，而外層那層沒有人看得見：
//
//   舊：/warroom/tasks 撈最近 500 筆 → JS 分堆 → 存查 `.slice(0, 50)`
//   於是超過 500 張票的租戶，較舊的存查紀錄根本沒被撈進來，
//   連畫面上那個「共 N 筆」都是錯的（N 只算得到那 500 筆裡的）。
//
//   而存查正好是唯一一個**必須看得到舊資料**的頁面 ——
//   本機票數少的時候，錯的實作跟對的實作輸出一模一樣（memory pitfall_green_because_empty）。
//   所以這裡刻意塞超過 50 筆，把分頁邊界跟總數都逼出來。
//
// 另外三個同款陷阱（時區日界 / 總數要吃篩選 / 私訊不是群組）與素材看板同源，
// 對照 media-filters.test.ts。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closeDb, withTenant, txStore, type Db } from "../src/db/client.js";
import { ArchivedTasksService } from "../src/warroom/archived-tasks.service.js";
import { TaskConfigService } from "../src/task-config/task-config.service.js";

const svc = new ArchivedTasksService(new TaskConfigService());

const T = "a4c40000-0000-4000-8000-00000000c001";
const DEPT = "a4c40000-0000-4000-8000-00000000d001";
const DEPT2 = "a4c40000-0000-4000-8000-00000000d002";   // 同租戶另一部門
const T2 = "a4c40000-0000-4000-8000-00000000c002";      // 別家租戶
const BOT = "a4c40000-0000-4000-8000-00000000b001";
const G_A = "Carc_group_a_00000000000000001";
const G_B = "Carc_group_b_00000000000000002";
const G_DM = "__personal__Uarc_person_0000001";

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

const asTenant = <R>(fn: () => Promise<R>) =>
  withTenant({ tenantId: T, role: "tenant_admin", departmentId: null, userId: null },
    (tx: Db) => txStore.run(tx, fn));

/** 固定時間，不用 now() —— 用「今天」當基準的測試會在跨日那一刻紅一次然後重跑就綠 */
const D = (day: string, utcTime: string) => `2026-04-${day}T${utcTime}Z`;

before(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T, T2]) await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'ARC-TEST'),($2,'ARC-OTHER')`, [T, T2]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1,$2,'存查測試部','-arc','-','-'), ($3,$2,'另一部門','-arc2','-','-')`, [DEPT, T, DEPT2]);
  const key = process.env.LINE_CONFIG_ENC_KEY ?? "test-only-line-enc-key-32chars---";
  await c.query(
    `INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_secret_enc, channel_access_token_enc)
     VALUES ($1,$2,'arc-bot','U_arc_bot', pgp_sym_encrypt('s',$3), pgp_sym_encrypt('t',$3))`, [BOT, T, key]);
  await c.query(
    `INSERT INTO line_group (bot_id, group_id, analyze_enabled, display_name)
     VALUES ($1,$2,true,'業務群'), ($1,$3,true,'工務群')`, [BOT, G_A, G_B]);

  // 每個群一列 analysis_upload 當來源（ticket → su → line_group 才拿得到群組名）
  const up: Record<string, number> = {};
  for (const [g, name] of [[G_A, "a"], [G_B, "b"], [G_DM, "dm"]] as const) {
    const r = await c.query(
      `INSERT INTO analysis_upload (tenant_id, tenant_slug, filename, raw_content, status, source, group_id)
       VALUES ($1,'arc',$2,'','done','webhook',$3) RETURNING id`, [T, `arc-${name}`, g]);
    up[g] = r.rows[0].id;
  }

  const mk = (summary: string, createdAt: string, group: string, confirm: string, dept = DEPT, tenant = T) =>
    c.query(
      `INSERT INTO tickets (tenant_id, department_id, summary, confidence, status,
                            confirm_status, created_at, source_upload_id)
       VALUES ($1,$2,$3,'high','info',$4,$5::timestamptz,$6)`,
      [tenant, dept, summary, confirm, createdAt, up[group]]);

  // ⭐ 60 筆同一天的存查 —— 超過 PAGE_SIZE(50)，才逼得出分頁邊界
  for (let i = 0; i < 60; i++) await mk(`存查 A ${i}`, D("10", "05:00:00"), G_A, "存查");
  // 台灣 4/11 早上 7 點（UTC 4/10 23:00）· 時區沒轉會被算成 4/10
  await mk("台灣 4/11 早上那筆", D("10", "23:00:00"), G_B, "存查");
  await mk("工務群 4/12", D("12", "05:00:00"), G_B, "已忽略");
  await mk("私訊來的", D("12", "06:00:00"), G_DM, "存查");
  // 不是存查的票 —— 一張都不可以混進來
  await mk("待核對的", D("12", "07:00:00"), G_A, "待簽核");
  await mk("已核對的", D("12", "08:00:00"), G_A, "已簽核");
  // 隔離用：同租戶另一部門 1 筆
  await mk("另一部門的存查", D("12", "09:00:00"), G_A, "存查", DEPT2);
  // 別家租戶的部門與票（用它自己的 department，否則 FK 對不上）
  const d2 = await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES (gen_random_uuid(),$1,'別家的部門','-other','-','-') RETURNING department_id`, [T2]);
  await c.query(
    `INSERT INTO tickets (tenant_id, department_id, summary, confidence, status, confirm_status, created_at)
     VALUES ($1,$2,'別家租戶的存查','high','info','存查',$3::timestamptz)`,
    [T2, d2.rows[0].department_id, D("12", "10:00:00")]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  for (const t of [T, T2]) await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [t]);  // cascade 其餘
  await c.end();
  await closeDb();
});

test("⭐⭐ 總數是真的總數，不是被 50 筆上限截掉的（舊版寫死 slice(0,50)）", async () => {
  const r = await asTenant(() => svc.list());
  assert.equal(r.total, 64, "60 筆 A + 4/11 那筆 + 工務群已忽略 + 私訊 + 另一部門 = 64");
  assert.equal(r.items.length, 50, "一頁 50 筆");
});

test("⭐⭐ 第二頁拿得到剩下的 —— 舊版根本沒有第二頁", async () => {
  const p2 = await asTenant(() => svc.list({ page: 2 }));
  assert.equal(p2.items.length, 14);
  const p1 = await asTenant(() => svc.list({ page: 1 }));
  const overlap = p1.items.filter((t) => p2.items.some((x) => x.ticketId === t.ticketId));
  assert.equal(overlap.length, 0, "兩頁不可以有重複 —— OFFSET 算錯最典型的症狀");
});

test("⭐ 只回存查與已忽略 · 待核對／已核對一張都不可以混進來", async () => {
  const all = [
    ...(await asTenant(() => svc.list({ page: 1 }))).items,
    ...(await asTenant(() => svc.list({ page: 2 }))).items,
  ];
  assert.equal(all.length, 64);
  assert.ok(all.every((t) => t.confirmStatus === "存查" || t.confirmStatus === "已忽略"),
    `混進了：${all.filter((t) => !["存查", "已忽略"].includes(t.confirmStatus)).map((t) => t.confirmStatus)}`);
});

test("⭐⭐ 日期以台灣時間算 · UTC 4/10 23:00 = 台灣 4/11 早上 7 點", async () => {
  const r = await asTenant(() => svc.list({ from: "2026-04-11", to: "2026-04-11" }));
  assert.equal(r.total, 1, "沒轉台灣時區的話這裡會是 0，那筆被算進 4/10");
  assert.equal(r.items[0]?.summary, "台灣 4/11 早上那筆");
});

test("⭐⭐ total 要吃同一組篩選（不然頁碼會算出翻不到的頁）", async () => {
  const r = await asTenant(() => svc.list({ from: "2026-04-12", to: "2026-04-12" }));
  assert.equal(r.total, 3, "4/12：工務群已忽略 + 私訊 + 另一部門");
  assert.equal(r.items.length, 3);
});

test("群組篩選 · 日期＋群組可以疊", async () => {
  const only = await asTenant(() => svc.list({ groupId: G_B }));
  assert.equal(only.total, 2, "工務群：4/11 早上那筆 + 4/12 已忽略");
  const both = await asTenant(() => svc.list({ groupId: G_B, from: "2026-04-12", to: "2026-04-12" }));
  assert.equal(both.total, 1);
});

test("⭐ 1:1 私訊不進群組下拉，但它的紀錄照列", async () => {
  const r = await asTenant(() => svc.list());
  assert.deepEqual(r.groups.map((g) => g.groupId).sort(), [G_A, G_B].sort());
  assert.ok(!r.groups.some((g) => g.groupId.startsWith("__personal__")),
    "group_id 是 __personal__<userId> 佔位，列進下拉是一串亂碼");
  const all = [...r.items, ...(await asTenant(() => svc.list({ page: 2 }))).items];
  assert.ok(all.some((t) => t.summary === "私訊來的"), "下拉沒有它 ≠ 清單要藏它");
});

test("⭐ 群組下拉不隨日期縮水 · 選了之後切得回去", async () => {
  const r = await asTenant(() => svc.list({ from: "2026-04-11", to: "2026-04-11", groupId: G_B }));
  assert.equal(r.total, 1);
  assert.equal(r.groups.length, 2, "當下只有工務群有紀錄，業務群仍要留在選項裡");
});

test("翻過頭的頁數回空清單，不是丟例外", async () => {
  const r = await asTenant(() => svc.list({ page: 99 }));
  assert.equal(r.items.length, 0);
  assert.equal(r.total, 64, "總數仍要是對的 —— 前端靠它算最後一頁把人帶回去");
});

test("⭐ 存查的卡片仍帶得出群組名與顯示狀態（抽共用 mapper 後不可掉欄位）", async () => {
  const r = await asTenant(() => svc.list({ groupId: G_B, from: "2026-04-11", to: "2026-04-11" }));
  const t = r.items[0]!;
  assert.equal(t.groupName, "工務群", "群組名靠 su → line_group 兩層 join，最容易在重寫時掉");
  assert.equal(t.departmentName, "存查測試部");
  assert.ok(t.displayState, "displayState 是四軸投影，前端整張卡靠它");
});

// ── 隔離 · 新端點最該先驗的一件事 ───────────────────────────────
// 這支查詢沒有任何 `WHERE tenant_id =`，整個靠 tickets 的 RLS。
// 少設一個 session 變數就會靜默多回或少回列（memory rule_rls_silent_zero，已踩 10 次）。

const asRole = <R>(role: string, departmentId: string | null, fn: () => Promise<R>) =>
  withTenant({ tenantId: T, role: role as never, departmentId, userId: null },
    (tx: Db) => txStore.run(tx, fn));

test("⭐⭐ 跨租戶：看不到別家租戶的存查", async () => {
  const all = [
    ...(await asTenant(() => svc.list({ page: 1 }))).items,
    ...(await asTenant(() => svc.list({ page: 2 }))).items,
  ];
  assert.ok(!all.some((t) => t.summary === "別家租戶的存查"),
    "這支沒有 WHERE tenant_id，完全靠 RLS —— 漏了就是跨租戶外洩");
});

test("⭐⭐ 部門主管只看得到自己部門的存查（total 也要跟著縮）", async () => {
  const r = await asRole("group_owner", DEPT, () => svc.list());
  assert.ok(!r.items.some((t) => t.summary === "另一部門的存查"), "跨部門外洩");
  assert.equal(r.total, 63, "total 走另一條 count 查詢 —— 兩條的範圍必須一致，不然頁碼會翻到空頁");
});

test("⭐ 總經理室看得到全公司（含另一部門），但仍不含別家租戶", async () => {
  const r = await asTenant(() => svc.list({ from: "2026-04-12", to: "2026-04-12" }));
  assert.ok(r.items.some((t) => t.summary === "另一部門的存查"));
  assert.ok(!r.items.some((t) => t.summary === "別家租戶的存查"));
});
