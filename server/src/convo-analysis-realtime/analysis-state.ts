/**
 * 批次的「真實結果」· docs/modules/batch-status-reconciliation.md §4-bis
 *
 * ⚠️ `analysis_batch.status` 不是分析結果。它是「訊息收齊、分析已排入」——
 *    prod 50 筆全是 `completed`，`markFailed()` 從上線到現在沒觸發過一次
 *    （一個只有一種值的狀態欄位不帶任何資訊，卻被當成「分析成功」在讀）。
 *    真正的結果在 `analysis_upload.status`，而兩者之間沒有回寫。
 *
 * 這支函式把兩邊合起來推導出「這一批到底怎麼了」。純函式，好測。
 */

export type AnalysisState =
  | "analyzed"         // 分析完成
  | "analysis_failed"  // 分析跑了但失敗（有錯誤訊息）
  | "analyzing"        // 排入不久，還在跑
  | "stuck"            // ⚠️ 排入很久了但沒有結果，也沒有錯誤訊息（S2）
  | "no_result"        // ⚠️ batch 說完成但沒有 upload（S3）
  | "collect_failed"   // 收訊息階段就失敗
  | "empty"            // 那天沒有訊息可分析
  | "queued";          // batch 自己還沒跑完

/** 需要人去看一眼的狀態。0 筆也要顯示「全部正常」—— 不顯示等於空白看起來像正常。 */
const ATTENTION: ReadonlySet<AnalysisState> = new Set<AnalysisState>([
  "analysis_failed", "stuck", "no_result", "collect_failed",
]);

export function needsAttention(s: AnalysisState): boolean {
  return ATTENTION.has(s);
}

export function deriveAnalysisState(args: {
  batchStatus: "pending" | "running" | "completed" | "failed" | "empty";
  uploadId: number | null;
  uploadStatus: string | null;
  /** batch 標完成後是否已超過對帳門檻（OQ-BSR-4 · 30 分鐘）· 由 SQL 用 DB 的時鐘算 */
  stale: boolean;
}): AnalysisState {
  const { batchStatus, uploadId, uploadStatus, stale } = args;

  if (batchStatus === "failed") return "collect_failed";
  if (batchStatus === "empty") return "empty";
  if (batchStatus !== "completed") return "queued";

  // 以下都是 batch=completed —— 也就是畫面上原本一律顯示「已完成」的那些。
  if (uploadId === null || uploadStatus === null) return "no_result";
  if (uploadStatus === "done") return "analyzed";
  if (uploadStatus === "failed") return "analysis_failed";

  // pending / running：還在跑，還是卡住了？時間是唯一的線索。
  // ⚠️ 刻意**不區分** pending（從沒開始）與 running（跑到一半死掉）——
  //    兩者的診斷不同，但我們無從判斷是哪一種，所以只說「未完成」，
  //    把原始的 uploadStatus 一起顯示讓看的人自己判斷（不猜原因）。
  return stale ? "stuck" : "analyzing";
}
