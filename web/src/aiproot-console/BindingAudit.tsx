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
  listAiprootTenants,
  listBindingAudit,
  revokeBindingAiproot,
  deleteBindingAiproot,
  getUnboundStats,
  type AiprootTenantOption,
  type BindingAuditRow,
  type UnboundStats,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import UnboundActiveAlert from "../shared/UnboundActiveAlert";

// AIPROOT 管理 → LINE 綁定 audit
// 依 employee-line-binding v1.0.1 §7-quinque + §6.9 nudge
export default function BindingAudit() {
  const toast = useToast();
  const [tenants, setTenants] = useState<AiprootTenantOption[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [bindings, setBindings] = useState<BindingAuditRow[]>([]);
  const [unboundStats, setUnboundStats] = useState<UnboundStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<BindingAuditRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BindingAuditRow | null>(null);

  useEffect(() => {
    listAiprootTenants().then((r) => {
      setTenants(r.tenants);
      if (r.tenants[0]) setSelectedTenantId(r.tenants[0].tenantId);
    }).catch(() => undefined);
    void refreshUnbound();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedTenantId) void refresh();
  }, [selectedTenantId]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function refresh() {
    setLoading(true);
    try {
      const res = await listBindingAudit(selectedTenantId);
      setBindings(res.bindings);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }

  async function refreshUnbound() {
    try {
      const res = await getUnboundStats();
      setUnboundStats(res.stats);
    } catch {
      // 靜默
    }
  }

  async function doRevoke() {
    if (!confirmRevoke) return;
    setBusy(true);
    try {
      await revokeBindingAiproot(confirmRevoke.bindingId);
      toast.show(`已撤銷 ${confirmRevoke.userDisplayName ?? "綁定"}`, "ok");
      setConfirmRevoke(null);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "撤銷失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await deleteBindingAiproot(confirmDelete.bindingId);
      toast.show(`已刪除 ${confirmDelete.userDisplayName ?? "紀錄"}`, "ok");
      setConfirmDelete(null);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "刪除失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  const selectedTenantUnbound = useMemo(
    () => unboundStats.find((s) => s.tenantId === selectedTenantId),
    [unboundStats, selectedTenantId],
  );

  return (
    <div className="pane">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>LINE 綁定稽核</h1>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
            方向 8 · LIFF Zero-Config · 員工在 LINE 內完成綁定
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>租戶</span>
          <Select
            className="llm-select"
            selectedKey={selectedTenantId}
            onSelectionChange={(k) => setSelectedTenantId(String(k))}
            aria-label="租戶"
            isDisabled={loading || busy || tenants.length === 0}
          >
            <AriaButton className="llm-select-btn" style={{ minWidth: 220 }}>
              <SelectValue className="llm-select-value">
                {() => tenants.find((t) => t.tenantId === selectedTenantId)?.tenantName ?? "選擇租戶"}
              </SelectValue>
              <svg className="llm-select-chev" width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden>
                <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </AriaButton>
            <Popover className="llm-select-pop" offset={4}>
              <ListBox className="llm-select-list" items={tenants.map((t) => ({ id: t.tenantId, name: t.tenantName }))}>
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
          <button className="btn" onClick={() => { void refresh(); void refreshUnbound(); }} disabled={loading || busy}>重新整理</button>
        </div>
      </div>

      {/* 未綁定活躍者 · 折疊清單 */}
      {selectedTenantUnbound && (
        <UnboundActiveAlert unboundCount={selectedTenantUnbound.unboundCount} top={selectedTenantUnbound.top} />
      )}

      {loading ? (
        <Spinner block />
      ) : bindings.length === 0 ? (
        <div className="dm-empty">
          尚無綁定紀錄
          <div className="dm-empty-hint">員工加 LINE 官方帳號好友並完成綁定後 · 這裡會列出</div>
        </div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>Email</th>
                <th>LINE UserId</th>
                <th>綁定方式</th>
                <th>綁定時間</th>
                <th>狀態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((b) => (
                <tr key={b.bindingId}>
                  <td className="dm-td-name">{b.userDisplayName ?? "（未知）"}</td>
                  <td className="mono">{b.userEmail ?? "—"}</td>
                  <td className="mono" title={b.lineUserId}>{b.lineUserId.slice(0, 12)}…</td>
                  <td className="mono" style={{ fontSize: 11 }}>{b.bindingMethod}</td>
                  <td className="mono">{new Date(b.boundAt).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>
                    {b.status === "active"
                      ? <span style={{ color: "var(--ok-600)", fontWeight: 500 }}>● 有效</span>
                      : <span style={{ color: "var(--ink-3)" }}>○ 已撤銷</span>}
                  </td>
                  <td>
                    {b.status === "active"
                      ? <button className="btn small" onClick={() => setConfirmRevoke(b)} disabled={busy}>撤銷</button>
                      : <button className="btn small" onClick={() => setConfirmDelete(b)} disabled={busy}>刪除</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmRevoke}
        onClose={() => !busy && setConfirmRevoke(null)}
        onConfirm={() => void doRevoke()}
        busy={busy}
        title="撤銷 LINE 綁定"
        body={confirmRevoke && (
          <>
            即將撤銷 <b>{confirmRevoke.userDisplayName ?? "此員工"}</b> 的 LINE 綁定<br />
            LINE UserId · <code className="mono">{confirmRevoke.lineUserId}</code><br /><br />
            撤銷後該員工需重新走 LIFF 綁定流程才能恢復功能。
          </>
        )}
        confirmLabel="撤銷"
        tone="danger"
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => !busy && setConfirmDelete(null)}
        onConfirm={() => void doDelete()}
        busy={busy}
        title="刪除綁定紀錄"
        body={confirmDelete && (
          <>
            即將刪除 <b>{confirmDelete.userDisplayName ?? "此員工"}</b> 的已撤銷綁定紀錄<br />
            LINE UserId · <code className="mono">{confirmDelete.lineUserId}</code><br /><br />
            這只是把這一列從清單移除，<b>不影響該員工重新綁定</b>；
            誰在何時撤銷的紀錄仍留在稽核記錄裡。
          </>
        )}
        confirmLabel="刪除"
        tone="danger"
      />
    </div>
  );
}
