import Spinner from "../shared/Spinner";
import { useEffect, useState } from "react";
import {
  ApiError,
  listTenantBindingAudit,
  revokeBindingTenant,
  deleteBindingTenant,
  getTenantUnboundStats,
  type BindingAuditRow,
  type UnboundStats,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import UnboundActiveAlert from "../shared/UnboundActiveAlert";
import { t } from "../i18n";
import { useT } from "../i18n/useT";

// 設定 → 員工 LINE 綁定（tenant_admin 自租戶自治版）
// aiproot 版在 aiproot-console/BindingAudit.tsx（跨租戶 · 有租戶下拉）
// 這裡租戶固定為登入者所屬 · backend 自 JWT 取 · 前端不傳 tenantId
export default function TenantBindingAudit() {
  const tr = useT();
  const toast = useToast();
  const [bindings, setBindings] = useState<BindingAuditRow[]>([]);
  const [unbound, setUnbound] = useState<UnboundStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<BindingAuditRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BindingAuditRow | null>(null);

  useEffect(() => {
    void refresh();
    void refreshUnbound();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await listTenantBindingAudit();
      setBindings(res.bindings);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("common.loadFailed"), "danger");
    } finally {
      setLoading(false);
    }
  }

  async function refreshUnbound() {
    try {
      const res = await getTenantUnboundStats();
      setUnbound(res.stats);
    } catch {
      // 靜默 · 未綁定提示非核心
    }
  }

  async function doRevoke() {
    if (!confirmRevoke) return;
    setBusy(true);
    try {
      await revokeBindingTenant(confirmRevoke.bindingId);
      toast.show(tr("tba.revoked", { who: confirmRevoke.userDisplayName ?? tr("tba.binding") }), "ok");
      setConfirmRevoke(null);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("tba.revokeFailed"), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await deleteBindingTenant(confirmDelete.bindingId);
      toast.show(tr("tba.deleted", { who: confirmDelete.userDisplayName ?? tr("tba.record") }), "ok");
      setConfirmDelete(null);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("tba.deleteFailed"), "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pane">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>{tr("tba.title")}</h1>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
            {tr("tba.sub")}
          </div>
        </div>
        <button className="btn" onClick={() => { void refresh(); void refreshUnbound(); }} disabled={loading || busy}>{tr("shell.refresh")}</button>
      </div>

      {/* 未綁定活躍者 · 折疊清單 */}
      {unbound && <UnboundActiveAlert unboundCount={unbound.unboundCount} top={unbound.top} />}

      {loading ? (
        <Spinner block />
      ) : bindings.length === 0 ? (
        <div className="dm-empty">
          {tr("tba.empty")}
          <div className="dm-empty-hint">{tr("tba.emptyHint")}</div>
        </div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th>{tr("tba.employee")}</th>
                <th>Email</th>
                <th>LINE UserId</th>
                <th>{tr("tba.method")}</th>
                <th>{tr("tba.boundAt")}</th>
                <th>{tr("kb.fldStatus")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((b) => (
                <tr key={b.bindingId}>
                  <td className="dm-td-name">{b.userDisplayName ?? tr("common.unknown")}</td>
                  <td className="mono">{b.userEmail ?? "—"}</td>
                  <td className="mono" title={b.lineUserId}>{b.lineUserId.slice(0, 12)}…</td>
                  <td className="mono" style={{ fontSize: 11 }}>{b.bindingMethod}</td>
                  <td className="mono">{new Date(b.boundAt).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>
                    {b.status === "active"
                      ? <span style={{ color: "var(--ok-600)", fontWeight: 500 }}>● {tr("tba.active")}</span>
                      : <span style={{ color: "var(--ink-3)" }}>○ {tr("tba.revokedTag")}</span>}
                  </td>
                  <td>
                    {b.status === "active"
                      ? <button className="btn small" onClick={() => setConfirmRevoke(b)} disabled={busy}>{tr("tba.revoke")}</button>
                      : <button className="btn small" onClick={() => setConfirmDelete(b)} disabled={busy}>{tr("common.delete")}</button>}
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
        title={tr("tba.revokeTitle")}
        body={confirmRevoke && (
          <>
            {tr("tba.revokeBody1a")}<b>{confirmRevoke.userDisplayName ?? tr("tba.thisEmployee")}</b>{tr("tba.revokeBody1b")}<br />
            LINE UserId · <code className="mono">{confirmRevoke.lineUserId}</code><br /><br />
            {tr("tba.revokeBody2")}
          </>
        )}
        confirmLabel={tr("tba.revoke")}
        tone="danger"
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => !busy && setConfirmDelete(null)}
        onConfirm={() => void doDelete()}
        busy={busy}
        title={tr("tba.deleteTitle")}
        body={confirmDelete && (
          <>
            {tr("tba.deleteBody1a")}<b>{confirmDelete.userDisplayName ?? tr("tba.thisEmployee")}</b>{tr("tba.deleteBody1b")}<br />
            LINE UserId · <code className="mono">{confirmDelete.lineUserId}</code><br /><br />
            {tr("tba.deleteBody2a")}<b>{tr("tba.deleteBody2b")}</b>；
            {tr("tba.deleteBody3")}
          </>
        )}
        confirmLabel={tr("common.delete")}
        tone="danger"
      />
    </div>
  );
}
