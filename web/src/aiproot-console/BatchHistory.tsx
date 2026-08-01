import Spinner from "../shared/Spinner";
import { useEffect, useMemo, useState } from "react";
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";
import {
  ApiError,
  listAnalysisBatches,
  listAiprootTenants,
  rerunAnalysisBatch,
  runPendingBatches,
  setTenantBatchEnabled,
  type AnalysisBatchRow,
  type AiprootTenantOption,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import { AnalysisStateCell, AnalysisSummary } from "./AnalysisStateCell";

// AIPROOT 管理 → 對話分析歷程 · 只 aiproot_admin / consultant 可見
// 依 feedback_reuse_project_ui_conventions.md 走 6 大慣例：
//   Dialog=ConfirmDialog · table=.dm-table · empty=.dm-empty
//   date=.toLocaleString("zh-TW") · number=.toLocaleString() · 下拉=react-aria Select

// ⚠️ 原本這裡有 STATUS_LABEL / STATUS_TONE 把 batch.status 直接印出來，
//    其中 `completed: "已完成"` 配綠色 —— 那是整個系統裡最誤導的一處：
//    後端的 completed 是「訊息收齊、分析已排入」，不是分析成功。
//    prod 50 筆全綠、其中 6 筆的分析根本沒完成，而沒有任何人知道。
//    現在狀態一律由 analysisState 推導顯示（見 AnalysisStateCell.tsx）。
const RAW_STATUS_LABEL: Record<AnalysisBatchRow["status"], string> = {
  pending: "待跑",
  running: "執行中",
  completed: "已排入分析",
  failed: "收訊息失敗",
  empty: "當日無訊息",
};

type PendingConfirm =
  | { type: "rerun"; row: AnalysisBatchRow }
  | { type: "run-pending" }
  | null;

interface Props {
  onOpenAnalysis?: (uploadId: number) => void;
}

export default function BatchHistory({ onOpenAnalysis }: Props = {}) {
  const toast = useToast();
  const [rows, setRows] = useState<AnalysisBatchRow[]>([]);
  const [tenants, setTenants] = useState<AiprootTenantOption[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [onlyAttention, setOnlyAttention] = useState(false);

  async function refresh(tenantId: string = selectedTenantId) {
    setLoading(true);
    try {
      const res = await listAnalysisBatches(tenantId || undefined);
      setRows(res.batches);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入批次歷程失敗", "danger");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    listAiprootTenants().then((res) => setTenants(res.tenants)).catch(() => undefined);
    void refresh("");
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const tenantName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tenants) map.set(t.tenantId, t.tenantName);
    return (id: string) => map.get(id) ?? id.slice(0, 8);
  }, [tenants]);

  const selectedTenant = useMemo(
    () => tenants.find((t) => t.tenantId === selectedTenantId),
    [tenants, selectedTenantId],
  );

  async function onToggleBatchEnabled() {
    if (!selectedTenant || busy) return;
    setBusy(true);
    try {
      const next = !selectedTenant.batchEnabled;
      const res = await setTenantBatchEnabled(selectedTenant.tenantId, next);
      setTenants((prev) => prev.map((t) =>
        t.tenantId === res.tenantId ? { ...t, batchEnabled: res.batchEnabled } : t));
      toast.show(
        `${selectedTenant.tenantName} · 每日 batch 已${res.batchEnabled ? "啟用" : "停用"}`,
        "ok",
      );
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "切換失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  const countByTenant = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.tenantId, (map.get(r.tenantId) ?? 0) + 1);
    return map;
  }, [rows]);

  async function onTenantChange(id: string) {
    setSelectedTenantId(id);
    void refresh(id);
  }

  async function executeConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.type === "rerun") {
        const row = confirm.row;
        const res = await rerunAnalysisBatch({
          tenantId: row.tenantId,
          groupId: row.groupId,
          batchDate: row.batchDate,
        });
        // ⚠️ 不可以說「完成」。後端的 completed 是「訊息收齊、分析已排入」，
        //    AI 分析在背景另外跑（prod 實測 109 則約 1 分鐘）。
        //    說完成的話，使用者當下重新整理看到沒結果，會以為重跑失敗。
        toast.show(
          res.status === "failed" ? "重跑失敗"
            : res.status === "empty" ? "這一天沒有訊息可分析"
            : res.analysis === "already_done" ? `已分析過 · ${res.messageCount.toLocaleString()} 則訊息`
            : `已排入分析 · ${res.messageCount.toLocaleString()} 則訊息 · 在背景進行，稍後重新整理看結果`,
          res.status === "failed" ? "danger" : "ok",
        );
      } else {
        // batch 永遠 tenant-scoped · 沒選租戶就不執行 (UI 按鈕已 disable · 這裡加保底)
        if (!selectedTenantId) {
          toast.show("請先選擇租戶", "danger");
          return;
        }
        const scope = tenantName(selectedTenantId);
        const res = await runPendingBatches({
          lookbackDays: 2,
          tenantId: selectedTenantId,
        });
        toast.show(
          `${scope} · 共 ${res.total.toLocaleString()} 個 · 完成 ${res.completed} · 空群 ${res.empty} · 失敗 ${res.failed}`,
          "ok",
        );
      }
      setConfirm(null);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "執行失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  const confirmDialog = confirm && (
    <ConfirmDialog
      open
      onClose={() => !busy && setConfirm(null)}
      onConfirm={() => void executeConfirm()}
      busy={busy}
      title={confirm.type === "rerun" ? "重跑 Batch" : "掃 pending 全跑"}
      body={confirm.type === "rerun" ? (
        <>
          即將重跑：<br />
          租戶 <b>{tenantName(confirm.row.tenantId)}</b><br />
          群組 <code className="mono">{confirm.row.groupId.slice(0, 24)}…</code><br />
          日期 <b>{confirm.row.batchDate}</b>
        </>
      ) : (
        <>
          即將掃過去 2 天所有未跑 batch：<br />
          租戶 <b>{selectedTenantId ? tenantName(selectedTenantId) : ""}</b><br />
          併發 3 · 依訊息量決定耗時。
        </>
      )}
      confirmLabel={confirm.type === "rerun" ? "重跑" : "開始"}
    />
  );

  const dateFmt = (iso: string | null) => iso
    ? new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div className="pane">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>對話分析歷程</h1>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
            LINE 訊息 → 每日 08:00 (台北) 自動 batch → analysis_upload · 也可手動重跑
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>租戶</span>
          <Select
            className="llm-select"
            selectedKey={selectedTenantId || "__all__"}
            onSelectionChange={(k) => void onTenantChange(k === "__all__" ? "" : String(k))}
            aria-label="租戶"
            isDisabled={loading || busy}
          >
            <AriaButton className="llm-select-btn" style={{ minWidth: 240 }}>
              <SelectValue className="llm-select-value">
                {() => selectedTenantId
                  ? `${tenantName(selectedTenantId)} · ${countByTenant.get(selectedTenantId) ?? 0} 筆 batch`
                  : `全部租戶 · 共 ${rows.length.toLocaleString()} 筆 batch`}
              </SelectValue>
              <svg className="llm-select-chev" width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden>
                <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </AriaButton>
            <Popover className="llm-select-pop" offset={4}>
              <ListBox
                className="llm-select-list"
                items={[{ id: "__all__", name: `全部租戶 · 共 ${rows.length.toLocaleString()} 筆 batch` }, ...tenants.map((t) => ({
                  id: t.tenantId,
                  name: `${t.tenantName} · ${countByTenant.get(t.tenantId) ?? 0} 筆 batch`,
                }))]}
              >
                {(item) => (
                  <ListBoxItem id={item.id} textValue={item.name} className="llm-select-item">
                    <span>{item.name}</span>
                    <svg className="llm-select-check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="m2 7 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </ListBoxItem>
                )}
              </ListBox>
            </Popover>
          </Select>
          {selectedTenant && (
            <button
              className="btn"
              onClick={() => void onToggleBatchEnabled()}
              disabled={busy}
              title={selectedTenant.batchEnabled
                ? "點擊 · 停用此租戶每天 08:00 的自動分析（仍可手動觸發）"
                : "點擊 · 恢復此租戶每天 08:00 的自動分析"}
            >
              每日 batch · <b style={{ color: selectedTenant.batchEnabled ? "var(--ok-600)" : "var(--rose-600)" }}>
                {selectedTenant.batchEnabled ? "啟用中" : "已停用"}
              </b>
            </button>
          )}
          <button className="btn" onClick={() => void refresh()} disabled={loading || busy}>重新整理</button>
          <button
            className="btn primary"
            onClick={() => setConfirm({ type: "run-pending" })}
            disabled={busy || !selectedTenantId}
            title={selectedTenantId
              ? `掃「${tenantName(selectedTenantId)}」過去 2 天所有未跑 batch`
              : "請先於上方下拉選擇租戶 · 對話分析只能按單一租戶執行"}
          >
            {selectedTenantId
              ? `掃「${tenantName(selectedTenantId)}」pending`
              : "掃 pending（請先選租戶）"}
          </button>
        </div>
      </div>

      {loading ? (
        <Spinner block />
      ) : rows.length === 0 ? (
        <div className="dm-empty">
          {selectedTenantId
            ? "該租戶目前無批次記錄 · 待訊息累積後由排程 / 手動觸發"
            : "尚無批次記錄 · 待第一筆訊息接入 + 排程觸發或手動掃"}
          <div className="dm-empty-hint">排程時間：每日 08:00（台北）</div>
        </div>
      ) : (
        <div>
          <AnalysisSummary rows={rows} onlyAttention={onlyAttention} onToggle={setOnlyAttention} />
          <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>租戶</th>
                <th>Group</th>
                <th className="num">訊息數</th>
                <th>分析結果</th>
                <th>觸發</th>
                <th>排入時間</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(onlyAttention ? rows.filter((r) => r.needsAttention) : rows).map((r) => (
                <tr key={r.batchId}>
                  <td className="mono">{r.batchDate}</td>
                  <td className="dm-td-name">{tenantName(r.tenantId)}</td>
                  <td className="mono" title={r.groupId}>{r.groupId.slice(0, 12)}…</td>
                  <td className="num">{r.messageCount.toLocaleString()}</td>
                  <td><AnalysisStateCell row={r} /></td>
                  <td className="mono">{r.triggeredBy}</td>
                  {/* ⚠️ 這一欄是 batch 的 completed_at＝「訊息收齊、排入分析」的時間，
                      不是分析完成時間。表頭原本寫「完成時間」，同一個誤導。 */}
                  <td className="mono" title={`批次狀態：${RAW_STATUS_LABEL[r.status]}`}>{dateFmt(r.completedAt)}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {r.uploadId != null && onOpenAnalysis && (
                      <button
                        className="btn small"
                        onClick={() => onOpenAnalysis(r.uploadId!)}
                        title="查看分析內容 (classifications / daily_reports / records)"
                      >查看</button>
                    )}
                    <button className="btn small" onClick={() => setConfirm({ type: "rerun", row: r })} disabled={busy}>重跑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
