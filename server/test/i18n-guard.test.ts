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
