import { useSyncExternalStore } from "react";
import { getLocale, setLocale, subscribe, t, type Locale } from "./index.js";

// React 綁定 · 用 useSyncExternalStore 而非 Context（理由見 ./index.ts 檔頭）
//
// 用法：
//   const tr = useT();
//   <h1>{tr("taskBoard.title")}</h1>
//
// ⚠️ 不要在元件裡直接 import { t } —— 那樣切語言時**不會重繪**。
//    t() 是給非 React 程式碼（api.ts 之類）用的。
//    `i18n-guard.test.ts` 會擋這種寫法。

/** 目前語言 · 切換時會觸發重繪 */
export function useLocale(): [Locale, (l: Locale) => void] {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return [locale, setLocale];
}

/** 綁在目前語言上的 t() —— 語言一換，用到它的元件就重繪 */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return t;
}
