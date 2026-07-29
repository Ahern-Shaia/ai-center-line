/**
 * 從錯誤鏈裡挖出違反的約束名。
 *
 * ⚠️ Drizzle 會把 pg 的錯誤包一層，`err.message` 只剩「Failed query: ...」，
 * 約束名在 `err.cause.constraint`。對 message 下 regex 永遠不會中 ——
 * 而 `assert.rejects` 沒帶 matcher 的話會**為了錯的理由通過**（RLS 擋掉也算 reject）。
 */
export function constraintOf(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const c = (cur as { constraint?: string }).constraint;
    if (c) return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** 斷言某段操作因為**指定的**約束而失敗（不是隨便一種失敗） */
export async function rejectsWithConstraint(
  fn: () => Promise<unknown>, constraint: string, why: string,
): Promise<void> {
  let thrown: unknown;
  try { await fn(); } catch (e) { thrown = e; }
  const got = constraintOf(thrown);
  if (got !== constraint) {
    throw new Error(`${why}\n  期望約束 ${constraint}，實際 ${got ?? "沒有拋錯"}`);
  }
}
