import { useEffect, useState } from "react";
import { ApiError, listAnalysisBatches, rerunAnalysisBatch, runPendingBatches, type AnalysisBatchRow } from "../api";
import { useToast } from "../Toast";

// AIPROOT 管理 → 對話分析歷程 · 只 aiproot_admin / consultant 可見
// 列所有 batch (tenant/group/day/status) · 手動 rerun · 手動掃 pending

const STATUS_LABEL: Record<AnalysisBatchRow["status"], string> = {
  pending: "待跑",
  running: "執行中",
  completed: "已完成",
  failed: "失敗",
  empty: "當日無訊息",
};
const STATUS_TONE: Record<AnalysisBatchRow["status"], string> = {
  pending: "var(--ink-3)",
  running: "var(--brand-500)",
  completed: "var(--ok-600)",
  failed: "var(--rose-600)",
  empty: "var(--ink-3)",
};

export default function BatchHistory() {
  const toast = useToast();
  const [rows, setRows] = useState<AnalysisBatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await listAnalysisBatches();
      setRows(res.batches);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入 batch 歷程失敗", "danger");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  async function onRerun(row: AnalysisBatchRow) {
    if (busy) return;
    if (!window.confirm(`重跑 ${row.groupId} · ${row.batchDate}？`)) return;
    setBusy(true);
    try {
      const res = await rerunAnalysisBatch({
        tenantId: row.tenantId,
        groupId: row.groupId,
        batchDate: row.batchDate,
      });
      toast.show(`Batch ${res.status} · ${res.messageCount} 則訊息`, res.status === "failed" ? "danger" : "ok");
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "重跑失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function onRunPending() {
    if (busy) return;
    if (!window.confirm("掃過去 2 天所有未跑 batch · 併發 3 · 可能耗時 · 確定嗎？")) return;
    setBusy(true);
    try {
      const res = await runPendingBatches(2);
      toast.show(`共 ${res.total} 個 · 完成 ${res.completed} · 空群 ${res.empty} · 失敗 ${res.failed}`, "ok");
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "掃 pending 失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pane">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>對話分析歷程</h1>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
            LINE 訊息 → 每日 08:00 (台北) 自動 batch → analysis_upload · 也可手動重跑
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => void refresh()} disabled={loading || busy}>重新整理</button>
          <button className="btn primary" onClick={() => void onRunPending()} disabled={busy}>掃 pending 全跑</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>載入中…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>
          尚無 batch 記錄 · 待第一筆 webhook 訊息 + cron 觸發或手動掃
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
                <th style={cellHdr}>日期</th>
                <th style={cellHdr}>租戶</th>
                <th style={cellHdr}>Group</th>
                <th style={cellHdr}>訊息數</th>
                <th style={cellHdr}>狀態</th>
                <th style={cellHdr}>觸發</th>
                <th style={cellHdr}>完成時間</th>
                <th style={cellHdr}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.batchId} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                  <td style={cell}><span className="mono">{r.batchDate}</span></td>
                  <td style={cell}><span className="mono" title={r.tenantId}>{r.tenantId.slice(0, 8)}</span></td>
                  <td style={cell}><span className="mono" title={r.groupId}>{r.groupId.slice(0, 12)}…</span></td>
                  <td style={cell}>{r.messageCount}</td>
                  <td style={{ ...cell, color: STATUS_TONE[r.status], fontWeight: 500 }}>
                    {STATUS_LABEL[r.status]}
                    {r.errorMessage && <div style={{ fontSize: 11, color: "var(--rose-600)", marginTop: 2 }} title={r.errorMessage}>
                      {r.errorMessage.slice(0, 40)}…
                    </div>}
                  </td>
                  <td style={cell}><span className="mono" style={{ fontSize: 11 }}>{r.triggeredBy}</span></td>
                  <td style={cell}><span className="mono" style={{ fontSize: 11 }}>{r.completedAt?.slice(0, 16) ?? "—"}</span></td>
                  <td style={cell}>
                    <button className="btn small" onClick={() => void onRerun(r)} disabled={busy}>重跑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const cellHdr: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--ink-2)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const cell: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "var(--ink)",
};
