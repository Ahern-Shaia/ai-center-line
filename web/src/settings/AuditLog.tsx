import Spinner from "../shared/Spinner";
import { useCallback, useEffect, useState } from "react";
import { ApiError, listAudit, type AuditItem, type AuditScope } from "../api";
import { useToast } from "../Toast";

// 稽核記錄 · 讀真實的 audit_log
//
// 這頁到 2026-07-28 為止顯示的是編造的稽核事件，連 IP 和對象都是假的。
// 合規性質的頁面顯示編造的紀錄，比顯示「尚無資料」危險得多。
//
// 真實資料沒有 IP、沒有對象、沒有部門（那三欄從來沒被寫入），所以這裡就不放這三欄——
// 擺著空欄位只會讓人以為是資料掉了。

const SCOPES: { id: AuditScope; label: string; hint: string }[] = [
  { id: "all", label: "全部", hint: "包含查看紀錄，筆數很多" },
  { id: "write", label: "只看變更", hint: "簽核、派發、修改設定等會改到資料的操作" },
  { id: "login", label: "只看登入", hint: "誰在什麼時候登入" },
];

function fmtTs(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function AuditLog() {
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
      toast.show(e instanceof ApiError ? e.message : "載入失敗", "danger");
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
          <h1>稽核記錄</h1>
          <div className="sub">系統自動記錄每一次操作 · 依時間倒序 · {current.hint}</div>
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
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <Spinner block />
      ) : items.length === 0 ? (
        <div className="dm-empty">
          這個範圍還沒有紀錄
          <div className="dm-empty-hint">換一個範圍看看，或稍後再回來</div>
        </div>
      ) : (
        <>
          <div className="al-table-wrap">
            <table className="al-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>使用者</th>
                  <th>角色</th>
                  <th>動作</th>
                  <th>結果</th>
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
                    <td><span className={`tag ${e.result === "成功" ? "ok" : "warn"}`}>{e.result}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-pager">
            <button className="btn" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>上一頁</button>
            <span className="ml-pager-at mono">第 {page} 頁</span>
            <button className="btn" disabled={!hasNext || loading} onClick={() => setPage((p) => p + 1)}>下一頁</button>
          </div>
        </>
      )}
    </>
  );
}
