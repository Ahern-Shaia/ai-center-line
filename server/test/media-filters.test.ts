// 素材篩選 · 日期＋群組（台灣福祉 ② · 2026-08-25「先這兩個」）
//
// ⭐⭐ 這支盯的是三個 happy path 一定測不到的地方：
//
//   ① **時區日界** —— sent_at 存 UTC，台灣早上 8 點前傳的檔案在 UTC 還是前一天。
//      直接拿 `sent_at::date` 比，使用者選「今天」會看不到今天早上的圖，
//      而且他不會覺得是篩選壞了，只會覺得「檔案不見了」。
//      本機資料如果剛好都不在邊界上，錯的實作照樣全綠 —— 所以這裡用**固定時間**自己造邊界。
//
//   ② **分頁籤數字要吃同一組篩選** —— counts 漏掉篩選的話，
//      籤上寫「圖片 135」點下去只有 3 張。看起來就是壞的。
//
//   ③ **1:1 私訊不是群組** —— 私訊訊息的 group_id 是 `__personal__<userId>` 佔位，
//      混進群組下拉會是一串使用者看不懂的亂碼。
//      （同款 `__personal__` 洩漏見 memory pitfall_warroom_batch_sql_traps）
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";
import { closeDb, withTenant, txStore, type Db } from "../src/db/client.js";
import { MediaService } from "../src/media/media.service.js";
import { isDate } from "../src/common/query-date.js";
import { likeContains, normalizeQuery } from "../src/common/query-like.js";
import { MediaStorageService } from "../src/line-ingest/media-storage.service.js";

const svc = new MediaService(new MediaStorageService());

const T = "mf000000-0000-4000-8000-00000000t001".replace(/[tm]/g, "a");
const BOT = "mf000000-0000-4000-8000-00000000b001".replace(/[bmf]/g, "a");
const G_A = "Cmf_group_a_000000000000000001";
const G_B = "Cmf_group_b_000000000000000002";
const G_DM = "__personal__Umf_person_00000001";

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

const asTenant = <R>(fn: () => Promise<R>) =>
  withTenant({ tenantId: T, role: "tenant_admin", departmentId: null, userId: null },
    (tx: Db) => txStore.run(tx, fn));

/**
 * 固定時間，不用 now() —— 用「今天」當基準的測試會在跨日那一刻紅一次，
 * 而且重跑就綠，查起來最浪費時間（memory pitfall_flaky_test_fixtures）。
 *
 * 關鍵那筆是 `2026-03-09T23:00:00Z` = 台灣 **3/10 早上 7 點**。
 * 只要日期篩選沒轉台灣時區，它就會被算成 3/9。
 */
const SEED: { id: string; group: string; at: string; kind: string }[] = [
  { id: "mf-a-0309", group: G_A, at: "2026-03-09T12:00:00Z", kind: "image" },  // 台灣 3/9 20:00 · 前後有「報價單」訊息
  { id: "mf-a-0310", group: G_A, at: "2026-03-09T23:00:00Z", kind: "image" },  // ⭐ 台灣 3/10 07:00
  { id: "mf-a-0311", group: G_A, at: "2026-03-11T02:00:00Z", kind: "file" },   // 台灣 3/11 10:00
  { id: "mf-b-0310", group: G_B, at: "2026-03-10T05:00:00Z", kind: "image" },  // 台灣 3/10 13:00
  { id: "mf-d-0310", group: G_DM, at: "2026-03-10T06:00:00Z", kind: "image" }, // 私訊
];

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'MF-TEST')`, [T]);
  const key = process.env.LINE_CONFIG_ENC_KEY ?? "test-only-line-enc-key-32chars---";
  await c.query(
    `INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_secret_enc, channel_access_token_enc)
     VALUES ($1,$2,'mf-bot','U_mf_bot', pgp_sym_encrypt('s',$3), pgp_sym_encrypt('t',$3))`, [BOT, T, key]);
  // 只註冊兩個真群 —— 私訊本來就不會有 line_group 列
  await c.query(
    `INSERT INTO line_group (bot_id, group_id, analyze_enabled, display_name)
     VALUES ($1,$2,true,'業務群'), ($1,$3,true,'工務群')`, [BOT, G_A, G_B]);
  for (const s of SEED) {
    await c.query(
      `INSERT INTO line_message (message_id, tenant_id, bot_id, group_id, message_type, sent_at, raw_event)
       VALUES ($1,$2,$3,$4,'image',$5::timestamptz,'{}'::jsonb)`, [s.id, T, BOT, s.group, s.at]);
    await c.query(
      `INSERT INTO line_media (tenant_id, message_id, media_type, storage_key, original_filename)
       VALUES ($1,$2,$3,$4,$5)`,
      [T, s.id, s.kind, `mf/${s.id}`, s.id === "mf-a-0311" ? "estimate-2026.pdf" : null]);
  }
  // 鄰近文字訊息 —— 關鍵字搜尋真正比對的東西（照片沒有檔名）
  await c.query(
    `INSERT INTO line_message (message_id, tenant_id, bot_id, group_id, message_type, sent_at, raw_event, text_content)
     VALUES ('mf-txt-1',$1,$2,$3,'text','2026-03-09T12:01:00Z'::timestamptz,'{}'::jsonb,'這張是客戶的報價單，請確認'),
            ('mf-txt-2',$1,$2,$4,'text','2026-03-10T05:01:00Z'::timestamptz,'{}'::jsonb,'現場照片')`,
    [T, BOT, G_A, G_B]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);   // cascade 其餘
  await c.end();
  await closeDb();
});

const ids = (r: { items: { mediaId: string }[] }) => r.items.length;

test("⭐⭐ 日期以台灣時間算 · 台灣 3/10 早上 7 點傳的檔案要出現在 3/10", async () => {
  const r = await asTenant(() => svc.list({ from: "2026-03-10", to: "2026-03-10" }));
  assert.equal(ids(r), 3,
    "3/10 應有 3 筆（業務群早上 7 點 + 工務群下午 1 點 + 私訊下午 2 點）· "
    + "少了早上那筆＝日期沒轉台灣時區，被算成 3/9");
  assert.ok(r.items.some((i) => i.mediaId && i.sentAt.startsWith("2026-03-09T23")),
    "⭐ 就是這一筆：UTC 3/9 23:00 = 台灣 3/10 早上 7 點");
});

test("⭐⭐ 反向也要對 · 台灣 3/9 晚上那筆不可以跑進 3/10", async () => {
  const r = await asTenant(() => svc.list({ from: "2026-03-09", to: "2026-03-09" }));
  assert.equal(ids(r), 1, "3/9 只有台灣晚上 8 點那一筆");
});

test("⭐⭐ 分頁籤數字要吃同一組篩選（不然籤上寫 5、點下去只有 2）", async () => {
  const r = await asTenant(() => svc.list({ from: "2026-03-10", to: "2026-03-10" }));
  assert.equal(r.counts.all, 3, "counts 沒吃篩選的話這裡會是 5");
  assert.equal(r.total, 3);
  assert.equal(r.counts.image, 3);
  assert.equal(r.counts.file, 0, "3/11 那個檔案不在範圍內");
});

test("群組篩選 · 只回那一群", async () => {
  const r = await asTenant(() => svc.list({ groupId: G_A }));
  assert.equal(ids(r), 3);
  assert.ok(r.items.every((i) => i.groupName === "業務群"));
});

test("日期＋群組可以疊 · 兩個條件同時成立才留下", async () => {
  const r = await asTenant(() => svc.list({ from: "2026-03-10", to: "2026-03-10", groupId: G_A }));
  assert.equal(ids(r), 1, "3/10 的業務群只有早上那一筆");
});

test("只給開始日期 = 那天以後全部（另一邊不設限）", async () => {
  const r = await asTenant(() => svc.list({ from: "2026-03-10" }));
  assert.equal(ids(r), 4, "3/10 三筆 + 3/11 一筆");
});

test("⭐ 1:1 私訊不可以出現在群組下拉（group_id 是 __personal__ 佔位，不是群）", async () => {
  const r = await asTenant(() => svc.list());
  assert.deepEqual(r.groups.map((g) => g.groupId).sort(), [G_A, G_B].sort());
  assert.ok(!r.groups.some((g) => g.groupId.startsWith("__personal__")));
  // 但檔案本身還是列得出來 —— 下拉沒有它 ≠ 清單要藏它
  assert.equal(ids(r), 5);
});

test("⭐ 群組下拉不隨日期縮水 · 選了某一群之後也還切得回去", async () => {
  // 選項會隨著條件消失的下拉，等於選下去就出不來了
  const narrow = await asTenant(() => svc.list({ from: "2026-03-11", to: "2026-03-11", groupId: G_A }));
  assert.equal(ids(narrow), 1);
  assert.equal(narrow.groups.length, 2, "當下只有業務群有檔案，但工務群仍要留在選項裡");
});

test("篩選條件都不給 = 全部（前端清除篩選走這條）", async () => {
  const r = await asTenant(() => svc.list({ from: "", to: "", groupId: "" }));
  assert.equal(ids(r), 5);
});

test("⭐ 日期格式驗證擋在 controller · 放行到 SQL 會是 500 不是 400", () => {
  assert.ok(isDate("2026-03-10"));
  assert.ok(!isDate("2026-13-45"), "月份 13 要擋");
  assert.ok(!isDate("2026-02-30"), "2 月 30 號不存在 —— 只用正則會放行，pg 回 22008 變 500");
  assert.ok(!isDate("2026/03/10"));
  assert.ok(!isDate("'; DROP TABLE line_media--"));
});

// ── 關鍵字搜尋（客戶原話「日期／關鍵字」的後半）─────────────────
// ⚠️ 比對的是**檔名 OR 前後三分鐘的文字訊息**。
//    只比檔名幾乎搜不到東西：LINE 只有 file 型別才給檔名，照片一律 null，
//    而客戶要找的「報價單」多半是一張照片，關鍵字打在旁邊的訊息裡。

test("⭐⭐ 關鍵字比對「前後三分鐘的訊息」· 只比檔名的話照片全都搜不到", async () => {
  const r = await asTenant(() => svc.list({ q: "報價單" }));
  assert.equal(ids(r), 1, "只有業務群那張圖的前後訊息提到報價單");
  assert.equal(r.items[0]?.mediaId && r.items[0].sentAt.startsWith("2026-03-09T12"), true);
});

test("⭐ 檔名也要比得到", async () => {
  const r = await asTenant(() => svc.list({ q: "estimate" }));
  assert.equal(ids(r), 1, "3/11 那筆的原始檔名是 estimate-2026.pdf");
});

test("⭐⭐ counts 也要吃關鍵字（不然分頁籤數字對不上清單）", async () => {
  const r = await asTenant(() => svc.list({ q: "報價單" }));
  assert.equal(r.counts.all, 1);
  assert.equal(r.total, 1);
});

test("關鍵字＋日期可以疊", async () => {
  const hit = await asTenant(() => svc.list({ q: "報價單", from: "2026-03-09", to: "2026-03-09" }));
  assert.equal(ids(hit), 1);
  const miss = await asTenant(() => svc.list({ q: "報價單", from: "2026-03-11", to: "2026-03-11" }));
  assert.equal(ids(miss), 0, "3/11 沒有提到報價單的");
});

test("⭐⭐ `%` 要當字面字元，不可以變成「匹配全部」", async () => {
  const r = await asTenant(() => svc.list({ q: "%" }));
  assert.equal(ids(r), 0,
    "沒跳脫的話 ILIKE '%%%' 會撈到全部 5 筆 —— 使用者打了一個 % 卻看到全部，會以為搜尋壞了");
});

test("⭐ `_` 要當字面字元，不可以變成「任一字元」", () => {
  // A_1 不該匹配 AB1
  assert.equal(likeContains("A_1"), "%A\\_1%");
  assert.equal(likeContains("50%"), "%50\\%%");
  assert.equal(likeContains("a\\b"), "%a\\\\b%");
});

test("⭐ 空白／純空格＝不篩，不是搜尋空字串", () => {
  assert.equal(normalizeQuery(""), null);
  assert.equal(normalizeQuery("   "), null);
  assert.equal(normalizeQuery(undefined), null);
  assert.equal(normalizeQuery("  報價單  "), "報價單", "要 trim —— 複製貼上常帶空白");
  assert.equal(normalizeQuery("x".repeat(500))?.length, 100, "要有長度上限");
});
