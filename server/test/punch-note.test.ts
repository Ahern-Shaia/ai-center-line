/**
 * 打卡備註（punch-note-to-report M1/M2）· docs/modules/punch-note-to-report.md
 *
 * 這個功能的理由是日報送出率 19% —— 「加入日報」早就有，但帶進去的 detail 是空的，
 * 員工還是得回想並打字。備註就是要填那一格。
 *
 * ⚠️⚠️ 最重要的兩條是 FMEA 的兩個 P0：
 *    F-1 打卡不可以被日報綁架（備註失敗不能影響已成立的打卡）
 *    F-2 不可以改到別人的打卡（RLS 只擋跨租戶，同租戶要靠 WHERE user_id）
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTenant, txStore, closeDb } from "../src/db/client.js";
import { AttendanceService } from "../src/attendance/attendance.service.js";
import { AttendanceRepository } from "../src/attendance/attendance.repository.js";
import { PersonalDailyReportController } from "../src/personal-daily-report/personal-daily-report.controller.js";
import { PersonalDailyReportRepository } from "../src/personal-daily-report/personal-daily-report.repository.js";

const T = "b0da0000-0000-4000-8000-00000000e001";
const DEPT = "b0da0000-0000-4000-8000-0000000000ea";
const ME = "b0da0000-0000-4000-8000-0000000000e1";
const OTHER = "b0da0000-0000-4000-8000-0000000000e2";
const P_MINE = "b0da0000-0000-4000-8000-000000000e11";
const P_OTHERS = "b0da0000-0000-4000-8000-000000000e12";

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

// ⚠️ AttendanceService 的其他依賴在這幾條路徑上不會被呼叫，傳 stub；
//    真的被呼叫到會炸，那也是對的（代表測到了不該測的東西）。
const att = new AttendanceService(new AttendanceRepository(), {} as never, {} as never);
const pdr = new PersonalDailyReportController(
  {} as never, new PersonalDailyReportRepository(), {} as never, {} as never, {} as never,
);

const jwt = (userId: string) =>
  ({ user_id: userId, tenant_id: T, role: "employee", department_id: DEPT } as never);

const asUser = <R>(userId: string, fn: () => Promise<R>) =>
  withTenant({ tenantId: T, role: "employee", departmentId: DEPT, userId },
    (tx) => txStore.run(tx, fn));

let skip = false;
let today = "";

before(async () => {
  const c = admin();
  try { await c.connect(); } catch { skip = true; return; }
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'PN-test')`, [T]);
  await c.query(
    `INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
     VALUES ($1,$2,'業務部','G_PN','x','x')`, [DEPT, T]);
  for (const [id, nm, em] of [[ME, "我", "me@pn.test"], [OTHER, "別人", "other@pn.test"]]) {
    await c.query(`INSERT INTO users (user_id, tenant_id, role, department_id, display_name, email)
                   VALUES ($1,$2,'employee',$3,$4,$5)`, [id, T, DEPT, nm, em]);
  }
  const mk = (id: string, uid: string, place: string) =>
    c.query(`INSERT INTO attendance_punch (punch_id, tenant_id, user_id, punch_type, customer_name, source)
             VALUES ($1,$2,$3,'arrive_site',$4,'liff_geo')`, [id, T, uid, place]);
  await mk(P_MINE, ME, "示範案場 B");
  await mk(P_OTHERS, OTHER, "別人的案場");
  const d = await c.query(`SELECT (now() AT TIME ZONE 'Asia/Taipei')::date::text AS d`);
  today = d.rows[0].d;
  await c.end();
});

after(async () => {
  if (skip) return;
  const c = admin(); await c.connect();
  await c.query(`DELETE FROM personal_daily_report WHERE tenant_id = $1`, [T]);
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [T]);
  await c.end(); await closeDb();
});

const noteOf = async (punchId: string): Promise<string | null> => {
  const c = admin(); await c.connect();
  const r = await c.query(`SELECT note FROM attendance_punch WHERE punch_id = $1`, [punchId]);
  await c.end();
  return r.rows[0]?.note ?? null;
};

test("⭐ 寫得進去，而且真的存到 DB", async () => {
  if (skip) return;
  await asUser(ME, () => att.annotatePunch(jwt(ME), P_MINE, "完成升降機保養 5 台"));
  assert.equal(await noteOf(P_MINE), "完成升降機保養 5 台");
});

test("⭐⭐ F-2 · 不可以改到別人的打卡（RLS 只擋跨租戶，同租戶靠 WHERE user_id）", async () => {
  if (skip) return;
  const before = await noteOf(P_OTHERS);
  let thrown: unknown = null;
  try {
    await asUser(ME, () => att.annotatePunch(jwt(ME), P_OTHERS, "我亂改別人的"));
  } catch (e) { thrown = e; }
  assert.ok(thrown, "改別人的打卡沒有被擋下來");
  // ⚠️ 只驗「有拋錯」不夠 —— 也可能是先寫進去了才拋。要確認資料真的沒被動到。
  assert.equal(await noteOf(P_OTHERS), before, "拋錯了但資料已經被改掉");
});

test("⭐ 空白一律存成 null（『沒寫』和『寫了空的』要分得出來）", async () => {
  if (skip) return;
  await asUser(ME, () => att.annotatePunch(jwt(ME), P_MINE, "   "));
  assert.equal(await noteOf(P_MINE), null);
  await asUser(ME, () => att.annotatePunch(jwt(ME), P_MINE, null));
  assert.equal(await noteOf(P_MINE), null);
});

test("⭐ 超長截斷在後端也要有一道（前端的 200 字是軟限制）", async () => {
  if (skip) return;
  await asUser(ME, () => att.annotatePunch(jwt(ME), P_MINE, "字".repeat(500)));
  assert.equal((await noteOf(P_MINE))?.length, 200);
});

test("⭐⭐ 備註要出現在日報頁的「今天打卡去過」那一列，帶著 punchId", async () => {
  if (skip) return;
  await asUser(ME, () => att.annotatePunch(jwt(ME), P_MINE, "完成升降機保養 5 台"));
  const res = await asUser(ME, () => pdr.getMine(jwt(ME), today)) as {
    todayVisits: Array<{ punchId: string; place: string; note: string | null; addedToReport: boolean }>;
  };
  const v = res.todayVisits.find((x) => x.punchId === P_MINE);
  assert.ok(v, "自己的打卡不在清單裡");
  assert.equal(v.note, "完成升降機保養 5 台",
    "備註沒帶過來 —— 那按「加入日報」時 detail 還是空的，這個功能就白做了");
  assert.equal(v.addedToReport, false);
  // ⚠️ 對照：別人的打卡不可以出現在我的清單裡
  assert.ok(!res.todayVisits.some((x) => x.punchId === P_OTHERS), "看到別人的打卡了");
});

test("⭐⭐ 加過的不再列（OQ-PNR-4 · 順手修「同一趟可加兩次」）", async () => {
  if (skip) return;
  const c = admin(); await c.connect();
  await c.query(
    `INSERT INTO personal_daily_report (tenant_id, user_id, report_date, final_items, ai_items, message_count, status)
     VALUES ($1,$2,$3,$4::jsonb,'[]'::jsonb,1,'draft')`,
    [T, ME, today, JSON.stringify([{ title: "示範案場 B", plannedKey: `punch:${P_MINE}` }])]);
  await c.end();
  try {
    const res = await asUser(ME, () => pdr.getMine(jwt(ME), today)) as {
      todayVisits: Array<{ punchId: string; addedToReport: boolean }>;
    };
    const v = res.todayVisits.find((x) => x.punchId === P_MINE);
    assert.equal(v?.addedToReport, true, "已加入的沒被標記 —— 使用者會重複加第二次");
  } finally {
    const c2 = admin(); await c2.connect();
    await c2.query(`DELETE FROM personal_daily_report WHERE tenant_id=$1`, [T]);
    await c2.end();
  }
});

// ─── 前端護欄（讀原始碼 · 不需要瀏覽器）──────────────────────────
//
// ⚠️ 這幾條守的是「整個功能的意義」：detail 沒帶 note 的話，
//    這次做的一切都白費 —— 畫面看起來一模一樣，員工還是得自己打字。
//    而那是型別檢查與後端測試**都抓不到**的。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const web = (rel: string) =>
  readFileSync(join(fileURLToPath(new URL("../../web/src", import.meta.url)), rel), "utf8");
/** 比對前先剝掉註解 —— 不然會比中自己寫的說明文字（本專案踩過三次） */
const code = (rel: string) =>
  web(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("⭐⭐ 加入日報時 detail 要帶打卡備註（這一格是整個功能的目的）", () => {
  const s = code("personal-report/MyDailyReport.tsx");
  assert.match(s, /detail:\s*v\.note\s*\?\?\s*""/,
    "detail 沒有帶 v.note —— 那按下去內容還是空的，這個功能等於沒做");
  assert.doesNotMatch(s, /title:\s*v\.place,\s*detail:\s*"",/,
    "還留著 detail: \"\" 的舊寫法");
});

test("⭐⭐ plannedKey 要送出去，否則加過的明天還會再冒出來", () => {
  const s = code("personal-report/MyDailyReport.tsx");
  assert.match(s, /plannedKey:\s*`punch:\$\{v\.punchId\}`/,
    "沒帶 plannedKey —— 後端無從得知這一趟已經加過了");
  // ⚠️ 部署空窗期防護：前後端是兩個 Render 服務、同一次 push 各自部署，
  //    順序控制不了。新前端打到舊後端時 punchId 是 undefined，
  //    沒有這道就會存成 `punch:undefined`，那筆的去重從此永遠對不上。
  assert.match(s, /v\.punchId \? \{ plannedKey/,
    "plannedKey 沒有做 punchId 存在檢查 —— 部署空窗期會存進 punch:undefined");
  assert.match(s, /filter\(\(v\) => !v\.addedToReport\)/,
    "載入時沒濾掉已加入的");
});

test("⭐ 備註框不可以搶焦點（OQ-PNR-2 · 只想打卡的人不必多按一次關鍵盤）", () => {
  const s = code("liff/PunchView.tsx");
  assert.match(s, /annotatePunch\(/, "打卡頁沒有接上備註 API");
  // ⚠️ autoFocus 會把鍵盤拉出來佔半個螢幕。打卡是一天很多次的高頻動作。
  assert.doesNotMatch(s, /autoFocus/, "備註框加了 autoFocus —— 會搶焦點叫出鍵盤");
});

test("⭐ i18n 中英都要有（漏翻會直接把 key 印在畫面上）", () => {
  const keys = ["pv.noteHd", "pv.notePh", "pv.noteSave", "pv.noteSkip",
                "pv.noteHint", "pv.noteSaved", "pv.noteFailed", "pv.noteTooLong", "pv.thisStop"];
  for (const lang of ["i18n/zh-TW.ts", "i18n/en.ts"]) {
    const s = web(lang);
    for (const k of keys) {
      assert.ok(s.includes(`"${k}"`), `${lang} 缺 ${k}`);
    }
  }
});
