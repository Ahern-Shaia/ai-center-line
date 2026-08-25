/**
 * 使用者輸入 → ILIKE 的 `%…%` pattern。
 *
 * ⚠️ **一定要跳脫 `%` `_` `\`**。不跳脫的話：
 *   · 打一個 `%` → 匹配全部（看起來像搜尋壞了）
 *   · 打 `_` → 變成「任一個字元」，「A_1」會撈到「AB1」
 * 使用者輸入的是**字面字串**，不是樣式。
 *
 * 值本身仍走 bind param（R4 prepared statement），這裡只處理樣式語意。
 */
export function likeContains(q: string): string {
  return `%${q.replace(/([\\%_])/g, "\\$1")}%`;
}

/** 修剪 + 長度上限 · 空字串一律回 null（＝不篩） */
export function normalizeQuery(q: string | undefined | null, max = 100): string | null {
  const t = (q ?? "").trim();
  return t ? t.slice(0, max) : null;
}
