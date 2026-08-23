// 導入進度 checklist · 「空狀態當老師」②
//
// ⭐ 這支守的是幾個**邊界**，它們的共同點是「happy path 會過、但空租戶會說謊」：
//    · 一個群都沒有時，「分派完了」不可以算完成（0/0 在數學上成立，在語意上是錯的）
//    · 綁定率的分母是「在群裡講過話的人」，沒有人講過話時不可以算完成
//    · 綁定 80% 就算過關 —— 卡在 100% 這張清單會永遠消不掉
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closeDb } from "../src/db/client.js";
import { OnboardingProgressService } from "../src/tenant-admin/onboarding-progress.service.js";

const T = "c2da0000-0000-4000-8000-00000000e001";
const BOT = "c2da0000-0000-4000-8000-00000000eb01";
const DEPT = "c2da0000-0000-4000-8000-00000000ed01";
const svc = new OnboardingProgressService();
const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

const step = (s: Awaited<ReturnType<typeof svc.get>>, k: string) => s.steps.find((x) => x.key === k)!;

const wipe = async (c: pg.Client) => {
  await c.query(`DELETE FROM line_message WHERE bot_id=$1`, [BOT]);
  await c.query(`DELETE FROM user_line_binding WHERE bot_id=$1`, [BOT]);
  await c.query(`DELETE FROM line_group WHERE bot_id=$1`, [BOT]);
  await c.query(`DELETE FROM line_bot WHERE bot_id=$1`, [BOT]);
  await c.query(`DELETE FROM users WHERE tenant_id=$1`, [T]);
  await c.query(`DELETE FROM departments WHERE tenant_id=$1`, [T]);
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [T]);
};

before(async () => {
  const c = admin(); await c.connect(); await wipe(c);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'OBP測試')`, [T]);
  await c.end();
});
after(async () => {
  const c = admin(); await c.connect(); await wipe(c); await c.end(); await closeDb();
});

test("⭐⭐ 全空的租戶：四項全部未完成（不可以有任何一項因為 0/0 而算過）", async () => {
  const r = await svc.get(T);
  assert.equal(r.allDone, false);
  for (const s of r.steps) {
    assert.equal(s.complete, false, `「${s.label}」在什麼都沒有時不該算完成`);
  }
  assert.match(step(r, "groups").hint, /還沒有群組/, "沒有群組時要給的是「怎麼開始」不是「去分派」");
});

test("⭐ 建了部門就算第一項完成", async () => {
  const c = admin(); await c.connect();
  await c.query(`INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
                 VALUES ($1,$2,'品保部','-obp1','-','-')`, [DEPT, T]);
  await c.end();
  const r = await svc.get(T);
  assert.equal(step(r, "departments").complete, true);
  assert.equal(step(r, "departments").done, 1);
});

test("⭐⭐ 群組分派：2 群只分派 1 群 → 未完成 · 都分派了才完成", async () => {
  const c = admin(); await c.connect();
  await c.query(`INSERT INTO line_bot (bot_id, tenant_id, name, bot_user_id, channel_id, channel_secret_enc, channel_access_token_enc, status)
                 VALUES ($1,$2,'OBP機器人','Uobp','obp-1','\\x00'::bytea,'\\x00'::bytea,'active')`, [BOT, T]);
  await c.query(`INSERT INTO line_group (bot_id, group_id, display_name, department_id, status) VALUES
                 ($1,'Cobp01','已分派',$2,'active'), ($1,'Cobp02','未分派',NULL,'active')`, [BOT, DEPT]);
  await c.end();

  let r = await svc.get(T);
  assert.equal(step(r, "groups").done, 1);
  assert.equal(step(r, "groups").total, 2);
  assert.equal(step(r, "groups").complete, false, "還有群沒分派就不算完成");

  const c2 = admin(); await c2.connect();
  await c2.query(`UPDATE line_group SET department_id=$1 WHERE group_id='Cobp02'`, [DEPT]);
  await c2.end();
  r = await svc.get(T);
  assert.equal(step(r, "groups").complete, true);
});

test("⭐⭐ 綁定率：分母是「在群裡講過話的人」· 80% 就算過關", async () => {
  const c = admin(); await c.connect();
  // 5 個人在群裡講過話
  for (let i = 1; i <= 5; i++) {
    await c.query(
      `INSERT INTO line_message (message_id, tenant_id, bot_id, group_id, sender_line_id, message_type, text_content, sent_at, chat_context, raw_event)
       VALUES ($1,$2,$3,'Cobp01',$4,'text','x',now(),'group','{}'::jsonb)`,
      [`obp-m${i}`, T, BOT, `Uobp_talker_${i}`],
    );
  }
  await c.end();

  let r = await svc.get(T);
  assert.equal(step(r, "binding").total, 5, "分母＝在群裡講過話的人");
  assert.equal(step(r, "binding").done, 0);
  assert.equal(step(r, "binding").complete, false);

  // 綁 4 個（80%）→ 過關。卡在 100% 的話這張清單永遠消不掉
  const c2 = admin(); await c2.connect();
  for (let i = 1; i <= 4; i++) {
    const uid = `c2da0000-0000-4000-8000-0000000f000${i}`;
    await c2.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email)
                    VALUES ($1,$2,'employee',$3,$4)`, [uid, T, `員工${i}`, `obp${i}@t.test`]);
    await c2.query(`INSERT INTO user_line_binding (user_id, bot_id, line_user_id, binding_method, status)
                    VALUES ($1,$2,$3,'liff_self_service','active')`, [uid, BOT, `Uobp_talker_${i}`]);
  }
  await c2.end();
  r = await svc.get(T);
  assert.equal(step(r, "binding").done, 4);
  assert.equal(step(r, "binding").complete, true, "4/5 = 80% 應該過關");
});

test("⭐ 四項都完成時 allDone = true（清單才消得掉）", async () => {
  const c = admin(); await c.connect();
  await c.query(`INSERT INTO users (user_id, tenant_id, role, display_name, email)
                 VALUES ($1,$2,'group_owner','主管','obplead@t.test')`,
                ["c2da0000-0000-4000-8000-0000000f00aa", T]);
  await c.end();
  const r = await svc.get(T);
  assert.equal(step(r, "leads").complete, true);
  assert.equal(r.allDone, true, "四項都過了清單就該消失，否則它會永遠佔著版面");
});
