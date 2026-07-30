import type { AnalysisBatchRow, AnalysisState } from "../api";

// 批次的「真實結果」顯示 · docs/modules/batch-status-reconciliation.md §4-bis
//
// ⚠️ 這一頁原本說謊，而檔案裡早就寫下了原因：BatchHistory 有一段
//    「不可以說『完成』。後端的 completed 是『訊息收齊、分析已排入』」——
//    但那段只修了手動重跑的 toast，表格欄位仍是 completed → 綠色「已完成」。
//    prod 50 筆全綠，其中 6 筆的分析其實沒完成。
//
// 慣例沿用既有的 .nc-pill（ok / warn / danger / mut），不加新 CSS。

const LABEL: Record<AnalysisState, string> = {
  analyzed: "已分析",
  analysis_failed: "分析失敗",
  analyzing: "分析中",
  stuck: "分析未完成",
  no_result: "無分析結果",
  collect_failed: "收訊息失敗",
  empty: "當日無訊息",
  queued: "待跑",
};

const PILL: Record<AnalysisState, string> = {
  analyzed: "ok",
  analysis_failed: "danger",
  analyzing: "mut",
  stuck: "warn",
  no_result: "warn",
  collect_failed: "danger",
  empty: "mut",
  queued: "mut",
};

/** 分析階段與收訊息階段的錯誤要分開顯示 —— 混在一起會查錯方向 */
function errorOf(r: AnalysisBatchRow): string | null {
  return r.analysisError ?? r.errorMessage ?? null;
}

export function AnalysisStateCell({ row }: { row: AnalysisBatchRow }) {
  const err = errorOf(row);
  return (
    <>
      <span className={`nc-pill ${PILL[row.analysisState]}`}>{LABEL[row.analysisState]}</span>
      {/* stuck 時把原始 uploadStatus 一起顯示。
          pending＝分析從來沒開始 · running＝跑到一半死掉 —— 診斷不同，
          而我們無從判斷是哪一種，所以不猜，把事實給人看。 */}
      {row.analysisState === "stuck" && row.uploadStatus && (
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
          {row.uploadStatus === "pending" ? "從未開始執行" : `停在 ${row.uploadStatus}`}
        </div>
      )}
      {err && (
        <div style={{ fontSize: 11, color: "var(--rose-600)", marginTop: 2 }} title={err}>
          {err.length > 40 ? `${err.slice(0, 40)}…` : err}
        </div>
      )}
    </>
  );
}

/**
 * 摘要條 · 不必逐列掃就知道要不要處理。
 *
 * ⚠️ 「需檢查 0 筆」時**這條也要在**，寫「全部已分析」——
 *    不顯示等於又一個「空白看起來像正常」，那正是這整個模組要修的病。
 */
export function AnalysisSummary({ rows, onlyAttention, onToggle }: {
  rows: AnalysisBatchRow[];
  onlyAttention: boolean;
  onToggle: (v: boolean) => void;
}) {
  // needsAttention 由後端算 —— 前端不自己維護一份狀態集合（新增狀態時會漏改）
  const attention = rows.filter((r) => r.needsAttention).length;
  const analyzed = rows.filter((r) => r.analysisState === "analyzed").length;

  return (
    <div className="nc-log-bar">
      <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
        共 {rows.length.toLocaleString()} 批次 · 已分析 {analyzed} 筆
        {attention > 0
          ? <> · <b style={{ color: "var(--warn)" }}>需檢查 {attention} 筆</b></>
          : <> · 全部已分析</>}
      </div>
      {attention > 0 && (
        <button
          className={`nc-lnk${onlyAttention ? " active" : ""}`}
          onClick={() => onToggle(!onlyAttention)}
        >
          {onlyAttention ? "顯示全部" : "只看需檢查"}
        </button>
      )}
    </div>
  );
}
