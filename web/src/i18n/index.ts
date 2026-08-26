// i18n 骨架 · docs/modules/i18n.md（M1）
//
// ⭐ 刻意**不用 React Context**，改用 useSyncExternalStore（見 ./useT.ts）：
//    · Context 的 value 忘了 useMemo → 所有消費者的 deps 每次都變（曾害 Toast 在 prod 洗版）
//    · Provider 疊在 App 之上 → 登入後不重跑 effect
//    兩個坑本專案都踩過。模組層 store ＋ 外部訂閱沒有這兩個問題，
//    而且 **非 React 的程式碼（api.ts 的錯誤訊息對照）也叫得動 t()**。
//
// ⚠️ 為什麼手寫而不引 react-i18next（OQ-I18N-3）：
//    本專案的字串形狀很簡單（幾乎沒有複數、少量插值），而
//    confirmStatusLabel / roleLabel / categoryLabel / recordStatusLabel
//    **本來就是四張對照表** —— i18n 是把它們系統化，不是另起爐灶。
//    另起爐灶會變第五張，下次改狀態名要改五個地方。

import zhTW from "./zh-TW.js";
import en from "./en.js";

export type Locale = "zh-TW" | "en";
export const LOCALES: readonly Locale[] = ["zh-TW", "en"] as const;
export const LOCALE_NAME: Record<Locale, string> = { "zh-TW": "繁體中文", en: "English" };

/** 字典以 zh-TW 為準 —— 缺 key 一律回中文，不回 key 本身（見 t()） */
const DICT: Record<Locale, Record<string, string>> = { "zh-TW": zhTW, en };

const STORAGE_KEY = "aiproot.locale";

function isLocale(v: unknown): v is Locale {
  return v === "zh-TW" || v === "en";
}

/**
 * 初始語言。
 *
 * 判準：**只有在瀏覽器明確不是中文時才給英文**。
 * 反過來（預設英文）會讓台灣工廠的使用者第一眼看到看不懂的畫面 ——
 * 那個代價遠大於外籍主管多點一次切換。
 */
function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch { /* 無痕模式可能存取不到 · 當作沒設定過 */ }
  const nav = typeof navigator !== "undefined" ? navigator.language?.toLowerCase() : "";
  return nav && !nav.startsWith("zh") ? "en" : "zh-TW";
}

let current: Locale = detect();
const subscribers = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* 存不了就只在本次 session 生效 */ }
  document.documentElement.lang = next === "en" ? "en" : "zh-Hant-TW";
  for (const fn of subscribers) fn();
}

/** 給 useSyncExternalStore 用 · 回傳退訂函式 */
export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/**
 * 取字串。`{name}` 形式的插值。
 *
 * ⚠️ 找不到 key 時的順序是 **英文字典 → 中文字典 → key 本身**。
 *    直接回 key 會讓漏翻的地方變成 `taskBoard.title` 這種東西印在客戶畫面上；
 *    回中文至少是**看得懂的降級**（而且一眼看得出哪裡還沒翻）。
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = DICT[current][key] ?? DICT["zh-TW"][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * 有沒有這個 key（給守門測試與 debug 用）。
 * t() 會 fallback，所以不能用 t(k) !== k 判斷。
 */
export function hasKey(key: string, locale: Locale = current): boolean {
  return key in DICT[locale];
}

/** 初始化 <html lang> —— 進站當下就要對，不然螢幕閱讀器與瀏覽器翻譯會判錯 */
if (typeof document !== "undefined") {
  document.documentElement.lang = current === "en" ? "en" : "zh-Hant-TW";
}
