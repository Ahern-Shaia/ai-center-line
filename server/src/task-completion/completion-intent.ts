// 引用回覆的意圖判定 · docs/modules/task-completion-tracking.md §2.2
//
// 判定的範圍很小：**一則回覆 ＋ 一則被引用的原訊息**。
// 不需要理解整個群的脈絡，只需要判斷這一句是完成、進度、還是別的。
// quotedMessageId 給的是**確定性連結**（查表查出來的），AI 只負責讀那一句話。
//
// ⚠️ 判錯的兩個方向代價不對等：
//    判成「進度」而其實做完了 —— 任務多開幾天，人再回一次就好。
//    判成「完成」而其實沒做完 —— **系統宣稱一件沒做完的事做完了**，
//    而且會把它從當責人手上拿走。所以一律往保守側靠。

export type CompletionIntent =
  /** 指派者自己引用自己的訊息追進度 —— 不是狀態回報，不動任何狀態 */
  | "follow_up"
  /** 高把握：這件事做完了 */
  | "completion"
  /** 有動靜但沒做完，或看不出來 —— 記一筆進度，任務留著 */
  | "progress"
  /** 像做完了但不確定 —— 就地問一句，一個 tap 決定 */
  | "ask";

/**
 * 疑問句。
 * ⚠️ 這條擋掉的是 prod 實測 33% 的誤判來源：「Bom建**好了嗎**」「請問改**好了嗎**?」
 *    —— 「好了嗎」裡面就含「好了」，純關鍵字比對會把**催問**判成**完成**，
 *    而那是最糟的方向（把還沒做完的關掉）。
 */
const QUESTION = /[嗎呢?？]/;

/** 明確否定 —— 講的人自己說還沒好，不用再問 */
const NEGATION = /還沒|尚未|沒有好|沒好|還不|不行|做不完|來不及/;

/**
 * 模糊詞 —— 像做完了，但沒把握。
 * 「快好了」不是「好了」；「應該可以了」不是「可以了」。
 */
const HEDGE = /快好|快完|應該|大概|差不多|可能|等一下|等等|再一下|馬上|稍後|之後再|部分/;

/**
 * 高把握的完成語意。
 * 這份清單刻意保守 —— 寧可少接一筆（人再回一次就好），
 * 不可誤報一筆（系統會宣稱沒做完的事做完了）。
 */
const DONE = new RegExp(
  [
    "已完成", "完成了", "已處理", "處理完", "處理好",
    "已設定", "設定好", "已聯絡", "聯絡好", "已修好", "修好了",
    "已解決", "解決了", "已結案", "結案了", "已交", "已送出", "已回覆",
    "弄好了", "做好了", "換好了", "裝好了", "改好了", "建好了", "搞定",
    "ok了", "OK了", "Ok了", "好了",
  ].join("|"),
);

export interface IntentInput {
  /** 回覆的內容 */
  text: string;
  /** 誰回的（LINE user id） */
  replierLineUserId: string | null;
  /** 被引用那則是誰發的（LINE user id） */
  quotedSenderLineUserId: string | null;
}

/**
 * 判定順序不可顛倒 —— 結構規則零誤差且不依賴語言，所以先跑。
 *
 * prod 實測：那兩則誤判「自己引自己」與「疑問句」**兩個過濾器各自都抓得到**，
 * 是雙保險不是重複。
 */
export function classifyIntent(input: IntentInput): CompletionIntent {
  const { text, replierLineUserId, quotedSenderLineUserId } = input;

  // ① 結構：指派者引用自己的指派訊息 = 催問，不是回報
  if (
    replierLineUserId &&
    quotedSenderLineUserId &&
    replierLineUserId === quotedSenderLineUserId
  ) {
    return "follow_up";
  }

  const t = text.trim();
  if (!t) return "progress";

  // ② 疑問句一律不判完成
  if (QUESTION.test(t)) return "progress";

  // ③ 明確說還沒 —— 不用問，就是進度
  if (NEGATION.test(t)) return "progress";

  const looksDone = DONE.test(t);

  // ④ 有完成語意但帶模糊詞 → 就地問（§2.5），不自作主張
  if (looksDone && HEDGE.test(t)) return "ask";

  if (looksDone) return "completion";

  return "progress";
}
