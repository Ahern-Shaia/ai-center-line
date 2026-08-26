import { t } from "../i18n";

// AI 抽取的記錄狀態 → 中文顯示（中文優先鐵則 · 單一來源避免各視圖走鐘）
//
// ⚠️ 為什麼要有這個檔：同一個 enum 原本全站有**三套**呈現 ——
//   TaskTriage：open→待處理 / resolved→已完成
//   convo-analysis/Detail：open→未處理 / resolved→已解決
//   SourceDrawer：完全沒翻，直接把 `in_progress` 印給使用者看
// 同一筆資料在三個畫面上長不一樣，客戶會以為是不同的東西。
//
// ⚠️ `resolved` 刻意**不叫「已完成」**：
// 這一欄是 **AI 從對話讀到的**（推論），而「完成」是**本人回報的**（承諾，存在 work_outcome）。
// 兩者用同一個詞的話，看板上會出現「已完成但尚未確認完成」這種自相矛盾的句子。
// 對照 docs/modules/task-completion-tracking.md §1.3。
// ⚠️ 2026-08-26 i18n：文字搬進 i18n/*.ts（key = `recordStatus.<enum>`）· API 不變
/** 未知值 fallback 原值 —— 不吞資料，但至少看得出來是沒對應到 */
export const statusLabel = (s: string | null | undefined): string =>
  s ? t(`recordStatus.${s}`) : "";
