import { useCallback, useEffect, useState } from "react";
import { getLabelInsights, ApiError, type LabelInsights } from "../api";
import { useToast } from "../Toast";
import { catLabel } from "../shared/categoryLabel";
import { canOpenConvoDetail, navigateTo } from "../nav";

// label-driven-improvement M1（跨批準確率）+ M2（錯誤分群入口）· aiproot 看全、租戶看自家
const TYPE_LABEL: Record<LabelInsights["errors"][number]["targetType"], string> = {
  classification: "分類",
  daily_report: "日報",
  record: "記錄",
};

export default function ConvoInsights({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<LabelInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getLabelInsights());
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { void refresh(); }, [refresh]);

  const totalLabels = data ? Object.values(data.accuracy).reduce((n, a) => n + a.total, 0) : 0;

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>抽取準確率 · 標記回饋</h1>
          <div className="sub">人工標「對／錯」的跨批彙總 · 量測 AI 抽取準確率、看出系統性錯誤（改 prompt／主檔的依據）</div>
        </div>
        <button className="btn" onClick={onBack}>← 回分析列表</button>
      </div>

      {loading && !data && <div className="dm-empty">載入中…</div>}

      {data && totalLabels === 0 && (
        <div className="dm-empty">
          <div>目前沒有任何標記</div>
          <div className="dm-empty-hint">到分析詳情頁對抽取結果按「標正確／標錯誤」，這裡就會開始累積準確率與錯誤清單</div>
        </div>
      )}

      {data && totalLabels > 0 && (
        <>
          <div style={{ display: "flex", gap: 12, margin: "4px 0 20px" }}>
            {(["classification", "daily_report", "record"] as const).map((t) => {
              const a = data.accuracy[t];
              const pct = a.total > 0 ? Math.round((a.correct / a.total) * 100) : null;
              return (
                <div key={t} style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "14px 18px" }}>
                  <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{TYPE_LABEL[t]}正確率</div>
                  <div style={{ fontSize: 26, fontWeight: 680, color: pct == null ? "var(--ink-3)" : pct >= 80 ? "var(--ok)" : "var(--warn)" }}>
                    {pct == null ? "—" : `${pct}%`}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{a.correct}/{a.total} 標對</div>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 14, fontWeight: 640, margin: "0 0 8px" }}>
            標「錯誤」的案例（{data.errors.length}）· 集中看哪類老是抽錯
          </div>
          {data.errors.length === 0 ? (
            <div className="dm-empty">目前沒有標記為錯誤的案例</div>
          ) : (
            <div className="dm-table-wrap">
              <table className="dm-table">
                <thead>
                  <tr><th>類型</th><th>內容</th><th>AI 判的分類</th><th>租戶</th><th>來源</th></tr>
                </thead>
                <tbody>
                  {data.errors.map((e, i) => (
                    <tr key={i}>
                      <td>{TYPE_LABEL[e.targetType]}</td>
                      <td>
                        {e.content || <span className="dm-cell-muted">（內容已不存在）</span>}
                        {e.note && <div className="dm-cell-muted">註：{e.note}</div>}
                      </td>
                      <td>{e.category ? catLabel(e.category) : <span className="dm-cell-muted">—</span>}</td>
                      <td className="dm-cell-muted">{e.tenantSlug}</td>
                      <td>
                        {canOpenConvoDetail() ? (
                          <button className="nc-lnk" onClick={() => navigateTo({ page: "convo-detail", uploadId: e.uploadId })}>#{e.uploadId} →</button>
                        ) : <span className="dm-cell-muted">#{e.uploadId}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
