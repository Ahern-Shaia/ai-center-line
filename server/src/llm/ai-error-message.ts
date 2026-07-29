/**
 * AI 失敗原因 → 給使用者看的中文。
 *
 * ⚠️ 2026-07-29 prod 實況：日報頁上直接印出
 *   `400 {"type":"error","error":{"type":"invalid_request_error","message":
 *    "Your credit balance is too low to access the Anthropic API..."}}`
 *
 * 三個問題疊在一起：
 *   ① 客戶看不懂英文 JSON，也不該看到我們的供應商是誰
 *   ② `request_id` 之類的內部識別碼外流
 *   ③ 最重要的 —— 使用者**不知道自己該做什麼**。這是我們要儲值，不是他要重試，
 *      但畫面上只有一顆「重新生成」，他就會一直按（實際回報：一直按沒有反應）。
 *
 * 原始訊息仍寫進 log 與 DB 供我們排查，只有回給前端的那一層換成這裡的文案。
 */
export function friendlyAiError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase();

  // 額度用完 —— 這是我方的事，明講「不是你的問題、不用一直重試」
  if (t.includes("credit balance") || t.includes("billing") || t.includes("insufficient_quota")) {
    return "AI 服務額度不足，已通知系統管理員處理 · 重試無法解決，請稍後再查看";
  }
  if (t.includes("rate limit") || t.includes("429") || t.includes("overloaded")) {
    return "AI 服務忙碌中 · 請稍後再按一次「重新生成」";
  }
  if (t.includes("timeout") || t.includes("etimedout") || t.includes("econnreset")) {
    return "連線逾時 · 請稍後再按一次「重新生成」";
  }
  if (t.includes("api key") || t.includes("authentication") || t.includes("401")) {
    return "AI 服務設定有誤，已通知系統管理員處理";
  }
  return "AI 整理失敗 · 請稍後再試，若持續發生請聯繫系統管理員";
}
