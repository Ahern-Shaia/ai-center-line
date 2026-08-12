// Ragic 帳號改名 · 以及「UPDATE 影響 0 列」不可以回報成功
//
// 2026-08-12：使用者問「這個名稱可以編輯修改嗎」—— 當時只有新增 / 換金鑰 / 抓欄位，
// 沒有改名。補這支端點時順帶發現 updateKey 不看影響列數：
// ragic_account 的 RLS 是 app_is_platform_ops()，非平台角色下 UPDATE 會安靜地改到 0 列，
// 而端點照樣回 { status: "ok" } —— 使用者以為存好了，其實什麼也沒發生。
//
// 釘住：① 改得動 ② 改不動時要說 ③ server/apname 不受影響 ④ 空白名擋掉

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTenant, txStore, closeDb, type Db } from "../src/db/client.js";
import { RagicAccountRepository } from "../src/ragic/ragic-account.repository.js";
import { RagicAccountService } from "../src/ragic/ragic-account.service.js";
import type { JwtUser } from "../src/auth/jwt-user.js";

const TENANT = "ee000000-0000-4000-8000-00000000ee01";
const ACCOUNT = "ee000000-0000-4000-8000-0000000000c1";
const MISSING = "ee000000-0000-4000-8000-0000000000cf";

const repo = new RagicAccountRepository();
const svc = new RagicAccountService(repo, null as never); // 這些路徑不打 Ragic API
const actor = { user_id: "ee000000-0000-4000-8000-0000000000f1" } as JwtUser;

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });

/** service 走 currentTx()（AsyncLocalStorage），測試得自己補上 interceptor 平常做的 txStore.run */
const asRole = <T>(role: string, fn: (tx: Db) => Promise<T>): Promise<T> =>
  withTenant({ tenantId: TENANT, role: role as never }, (tx) => txStore.run(tx, () => fn(tx)));

const nameNow = async (): Promise<string | null> => {
  const c = admin();
  await c.connect();
  const r = await c.query(`SELECT display_name FROM ragic_account WHERE account_id = $1`, [ACCOUNT]);
  await c.end();
  return r.rows[0]?.display_name ?? null;
};

before(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM ragic_account WHERE account_id = $1`, [ACCOUNT]);
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [TENANT]);
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name) VALUES ($1,'RAN-測試租戶')`, [TENANT]);
  await c.query(
    `INSERT INTO ragic_account (account_id, tenant_id, server, apname, display_name)
     VALUES ($1,$2,'ap16','ranfixture','改名前')`, [ACCOUNT, TENANT]);
  await c.end();
});

after(async () => {
  const c = admin();
  await c.connect();
  await c.query(`DELETE FROM ragic_account WHERE account_id = $1`, [ACCOUNT]);
  await c.query(`DELETE FROM tenants WHERE tenant_id = $1`, [TENANT]);
  await c.end();
  await closeDb();
});

test("平台維運角色改得動名稱", async () => {
  await asRole("aiproot_admin", () => svc.rename(actor, ACCOUNT, "改名後"));
  assert.equal(await nameNow(), "改名後");
});

test("assistant 也可以改（它正是管通知設定的角色）", async () => {
  await asRole("assistant", () => svc.rename(actor, ACCOUNT, "  台灣福祉  "));
  assert.equal(await nameNow(), "台灣福祉", "前後空白應被去掉");
});

test("server / apname 不因改名而變動", async () => {
  const c = admin();
  await c.connect();
  const r = await c.query(`SELECT server, apname FROM ragic_account WHERE account_id = $1`, [ACCOUNT]);
  await c.end();
  assert.equal(r.rows[0].server, "ap16");
  assert.equal(r.rows[0].apname, "ranfixture");
});

test("帳號不存在 → 明確報錯，不是靜默成功", async () => {
  await assert.rejects(() => asRole("aiproot_admin", () => svc.rename(actor, MISSING, "隨便")), /不存在/);
});

test("非平台角色被 RLS 擋掉時要報錯，不可回 ok", async () => {
  const was = await nameNow();
  await assert.rejects(() => asRole("tenant_admin", () => svc.rename(actor, ACCOUNT, "偷改的名字")), /不存在/);
  assert.equal(await nameNow(), was, "名稱不可以真的被改到");
});

test("空白名稱擋在寫入之前", async () => {
  const was = await nameNow();
  await assert.rejects(() => asRole("aiproot_admin", () => svc.rename(actor, ACCOUNT, "   ")), /不可空白/);
  assert.equal(await nameNow(), was);
});

test("updateKey 也不再靜默成功", async () => {
  await assert.rejects(() => asRole("aiproot_admin", () => svc.updateKey(actor, MISSING, "some-key")), /不存在/);
});

test("repository 回 false 而非拋錯 · 由 service 決定訊息", async () => {
  assert.equal(await asRole("aiproot_admin", (tx) => repo.updateDisplayName(tx, MISSING, "x")), false);
  assert.equal(await asRole("aiproot_admin", (tx) => repo.updateDisplayName(tx, ACCOUNT, "台灣福祉")), true);
});
