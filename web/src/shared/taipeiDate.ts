// 台灣時間的「今天」· YYYY-MM-DD
//
// 為什麼不用 `new Date().toISOString().slice(0, 10)`：那是 UTC 的日期，
// 台灣時間早上 8 點前會少一天 —— 使用者選「今天」卻查不到今天早上的資料。
// en-CA 的日期格式剛好就是 YYYY-MM-DD，不用自己補零。
//
// 後端對應寫法是 `(欄位 AT TIME ZONE 'Asia/Taipei')::date`（見 media.service / attendance）——
// 前後端要用同一個「一天」的定義，否則邊界那幾筆會對不起來。
export function getTaipeiDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

/** N 天前的台灣日期 · 用來給「近 7 天」這類快捷 */
export function taipeiDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}
