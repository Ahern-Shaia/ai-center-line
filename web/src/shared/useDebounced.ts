import { useEffect, useState } from "react";

/**
 * 延遲版的值 · 給「打字要打 API」的搜尋框用。
 *
 * ⚠️ 沒有它的話，每一個按鍵都是一次請求 —— 打「報價單」＝ 3 次查詢，
 * 而且回應順序不保證，可能被前一次的結果蓋回去（打完看到的是打到一半的結果）。
 *
 * 專案裡既有的搜尋框（notify-config `RuleFilters`）是**純前端過濾**，
 * 不打 API 所以不需要這個 —— 別照著那邊抄。
 */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
