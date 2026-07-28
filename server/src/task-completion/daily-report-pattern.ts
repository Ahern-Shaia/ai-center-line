// 「今日工作回報」樣式偵測 · docs/modules/task-completion-tracking.md §2.3
//
// 為什麼要偵測而不是要求他們用固定格式：
// 技術工程部組長群**每晚固定 5 個人**在發這種回報，而且是自願的、沒人叫他們發。
// 我們要做的是**搭上既有習慣**，不是另外建一個新動作 ——
// 客戶自己的日報頁有強制機制，同一週 22 份只走完 5 份；
// LINE 群裡沒有任何要求，卻有 9 個人自發回報 26 則。
//
// ⚠️ 拿不準就不回。少回一次沒事，亂回一次很吵（F-21）——
// 把普通聊天誤判成回報，然後在群裡貼一串清單，會被當成機器人亂回。

/** 明示型：直接寫了「回報」兩個字 */
const EXPLICIT = /今日(工作內容|工作|進度)?回報|本日(工作|進度)?回報|工作內容回報|進度回報/;

/**
 * 樣式型：日期 ＋ 名字 開頭，後面接條列。
 * prod 實例：「7/27 阿斌 ⏎ 晨會 ⏎ 人員工作安排確認」「7/27～勝傑 ⏎ 晨會」
 *
 * ⚠️ 一定要**同時**要求多行 —— 只看開頭的話，
 *    「7/28 記得帶資料」這種交代事項也會中。
 */
const DATED_HEADER = /^\s*\d{1,2}\s*[/／-]\s*\d{1,2}\s*[~～\s]*\S{1,12}\s*$/;

/** 條列型的第二行常見詞（晨會、部門週會…）· 只當輔助訊號 */
const ROUTINE_WORD = /晨會|週會|例會|工作安排|進度確認/;

export function isDailyReport(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;

  if (EXPLICIT.test(t)) return true;

  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 單行的一律不算 —— 回報一定會列事項，只有一行的多半是交代或閒聊
  if (lines.length < 3) return false;

  if (DATED_HEADER.test(lines[0])) return true;

  // 開頭沒有日期，但第二行是「晨會」這類固定行程，且列了三項以上
  if (lines.length >= 4 && ROUTINE_WORD.test(lines[1])) return true;

  return false;
}

/**
 * 提醒的升級階梯 · doc §2.5 · F-25
 *
 * 同樣 3 件連續出現 30 天，人會自動忽略。
 * 紀律要有階梯，不是無限重複同一句話。
 */
export type ReminderTier = "normal" | "aged" | "escalate";

export function tierFor(openDays: number): ReminderTier {
  if (openDays <= 3) return "normal";
  if (openDays <= 7) return "aged";
  return "escalate";        // 8 天起改浮到主管端，不再對他重複
}
