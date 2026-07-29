// 端點守衛 · docs/modules/navigation-and-capability-gating.md §5.1（M0.9）
//
// 兩件事：
// ① 每個端點都要**宣告存取層級**（fail-closed 之後沒宣告會 500，不是靜默放行）
// ② ⭐ 讓 client 指定 tenantId 的端點必須有租戶邊界把關
//    —— 那是**唯一會跨租戶**的形狀：tenantId 來自 client、service 內部開 admin 上下文，
//    漏了 @Roles 就能傳別家 tenantId 讀別家資料。
//    其他端點漏了頂多是越權看自家資料，這個漏了是看別家的。
//
// ⚠️ 刻意**不做** metadata 快照比對。快照容易變成「壞了就更新快照」的橡皮圖章，
//    比沒有更糟 —— 它給人安全感卻不擋任何東西。這裡的兩條都是語意斷言。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const HTTP = /^\s*@(Get|Post|Patch|Put|Delete)\(/;
const GATE = /@(Roles|RequirePermission|AllowAnyUser|Public)\b/;
/**
 * 跨租戶的入口＝tenantId 由 client 指定。兩種寫法都算：
 *   @Query("tenantId")   列表 / 儀表板
 *   @Param("tenantId")   /tenants/:tenantId/... 這種路徑參數
 * ⚠️ 原本只認 @Query，於是 4 支 @Param 的端點在網子外面（2026-07-29 M1 補上）。
 */
const TENANT_FROM_CLIENT = /@(Query|Param)\(\s*["']tenantId["']/;

function controllers(dir = "src"): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...controllers(p));
    else if (e.endsWith(".controller.ts")) out.push(p);
  }
  return out;
}

/** 一個 handler ＝ HTTP 裝飾器 ＋ 到下一個 HTTP 裝飾器（或檔尾）之間的內容 */
function handlers(file: string): Array<{ file: string; route: string; block: string }> {
  const lines = readFileSync(file, "utf8").split("\n");
  const idx = lines.map((l, i) => (HTTP.test(l) ? i : -1)).filter((i) => i >= 0);
  return idx.map((start, n) => ({
    file: file.split("/").pop()!,
    route: lines[start].trim(),
    // 裝飾器可在 HTTP 前後，所以往前也抓幾行
    block: lines.slice(Math.max(0, start - 4), idx[n + 1] ?? lines.length).join("\n"),
  }));
}

const ALL = controllers().flatMap(handlers);

test("⭐ 每個端點都要宣告存取層級（fail-closed 的前提）", () => {
  const naked = ALL.filter((h) => !GATE.test(h.block));
  assert.deepEqual(
    naked.map((h) => `${h.file} ${h.route}`), [],
    "這些端點沒有 @Roles / @RequirePermission / @AllowAnyUser / @Public —— "
    + "fail-closed 之後它們會在 runtime 拋 403，等於功能壞掉。"
    + "刻意不限角色的請明寫 @AllowAnyUser()，不要留白。",
  );
});

test("⭐⭐ 讓 client 指定 tenantId 的端點必須有租戶邊界把關", async () => {
  const crossTenant = ALL.filter((h) => TENANT_FROM_CLIENT.test(h.block));
  assert.ok(crossTenant.length > 0, "一個都沒有的話，是這條規則的偵測寫壞了");

  // platform scope 的權限碼＝本來就是跨租戶的能力，由授權表決定給誰。
  // 讀 DB 而不是把碼名寫死在測試裡：授權是資料，硬編會立刻過期。
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  const { rows } = await c.query<{ permission_id: string }>(
    `SELECT permission_id FROM permissions WHERE scope = 'platform'`);
  await c.end();
  const platformPerm = new Set(rows.map((r) => r.permission_id));

  const bad = crossTenant.filter((h) => {
    // ✅ 用 resolveTenantId() / resolveTenantFilter() 把關的 —— 它們會擋掉非平台角色傳別家 id
    if (/resolveTenant(Id|Filter)\(/.test(h.block)) return false;

    // ✅ 由 platform scope 的權限碼把關
    const pm = h.block.match(/@RequirePermission\(\s*["']([^"']+)["']/);
    if (pm && platformPerm.has(pm[1])) return false;

    const m = h.block.match(/@Roles\(([^)]*)\)/);
    if (!m) return true;                                   // 三種把關都沒有
    // 只要放行了 aiproot／consultant 以外的角色，就是能讓 client 指定別家
    return /tenant_admin|group_owner|employee/.test(m[1]);
  });

  assert.deepEqual(
    bad.map((h) => `${h.file} ${h.route}`), [],
    "這些端點讓 client 傳 tenantId，卻沒有任何租戶邊界把關 —— "
    + "任何登入者都能傳別家 tenantId 跨租戶讀資料（2026-07-29 實測成立）。"
    + "四選一：限 @Roles(aiproot_admin, consultant)、用 resolveTenantId(user, tenantId)、"
    + "掛 platform scope 的權限碼、或改成從 @CurrentUser 取 tenant_id。",
  );
});

test("@AllowAnyUser 的端點不可從 client 收 tenantId", () => {
  // 兩者同時出現 = 任何登入者都能指定租戶，最糟的組合
  const bad = ALL.filter((h) => /@AllowAnyUser\b/.test(h.block) && TENANT_FROM_CLIENT.test(h.block));
  assert.deepEqual(
    bad.map((h) => `${h.file} ${h.route}`), [],
    "@AllowAnyUser 的前提是「自己保證租戶邊界」—— 一律走 @CurrentUser 取 tenant_id",
  );
});

test("盤點：端點總數與各類守衛的分布（數字變動時看一眼）", () => {
  const n = (re: RegExp) => ALL.filter((h) => re.test(h.block)).length;
  const stat = {
    總數: ALL.length,
    Roles: n(/@Roles\b/),
    RequirePermission: n(/@RequirePermission\b/),
    AllowAnyUser: n(/@AllowAnyUser\b/),
    Public: n(/@Public\b/),
  };
  // 不做快照比對（橡皮圖章），只確保沒有端點落在四類之外
  assert.ok(stat.總數 > 100, `端點數 ${stat.總數} 異常偏低 —— 偵測可能壞了`);
  assert.ok(stat.AllowAnyUser >= 1, "應該至少有打卡那幾支明示不限角色");
});

after(async () => {
  const { closeDb } = await import("../src/db/client.js");
  await closeDb();
});
