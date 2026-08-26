import Spinner from "../shared/Spinner";
import { useCallback, useEffect, useState } from "react";
import { ApiError, listAudit, type AuditItem, type AuditScope } from "../api";
import { useToast } from "../Toast";
import { t } from "../i18n";
import { useT } from "../i18n/useT";

// 稽核記錄 · 讀真實的 audit_log
//
// 這頁到 2026-07-28 為止顯示的是編造的稽核事件，連 IP 和對象都是假的。
// 合規性質的頁面顯示編造的紀錄，比顯示「尚無資料」危險得多。
//
// 真實資料沒有 IP、沒有對象、沒有部門（那三欄從來沒被寫入），所以這裡就不放這三欄——
// 擺著空欄位只會讓人以為是資料掉了。

const SCOPES: { id: AuditScope; labelKey: string; hintKey: string }[] = [
  { id: "all", labelKey: "audit.all", hintKey: "audit.allHint" },
  { id: "write", labelKey: "audit.write", hintKey: "audit.writeHint" },
  { id: "login", labelKey: "audit.login", hintKey: "audit.loginHint" },
];

function fmtTs(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function AuditLog() {
  const tr = useT();
  const toast = useToast();
  const [scope, setScope] = useState<AuditScope>("write");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AuditItem[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAudit(scope, page);
      setItems(res.items);
      setHasNext(res.hasNext);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : tr("common.loadFailed"), "danger");
    } finally {
      setLoading(false);
    }
  }, [scope, page, toast]);
  useEffect(() => { void load(); }, [load]);

  const current = SCOPES.find((s) => s.id === scope)!;

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>{tr("nav.audit")}</h1>
          <div className="sub">{tr("audit.sub")} · {tr(current.hintKey)}</div>
        </div>
      </div>

      <div className="al-toolbar">
        <div className="al-actions">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              className={`al-action-chip${scope === s.id ? " active" : ""}`}
              onClick={() => { setScope(s.id); setPage(1); }}
              disabled={loading}
            >
              {tr(s.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <Spinner block />
      ) : items.length === 0 ? (
        <div className="dm-empty">
          {tr("audit.empty")}
          <div className="dm-empty-hint">{tr("audit.emptyHint")}</div>
        </div>
      ) : (
        <>
          <div className="al-table-wrap">
            <table className="al-table">
              <thead>
                <tr>
                  <th>{tr("audit.time")}</th>
                  <th>{tr("audit.user")}</th>
                  <th>{tr("col.role")}</th>
                  <th>{tr("audit.action")}</th>
                  <th>{tr("audit.result")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="mono al-td-ts">{fmtTs(e.at)}</td>
                    <td>{e.actorName ?? "—"}</td>
                    <td className="al-td-role">{e.actorRole ?? "—"}</td>
                    <td className="al-td-target">
                      <span className="tag" style={e.isWrite
                        ? { borderColor: "var(--primary)", color: "var(--primary-2)" }
                        : { borderColor: "var(--ink-3)", color: "var(--ink-2)" }}>
                        {e.action}
                      </span>
                    </td>
                    <td><span className={`tag ${e.result === "成功" ? "ok" : "warn"}`}>{tr(`audit.res.${e.result}`)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-pager">
            <button className="btn" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>{tr("common.prevPage")}</button>
            <span className="ml-pager-at mono">{tr("common.pageN", { n: page })}</span>
            <button className="btn" disabled={!hasNext || loading} onClick={() => setPage((p) => p + 1)}>{tr("common.nextPage")}</button>
          </div>
        </>
      )}
    </>
  );
}
