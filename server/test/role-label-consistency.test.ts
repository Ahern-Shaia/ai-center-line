// 角色顯示名的三處必須一致 · migration 0069
//
// ⭐ 這支測的不是某個功能，而是**一種漂移**：
// 角色的中文名同時寫在三個地方 —— DB `roles.role_name`、
// `server/src/auth/role-label.ts`、`web/src/shared/roleLabel.ts`。
// 2026-08-21 客戶就是踩到這個：權限管理叫「群組負責人」、成員頁叫「部門主管」，
// 於是以為是兩個不同的角色、以為權限沒生效。
//
// 根因是 d06ea9a 只改前端（當時 role_name 沒有畫面在讀，是對的判斷），
// 後來 0067 讓 role_name 變成 user-visible，那個前提就默默破了。
// **沒有東西會在破掉當下變紅** —— 所以補這一支。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { ROLE_LABEL as ROLE_KEY } from "../src/auth/role-label.js";
import { msg } from "../src/i18n/index.js";

// ⚠️ 2026-08-27 M4b：`role-label.ts` 的值從中文字面改成 **i18n key**
//    （稽核記錄要依請求語言顯示角色名）。三方一致的保證沒變，
//    只是伺服器這一方要先用 msg() 解出中文再比 —— 沒有請求上下文時它回中文。
//    直接比 ROLE_KEY 會變成拿 `srv.role.tenant_admin` 去對 DB 的「總經理室」。
const ROLE_LABEL: Record<string, string> =
  Object.fromEntries(Object.entries(ROLE_KEY).map(([k, v]) => [k, msg(v)]));

const admin = () => new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
let c: pg.Client;

before(async () => { c = admin(); await c.connect(); });
after(async () => { await c.end(); });

test("⭐⭐ DB roles.role_name 要跟伺服器的角色顯示名一致", async () => {
  await c.query(`SET app.actor_role='aiproot_admin'`);
  const { rows } = await c.query<{ role_key: string; role_name: string }>(
    `SELECT role_key, role_name FROM roles WHERE is_system = true`,
  );
  assert.ok(rows.length >= 6, "系統角色應有 6 個");

  for (const r of rows) {
    assert.equal(
      r.role_name, ROLE_LABEL[r.role_key],
      `角色 ${r.role_key} 在 DB 叫「${r.role_name}」、程式叫「${ROLE_LABEL[r.role_key]}」—— ` +
      `同一個角色兩個名字，客戶會以為是兩個角色（改名時請一併出 migration，見 0069）`,
    );
  }
});

test("⭐⭐ 前端的角色顯示名要跟伺服器一致", () => {
  // 直接讀原始檔比對 —— server 的測試跑不到 web 的模組（不同 tsconfig / 無 DOM），
  // 但這個常數是純資料，用正則取出來足夠可靠，而且**跨了那道最常漂移的邊界**。
  // ⚠️ 2026-08-26 i18n：前端的角色名搬到 web/src/i18n/zh-TW.ts 的 `role.*`
  //    （shared/roleLabel.ts 現在只剩查表函式）。比對對象跟著搬。
  const src = readFileSync(new URL("../../web/src/i18n/zh-TW.ts", import.meta.url), "utf8");
  const web: Record<string, string> = {};
  for (const m of src.matchAll(/^\s*"role\.(\w+)":\s*"([^"]+)"/gm)) web[m[1]!] = m[2]!;

  assert.deepEqual(
    web, ROLE_LABEL,
    "web/src/i18n/zh-TW.ts 的 role.* 與 server/src/auth/role-label.ts 不一致 —— 兩邊要同時改",
  );
});

test("每個角色都要有中文名 —— 漏一個就會在畫面上露出英文 role key", () => {
  // Shell.tsx 與 TenantManagement.tsx 原本都漏了 assistant，
  // 於是助理登入後右上角顯示的是英文「assistant」（fallback 到 role key）。
  for (const key of ["aiproot_admin", "consultant", "tenant_admin", "group_owner", "assistant", "employee"]) {
    assert.ok(ROLE_LABEL[key], `${key} 沒有中文名`);
    assert.ok(!/^[a-z_]+$/.test(ROLE_LABEL[key]!), `${key} 的「中文名」看起來還是 role key`);
    assert.ok(!ROLE_LABEL[key]!.startsWith("srv."), `${key} 的 i18n key 在字典裡找不到 —— msg() fallback 回 key 本身了`);
  }
});
