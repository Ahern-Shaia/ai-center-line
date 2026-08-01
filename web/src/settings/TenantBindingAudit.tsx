import Spinner from "../shared/Spinner";
import { useEffect, useState } from "react";
import {
  ApiError,
  listTenantBindingAudit,
  revokeBindingTenant,
  getTenantUnboundStats,
  type BindingAuditRow,
  type UnboundStats,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import UnboundActiveAlert from "../shared/UnboundActiveAlert";

// 設定 → 員工 LINE 綁定（tenant_admin 自租戶自治版）
// aiproot 版在 aiproot-console/BindingAudit.tsx（跨租戶 · 有租戶下拉）
// 這裡租戶固定為登入者所屬 · backend 自 JWT 取 · 前端不傳 tenantId
export default function TenantBindingAudit() {
  const toast = useToast();
  const [bindings, setBindings] = useState<BindingAuditRow[]>([]);
  const [unbound, setUnbound] = useState<UnboundStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<BindingAuditRow | null>(null);

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
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
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
      toast.show(`已撤銷 ${confirmRevoke.userDisplayName ?? "綁定"}`, "ok");
      setConfirmRevoke(null);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "撤銷失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pane">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>員工 LINE 綁定</h1>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
            管理貴公司員工的 LINE 綁定 · 員工在 LINE 內完成綁定後於此列出
          </div>
        </div>
        <button className="btn" onClick={() => { void refresh(); void refreshUnbound(); }} disabled={loading || busy}>重新整理</button>
      </div>

      {/* 未綁定活躍者 · 折疊清單 */}
      {unbound && <UnboundActiveAlert unboundCount={unbound.unboundCount} top={unbound.top} />}

      {loading ? (
        <Spinner block />
      ) : bindings.length === 0 ? (
        <div className="dm-empty">
          尚無綁定紀錄
          <div className="dm-empty-hint">員工加公司 LINE 官方帳號好友並完成綁定後 · 這裡會列出</div>
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
                    {b.status === "active" && (
                      <button className="btn small" onClick={() => setConfirmRevoke(b)} disabled={busy}>撤銷</button>
                    )}
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
    </div>
  );
}
