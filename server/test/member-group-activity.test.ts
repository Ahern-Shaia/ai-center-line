// 成員的群組活動 · docs/modules/group-type-classification.md §4.6（M3.5）
//
// ⭐ 這支守兩件事：
//    ① **只回已綁定的人** —— 群裡沒帳號的人不可以出現（那是 OQ-GTC-13 另一個決定）
//    ② **判定依據要跟推導一致** —— 非部門群要標成「不計入」，不是不回傳。
//       不回傳的話「他明明在那個群，為什麼沒算」在畫面上沒有答案。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closeDb } from "../src/db/client.js";
import { MemberGroupActivityService } from "../src/tenant-admin/member-group-activity.service.js";

const T = "e0da0000-0000-4000-8000-00000000e001";
const BOT = "e0da0000-0000-4000-8000-00000000eb01";
const DEPT = "e0da0000-0000-4000-8000-00000000ed01";
const U_BOUND = "e0da0000-0000-4000-8000-00000000ea01";   // 有帳號且已綁定
const L_BOUND = "Uebound0000000000000000000000001";
const L_NOACC = "Uenoacc0000000000000000000000002";        // 群裡有講話但沒帳號

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
const svc = new MemberGroupActivityService();

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [T]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'MGA測試')`, [T]);
  await c.query(`INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
                 VALUES ($1,$2,'業務一部','-mga1','-','-')`, [DEPT, T]);
  await c.query(`INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_id, channel_secret_enc, channel_access_token_enc, status)
                 VALUES ($1,$2,'MGA機器人','Umga','mga-1','\\x00'::bytea,'\\x00'::bytea,'active')`, [BOT, T]);
  // 一個部門群 + 一個公告群（都 active、都有分派部門）
  await c.query(`INSERT INTO line_group (bot_id, group_id, display_name, department_id, status, group_type) VALUES
                 ($1,'Cmga01','業務部群',$2,'active','department'),
                 ($1,'Cmga02','有你真好',$2,'active','announcement')`, [BOT, DEPT]);
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email, department_id)
                 VALUES ($1,$2,'employee','已綁定的人','mga1@t.test',$3)`, [U_BOUND, T, DEPT]);
  await c.query(`INSERT INTO user_line_binding (user_id, bot_id, line_user_id, binding_method, status)
                 VALUES ($1,$2,$3,'liff_self_service','active')`, [U_BOUND, BOT, L_BOUND]);

  // 已綁定的人：部門群 3 則、公告群 5 則（公告群較多，正是要驗「不計入」的情境）
  // message_id / raw_event 都沒有預設值（一個是 LINE 給的 ID，一個是原始事件）
  const msg = (gid: string, sender: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      c.query(`INSERT INTO line_message (message_id, tenant_id, bot_id, group_id, sender_line_id, message_type, text_content, sent_at, chat_context, raw_event)
               VALUES ($5,$1,$2,$3,$4,'text','x', now() - interval '1 day', 'group', '{}'::jsonb)`,
              [T, BOT, gid, sender, `mga-${gid}-${sender.slice(-4)}-${i}`]));
  await Promise.all([
    ...msg("Cmga01", L_BOUND, 3),
    ...msg("Cmga02", L_BOUND, 5),
    ...msg("Cmga01", L_NOACC, 9),   // 沒帳號的人講最多 —— 但不該出現在結果裡
  ]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM line_message WHERE bot_id=$1`, [BOT]);
  await c.query(`DELETE FROM user_line_binding WHERE bot_id=$1`, [BOT]);
  await c.query(`DELETE FROM line_group WHERE bot_id=$1`, [BOT]);
  await c.query(`DELETE FROM line_bot WHERE bot_id=$1`, [BOT]);
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [T]);
  await c.end();
  await closeDb();
});

test("⭐⭐ 只回已綁定的人 · 沒帳號的群成員不可以出現", async () => {
  const act = await svc.byUser(T);
  assert.deepEqual(Object.keys(act), [U_BOUND],
    "群裡講最多話的是沒帳號的人 —— 他不該出現（PII 範圍是另一個決定 OQ-13）");
});

test("⭐⭐ 非部門群要回傳但標『不計入』· 不是不回傳", async () => {
  const act = await svc.byUser(T);
  const mine = act[U_BOUND]!;
  assert.equal(mine.length, 2, "兩個群都要回 —— 少了公告群，「他明明在那裡」就沒有答案");

  const ann = mine.find((a) => a.groupName === "有你真好")!;
  assert.equal(ann.messageCount, 5);
  assert.equal(ann.countsTowardDepartment, false, "公告群不計入部門判定");

  const dep = mine.find((a) => a.groupName === "業務部群")!;
  assert.equal(dep.messageCount, 3);
  assert.equal(dep.countsTowardDepartment, true);
});

test("⭐ 依發言數由多到少 —— 公告群較多時排前面（畫面才解釋得了為什麼它不算）", async () => {
  const act = await svc.byUser(T);
  const counts = act[U_BOUND]!.map((a) => a.messageCount);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
});

test("跨租戶不可見", async () => {
  const act = await svc.byUser("e0da0000-0000-4000-8000-0000000000ff");
  assert.deepEqual(act, {});
});
