import { useMemo, useState } from "react";
import { AUDIT_LOG, type AuditAction } from "./mockdata/auditLog";

const ACTION_OPTIONS: (AuditAction | "all")[] = ["all", "登入", "查看", "簽核", "駁回", "代簽核", "檢索", "匯出", "變更設定"];
const ACTION_LABEL: Record<string, string> = { all: "全部動作" };

function fmtTs(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

function outcomeTag(o: string): string {
  if (o === "成功") return "ok";
  if (o === "已攔截") return "warn";
  return "danger";
}

export default function AuditLog() {
  const [action, setAction] = useState<AuditAction | "all">("all");
  const [actor, setActor] = useState<string>("");
  const [q, setQ] = useState("");

  const actors = useMemo(() => Array.from(new Set(AUDIT_LOG.map((e) => e.actor))).sort(), []);

  const list = useMemo(() => {
    return AUDIT_LOG.filter((e) => {
      if (action !== "all" && e.action !== action) return false;
      if (actor && e.actor !== actor) return false;
      if (q.trim() && !e.target.includes(q.trim())) return false;
      return true;
    });
  }, [action, actor, q]);

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>稽核記錄</h1>
          <div className="sub">所有帳號的登入、查看、簽核、檢索、匯出、變更設定行為 · 保留 3 年 · 支援 SOC 2 / ISO 27001 稽核</div>
        </div>
      </div>

      <div className="al-toolbar">
        <input
          className="al-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋對象，例如：WO-2506 / T-030 / STARIA"
          aria-label="搜尋對象"
        />
        <select className="al-select" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="使用者篩選">
          <option value="">全部使用者</option>
          {actors.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="al-actions">
          {ACTION_OPTIONS.map((a) => (
            <button
              key={a}
              className={`al-action-chip${action === a ? " active" : ""}`}
              onClick={() => setAction(a)}
            >
              {a === "all" ? "全部" : a}
            </button>
          ))}
        </div>
      </div>

      <div className="al-count mono">共 {list.length} 筆 · 依時間倒序</div>

      <div className="al-table-wrap">
        <table className="al-table">
          <thead>
            <tr>
              <th>時間</th>
              <th>使用者</th>
              <th>角色</th>
              <th>動作</th>
              <th>對象</th>
              <th>部門</th>
              <th>結果</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td className="mono al-td-ts">{fmtTs(e.ts)}</td>
                <td>{e.actor}</td>
                <td className="al-td-role">{e.actorRole}</td>
                <td><span className="tag ok" style={{ borderColor: "var(--ink-3)", color: "var(--ink-2)" }}>{e.action}</span></td>
                <td className="al-td-target">{e.target}</td>
                <td className="al-td-dept">{e.targetDept ?? "—"}</td>
                <td><span className={`tag ${outcomeTag(e.outcome)}`}>{e.outcome}</span></td>
                <td className="mono al-td-ip">{e.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {list.length === 0 && (
        <div className="state" style={{ marginTop: 16 }}>
          <h3>找不到符合的稽核事件</h3>
          <p>試試調整動作類型或使用者篩選</p>
        </div>
      )}
    </>
  );
}
