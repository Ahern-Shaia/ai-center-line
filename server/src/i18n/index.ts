// 後端訊息字典。docs/modules/i18n.md M4b
//
// ⚠️ **只放「會被丟給使用者看」的訊息**（Exception 的 message）。
//    以下三類**不要**放進來：
//    · log / console —— 那是給我們看的，翻了反而難 grep
//    · 稽核紀錄的描述 —— FMEA F-5：歷史紀錄要留當時的文字，不可事後被新語言重繪
//    · LINE 推播 —— FMEA F-4：那條軸的語言來源是**收件人**的 `users.locale`，
//      不是當前請求的 Accept-Language。混用會讓台灣員工收到英文通知。
//
// key 命名一律 `srv.<模組>.<情境>`，與前端字典（`web/src/i18n/`）分開兩份 ——
// 兩邊的字串沒有交集，合成一份只會讓每次改動都要跨專案對齊。
import zhTW from "./zh-TW.js";
import en from "./en.js";
import { currentLocale, type Locale } from "./locale.js";

const DICT: Record<Locale, Record<string, string>> = { "zh-TW": zhTW, en };

/**
 * 取訊息。`{name}` 形式插值。
 *
 * 找不到 key 的順序是 **當前語言 → 中文 → key 本身**，與前端一致：
 * 漏翻時降級成看得懂的中文，而不是把 `srv.auth.badCredentials` 印給客戶看。
 *
 * ⚠️ 叫 `msg` 不叫 `t` —— server 有好幾個檔案已經有區域變數 `t`
 *    （drizzle 的 table alias、query result）· 同名會被靜默遮蔽，
 *    而且 tsc 的錯誤訊息（`Type 'String' has no call signatures`）看不出是這個原因。
 */
export function msg(key: string, vars?: Record<string, string | number>): string {
  const raw = DICT[currentLocale()][key] ?? DICT["zh-TW"][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** 有沒有這個 key（守門測試用 · msg() 會 fallback 所以不能用 msg(k) !== k 判斷）。 */
export function hasKey(key: string, locale: Locale = "zh-TW"): boolean {
  return key in DICT[locale];
}

export { currentLocale, type Locale } from "./locale.js";
