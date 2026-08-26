// i18n 守門 · docs/modules/i18n.md FMEA F-1 / F-2 / F-3
//
// ⭐ 這支測試在 server/ 是因為前端沒有 test runner ——
//    它讀的是 web/src 的**檔案內容**，不需要跑 React。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
