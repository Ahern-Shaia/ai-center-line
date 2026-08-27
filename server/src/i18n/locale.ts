// 每請求的介面語言。docs/modules/i18n.md M4b（C 軸：API 錯誤訊息）
//
// ⚠️ **語言來源是前端送的 `Accept-Language`，不是 JWT。**
//    介面語言的真實來源一直是瀏覽器端（`web/src/i18n/index.ts` 的 store）——
//    使用者按下切換的當下就要生效，不能等重新登入換發 JWT。
//    `users.locale`（migration 0071）是「離線時該用哪個語言」的預設值，
//    給 LINE 推播那條軸用（收件人的語言），不是這條。
//
// ⚠️ 用 AsyncLocalStorage 而不是把 locale 傳過每一層：
//    要動的是 48 個檔案 254 個 throw 點，加參數等於改遍所有 service 簽章。
//    專案已經有同型做法（`db/client.ts` 的 txStore 放 tx）。
import { AsyncLocalStorage } from "node:async_hooks";

export type Locale = "zh-TW" | "en";
export const DEFAULT_LOCALE: Locale = "zh-TW";

export const localeStore = new AsyncLocalStorage<Locale>();

/**
 * 當前請求語言。**取不到一律回中文**，不 throw ——
 * cron / webhook / LINE 推播沒有請求上下文，它們本來就該用預設語言。
 * （對照 `currentTx()` 是取不到就 throw：那裡取不到代表安全邊界破了，這裡不是。）
 */
export function currentLocale(): Locale {
  return localeStore.getStore() ?? DEFAULT_LOCALE;
}

/**
 * 解析 `Accept-Language`。
 *
 * 判準與前端 `detect()` 一致：**只有明確不是中文時才給英文**。
 * 反過來（看不懂就給英文）會讓台灣工廠的使用者看到看不懂的錯誤訊息，
 * 那個代價遠大於外籍主管偶爾看到中文。
 *
 * 只看第一個語言標籤 —— q 值排序對兩種語言沒有意義，多寫只是多一個會錯的地方。
 */
export function parseAcceptLanguage(header: string | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return DEFAULT_LOCALE;
  return first.startsWith("zh") ? "zh-TW" : "en";
}
