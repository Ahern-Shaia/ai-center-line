// i18n 守門 · docs/modules/i18n.md FMEA F-1 / F-2 / F-3
//
// ⭐ 這支測試在 server/ 是因為前端沒有 test runner ——
//    它讀的是 web/src 的**檔案內容**，不需要跑 React。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ⚠️ 不用 .pathname —— 本專案路徑含中文（創業）會被 URL-encode
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** 從字典檔取出所有 key（純資料常數，用正則夠可靠） */
function keysOf(src: string): string[] {
  const body = src.slice(src.indexOf("export default {"));
  return [...body.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]!);
}

const ZH = read("../../web/src/i18n/zh-TW.ts");
const EN = read("../../web/src/i18n/en.ts");

test("⭐⭐ F-1 · DB 值當 key 的那些，兩份字典必須逐字相同（翻了 key 全站狀態比對會靜默失效）", () => {
  // tickets.confirm_status 存的就是「待確認」這幾個字。
  // key 一旦被翻成英文，比對永遠不成立 —— 任務卡在某個狀態，而且不報錯。
  const DB_VALUES = ["待確認", "待簽核", "已簽核", "逾時警示", "已忽略", "存查"];
  for (const v of DB_VALUES) {
    assert.ok(ZH.includes(`"confirmStatus.${v}"`), `zh-TW 少了 confirmStatus.${v}`);
    assert.ok(
      EN.includes(`"confirmStatus.${v}"`),
      `en.ts 的 key 必須是 confirmStatus.${v}（DB 值原文）· 翻成英文會讓狀態比對靜默失效`,
    );
  }
});

test("⭐⭐ F-2 · en 不可有 zh-TW 沒有的 key（那表示中文字典漏了，會 fallback 到 key 本身）", () => {
  const zh = new Set(keysOf(ZH));
  const extra = keysOf(EN).filter((k) => !zh.has(k));
  assert.deepEqual(extra, [], `en 多出來的 key：${extra.join(", ")}`);
});

test("⭐ 中文字典的 value 不可以是英文識別字（那是還沒填，不是翻譯）", () => {
  const src = ZH.slice(ZH.indexOf("export default {"));
  for (const m of src.matchAll(/^\s*"([^"]+)":\s*"([^"]+)"/gm)) {
    const [, k, v] = m;
    if (k!.startsWith("locale.")) continue;
    assert.ok(!/^[a-z0-9_. -]+$/i.test(v!), `「${k}」的中文是「${v}」—— 那還是英文識別字`);
  }
});

test("⭐⭐ F-3 · 英文比中文長，側欄／按鈕類的字要壓短", () => {
  // 英文通常比中文長 30–50%。這條擋的是「翻得正確但爆版」——
  // 中文版看起來好好的，切到英文側欄就被擠掉。
  const en = Object.fromEntries(
    [...EN.slice(EN.indexOf("export default {")).matchAll(/^\s*"([^"]+)":\s*"([^"]+)"/gm)]
      .map((m) => [m[1]!, m[2]!]),
  );
  const TIGHT = ["confirmStatus.", "recordStatus.", "category.", "role."];
  for (const [k, v] of Object.entries(en)) {
    if (!TIGHT.some((p) => k.startsWith(p))) continue;
    assert.ok(v.length <= 24, `「${k}」的英文 "${v}" 有 ${v.length} 字 —— 狀態/分類籤放不下`);
  }

  // ⭐ 側欄更緊：236px 扣掉內距與圖示，13px 字大約放得下 18 字元。
  //    2026-08-26 用真實 CSS 渲染中英對照截圖確認過：
  //    現況最長是 "Knowledge base" / "Depts & people"（14 字）—— 不截斷、不換行。
  //    ⚠️ 這個上限是**量出來的**（scratchpad/nav-i18n-check.html），不是猜的。
  for (const [k, v] of Object.entries(en)) {
    if (!k.startsWith("nav.") || k === "nav.comingSoon") continue;   // comingSoon 是 toast 不受寬度限制
    assert.ok(v.length <= 18, `側欄「${k}」的英文 "${v}" 有 ${v.length} 字 —— 236px 放不下，會被截斷`);
  }
  for (const [k, v] of Object.entries(en)) {
    if (!k.startsWith("navGroup.")) continue;
    assert.ok(v.length <= 14, `側欄分組「${k}」的英文 "${v}" 太長`);
  }
});

test("⭐ 元件不可以直接 import { t } —— 那樣切語言不會重繪", () => {
  // t() 是給非 React 程式碼用的；元件要用 useT()。
  // shared/*Label.ts 是例外：它們是純函式，由呼叫它的元件負責訂閱。
  const OK = ["shared/confirmStatusLabel.ts", "shared/recordStatusLabel.ts",
              "shared/roleLabel.ts", "shared/categoryLabel.ts"];
  const Shell = read("../../web/src/Shell.tsx");
  assert.ok(Shell.includes("useT"), "Shell 要用 useT() 而不是 t()");
  assert.ok(OK.length === 4);
});

// ── M2 · users.locale（0071）────────────────────────────────────
// ⚠️ 加語言時**三個地方要一起改**，漏一處的症狀各不相同：
//    漏 CHECK → 500 ｜ 漏 DTO → 400 ｜ 漏前端 LOCALES → 選單裡選不到

test("⭐⭐ 語言清單三處必須一致（migration CHECK / DTO / 前端 LOCALES）", () => {
  const sql = read("../src/db/migrations/0071_user_locale.sql");
  const dto = read("../src/auth/dto/locale.dto.ts");
  const web = read("../../web/src/i18n/index.ts");

  const inCheck = [...sql.matchAll(/'([a-zA-Z-]+)'/g)].map((m) => m[1]!)
    .filter((v) => v.includes("-") || v === "en");
  const inDto = [...dto.matchAll(/"([a-zA-Z-]+)"/g)].map((m) => m[1]!);
  const inWeb = [...web.slice(web.indexOf("LOCALES")).matchAll(/"([a-zA-Z-]+)"/g)].map((m) => m[1]!).slice(0, 2);

  for (const l of ["zh-TW", "en"]) {
    assert.ok(inCheck.includes(l), `0071 的 CHECK 少了 ${l} → 存進去會 500`);
    assert.ok(inDto.includes(l), `locale.dto.ts 少了 ${l} → 送上來會 400`);
    assert.ok(inWeb.includes(l), `web/src/i18n 的 LOCALES 少了 ${l} → 選單裡選不到`);
  }
});

test("⭐ 0071 必須給 DEFAULT —— 沒有的話 migration 到部署那段空窗期會炸", () => {
  const sql = read("../src/db/migrations/0071_user_locale.sql");
  assert.match(sql, /DEFAULT 'zh-TW'/, "新欄位要有預設值，讓空窗期行為完全不變");
  assert.match(sql, /NOT NULL/, "沒有 NOT NULL 的話讀出來可能是 null，前端要多一層防呆");
});

// ─────────────────────────────────────────────────────────────
// M4b · 後端訊息字典（server/src/i18n/）
// ─────────────────────────────────────────────────────────────

/** 遞迴列出 .ts/.tsx —— ⚠️ 走 fileURLToPath，本專案路徑含中文會被 URL-encode（同 ui-naming 測試） */
function srcFiles(rel: string): string[] {
  const root = fileURLToPath(new URL(rel.endsWith("/") ? rel : `${rel}/`, import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = `${dir}/${f}`;
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  return walk(root);
}

const SRV_ZH = read("../src/i18n/zh-TW.ts");
const SRV_EN = read("../src/i18n/en.ts");

test("⭐ M4b · 後端兩份字典 key 完全一致", () => {
  const zh = new Set(keysOf(SRV_ZH));
  const en = new Set(keysOf(SRV_EN));
  assert.deepEqual([...zh].filter((k) => !en.has(k)), [], "只在 zh-TW");
  assert.deepEqual([...en].filter((k) => !zh.has(k)), [], "只在 en");
  assert.ok(zh.size > 100, `後端字典只有 ${zh.size} 條，看起來被截斷了`);
});

test("⭐ M4b · 英文字典不可殘留中文（漏翻會靜默 fallback 回中文，看起來像正常）", () => {
  const bad = [...SRV_EN.matchAll(/^\s*"([^"]+)":\s*"([^"]*[一-鿿][^"]*)"/gm)].map((m) => m[1]);
  assert.deepEqual(bad, [], `這些 key 的英文還是中文：${bad.join(", ")}`);
});

test("⭐ M4b · 插值變數兩邊必須一致（少一個 {min} 英文使用者就看不到那個數字）", () => {
  const varsOf = (src: string) => {
    const out = new Map<string, string>();
    for (const m of src.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) {
      out.set(m[1]!, [...m[2]!.matchAll(/\{(\w+)\}/g)].map((v) => v[1]).sort().join(","));
    }
    return out;
  };
  const zh = varsOf(SRV_ZH), en = varsOf(SRV_EN);
  const bad = [...zh].filter(([k, v]) => en.get(k) !== v).map(([k]) => k);
  assert.deepEqual(bad, [], `插值不一致：${bad.join(", ")}`);
});

test("⭐⭐ M4b · 程式碼裡引用的 srv.* key 必須都在字典裡（fallback 會印出 key 本身）", () => {
  const zh = new Set(keysOf(SRV_ZH));
  const missing = new Set<string>();
  for (const f of srcFiles("../src")) {
    if (f.includes("/i18n/")) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/"(srv\.[A-Za-z0-9.]+)"/g)) {
      if (!zh.has(m[1]!)) missing.add(m[1]!);
    }
  }
  assert.deepEqual([...missing], [], `字典缺這些 key：${[...missing].join(", ")}`);
});

test("⭐⭐ M4b · Accept-Language 只在明確不是中文時才給英文（看不懂就給英文會讓台灣使用者看不懂錯誤）", async () => {
  const { parseAcceptLanguage } = await import("../src/i18n/locale.js");
  assert.equal(parseAcceptLanguage(undefined), "zh-TW", "沒帶 header → 中文");
  assert.equal(parseAcceptLanguage(""), "zh-TW");
  assert.equal(parseAcceptLanguage("zh-TW,zh;q=0.9"), "zh-TW");
  assert.equal(parseAcceptLanguage("zh-Hant"), "zh-TW");
  assert.equal(parseAcceptLanguage("en-US,en;q=0.9"), "en");
  assert.equal(parseAcceptLanguage("en"), "en");
  assert.equal(parseAcceptLanguage("ja,en;q=0.8"), "en", "非中文一律走英文（唯一的另一個選項）");
});

test("⭐⭐ M4b · 沒有請求上下文時 msg() 回中文而不是 throw（cron / webhook 沒有 Accept-Language）", async () => {
  const { msg } = await import("../src/i18n/index.js");
  const { localeStore } = await import("../src/i18n/locale.js");
  assert.equal(localeStore.getStore(), undefined, "此測試必須在上下文之外跑");
  assert.equal(msg("srv.auth.badCredentials"), "帳號或密碼錯誤");
  assert.equal(msg("srv.perm.lockedPerms", { n: 3 }), "有 3 項權限不開放調整");
  assert.equal(msg("srv.這個key不存在"), "srv.這個key不存在", "找不到就回 key 本身，不 throw");
});

test("⭐⭐ M4b · 在英文上下文裡 msg() 回英文，且插值有代進去", async () => {
  const { msg } = await import("../src/i18n/index.js");
  const { localeStore } = await import("../src/i18n/locale.js");
  localeStore.run("en", () => {
    assert.equal(msg("srv.auth.badCredentials"), "Incorrect email or password");
    assert.equal(msg("srv.perm.lockedPerms", { n: 3 }), "3 of the selected permissions cannot be adjusted");
    assert.equal(msg("srv.auth.locked", { min: 15 }), "Account locked — try again in 15 minutes");
  });
});

test("⭐⭐ M4b · 前端不可再用「訊息裡有沒有中文」判斷是不是 server 特意寫的（server 現在也回英文）", () => {
  const api = read("../../web/src/api.ts");
  assert.ok(!/const hasChinese\s*=/.test(api),
    "api.ts 還在用 hasChinese 判斷 —— server 特意寫的英文訊息會被通用 fallback 蓋掉");
  assert.ok(/"accept-language": getLocale\(\)/.test(api),
    "api.ts 沒有把 accept-language 帶上去 —— 後端永遠當成中文");
});

test("⭐⭐ M4b · 不可用中文字串比對來判斷後端錯誤類型（切英文會靜默失效）", () => {
  // 2026-08-27 實際踩到：FirstLoginChangePassword 比對「密碼不符合安全政策」這句話。
  // server 一改多語，英文使用者永遠不命中，而且不報錯 —— 那張違規清單靜靜消失。
  for (const f of srcFiles("../../web/src")) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\.(includes|startsWith|endsWith)\(\s*"([^"]*[一-鿿][^"]*)"\s*\)/g)) {
      assert.fail(`${f.split("/web/src/")[1]} 用中文字串比對後端訊息：${m[2]} —— 改比機器碼（body.status 之類）`);
    }
  }
});
