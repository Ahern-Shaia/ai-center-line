/**
 * 查詢參數的日期驗證 · YYYY-MM-DD，而且要是真的存在的日期。
 *
 * ⚠️ 兩層都必要：
 *   · 正則擋掉 `2026/03/10`、`2026-13-45` 這類
 *   · **往返比對**擋掉 `2026-02-30` —— Date 不會拒絕它，會自己進位成 3/2，
 *     所以 `Date.parse` 不回 NaN。放行到 SQL 的話 pg 是 22008，使用者拿到的是 500。
 *
 * 篩選日期一律走這支：擋在 controller，錯誤才會是 400＋中文訊息，
 * 而不是一個長得像系統壞掉的 500。
 */
export function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
