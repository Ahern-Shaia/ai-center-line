import { useCallback, useEffect, useState } from "react";
import { ApiError, confirmSignoff, getWarroom, type Warroom, type WarroomGroup, type WarroomTicket } from "./api";
import { useToast } from "./Toast";
import SourceDrawer from "./SourceDrawer";

interface Props {
  onRegister: (fns: { refresh: () => Promise<void>; asOf: () => string | undefined }) => void;
  onLoadingChange?: (loading: boolean) => void;
}

interface SourceOpen { summary: string; confidence: WarroomTicket["confidence"]; needsReview: boolean }

export default function WarRoom({ onRegister, onLoadingChange }: Props) {
  const [wr, setWr] = useState<Warroom | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["auto-expand-lowconf"]));  // placeholder；下面初次載入時自動展開有低信心的
  const [confirming, setConfirming] = useState<string | null>(null);
  const [source, setSource] = useState<SourceOpen | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    onLoadingChange?.(true);
    try {
      const w = await getWarroom();
      setWr(w);
      // 初次載入自動展開「有低信心待簽」的部門，方便總經理注意
      setExpanded((prev) => {
        if (!prev.has("auto-expand-lowconf")) return prev;  // 已消化過
        const next = new Set<string>();
        w.groups.forEach((g) => { if (g.has_low_pending) next.add(g.department_id); });
        return next;
      });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "資料載入失敗");
    } finally {
      setLoading(false);
      onLoadingChange?.(false);
    }
  }, [onLoadingChange]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    onRegister({ refresh, asOf: () => wr?.as_of });
  }, [onRegister, refresh, wr]);

  const toggleExpand = (deptId: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      next.delete("auto-expand-lowconf");
      if (next.has(deptId)) next.delete(deptId); else next.add(deptId);
      return next;
    });
  };

  async function confirmDept(g: WarroomGroup) {
    const pending = g.today_tickets.filter((t) => t.status === "待簽核");
    const confirmable = pending.filter((t) => !t.needs_review);
    if (!confirmable.length) {
      toast.show(`${g.name}：無可簽核（${pending.length} 筆全為低信心攔截）`, "warn");
      return;
    }
    setConfirming(g.department_id);
    try {
      const r = await confirmSignoff(confirmable.map((t) => t.ticket_id));
      const parts: string[] = [];
      if (r.confirmed.length) parts.push(`已簽核 ${r.confirmed.length} 筆`);
      if (pending.length - confirmable.length > 0) parts.push(`${pending.length - confirmable.length} 筆低信心攔截`);
      toast.show(`${g.name}：${parts.join("，")}`, r.blocked.length ? "warn" : "ok");
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "簽核失敗", "danger");
    } finally {
      setConfirming(null);
    }
  }

  if (loading && !wr) return <WarRoomSkeleton />;
  if (err && !wr) {
    return (
      <div className="state">
        <h3>無法載入戰情室資料</h3>
        <p>{err}</p>
        <button className="btn btn-ghost" onClick={refresh}>重試</button>
      </div>
    );
  }
  if (!wr) return null;

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>總覽儀表</h1>
          <div className="sub">全 {wr.dept_count} 個 LINE 群組 · 每日 AI 分類結果匯總</div>
        </div>
      </div>

      <div className="banner" role="status">
        <IconInfo />
        <span>本 demo 使用<b>假名化案例</b>展示端到端流程。正式版所有真實 LINE 訊息在您廠內去識別，敏感資料不出場。</span>
      </div>

      <div className="tiles">
        <Tile label="本日簽核完成率" num={pct(wr.signoff_rate)} frac={`${wr.signed_depts} / ${wr.dept_count} 部門`} color="var(--primary)" rate={wr.signoff_rate} />
        <Tile label="群組整體健康度" num={pct(wr.health_rate)} frac={`${wr.green_depts} / ${wr.dept_count} 綠燈`} color="var(--ok)" rate={wr.health_rate} />
        <Tile label="今日 AI 高信心比例" num={pct(wr.high_conf_ratio)} frac={`${wr.high_num} / ${wr.high_den} tickets`} color="var(--warn)" rate={wr.high_conf_ratio} />
      </div>

      <div className="section">
        <h2>負責人每日最終確認 · 防呆機制</h2>
        <span className="hint">簽核後才同步 Ragic · 低信心自動攔截</span>
      </div>

      <div className="signoff-list">
        {wr.groups.map((g) => (
          <DeptItem
            key={g.department_id}
            g={g}
            expanded={expanded.has(g.department_id)}
            onToggle={() => toggleExpand(g.department_id)}
            onConfirm={() => confirmDept(g)}
            confirming={confirming === g.department_id}
            onSource={(t) => setSource({ summary: t.summary, confidence: t.confidence, needsReview: t.needs_review })}
          />
        ))}
      </div>

      <SourceDrawer
        open={!!source}
        onClose={() => setSource(null)}
        summary={source?.summary ?? null}
        confidence={source?.confidence ?? null}
        needsReview={source?.needsReview ?? false}
      />
    </>
  );
}

function DeptItem({
  g, expanded, onToggle, onConfirm, confirming, onSource,
}: {
  g: WarroomGroup; expanded: boolean; onToggle: () => void; onConfirm: () => void; confirming: boolean; onSource: (t: WarroomTicket) => void;
}) {
  const pending = g.today_tickets.filter((t) => t.status === "待簽核");
  const lowCount = pending.filter((t) => t.needs_review).length;
  const confirmable = pending.length - lowCount;
  const signedAt = g.signed_at
    ? new Date(g.signed_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;

  return (
    <div className={`so-item${g.signed_off ? " done" : ""}${lowCount > 0 ? " has-low" : ""}`}>
      <div className="so-head">
        <button className="so-toggle" onClick={onToggle} aria-expanded={expanded}>
          <span className={`lamp ${g.health}`} aria-hidden />
          <span className="so-name">{g.name}</span>
          <span className={`so-count${lowCount > 0 ? " warn" : ""}${g.signed_off ? " done" : ""}`}>
            {g.signed_off
              ? `✓ 已由 ${g.signed_by_name ?? "未知"} 於 ${signedAt} 簽核`
              : pending.length === 0
                ? "今日無待簽核"
                : `${pending.length} 筆待簽核${lowCount > 0 ? `（${lowCount} 筆低信心）` : ""}`
            }
          </span>
          <span className="so-chev" aria-hidden>{expanded ? "▾" : "▸"}</span>
        </button>
        <button
          className={`btn ${g.signed_off ? "btn-ghost" : "btn-primary"} btn-sm`}
          onClick={(e) => { e.stopPropagation(); onConfirm(); }}
          disabled={g.signed_off || confirming || pending.length === 0}
        >
          {g.signed_off ? "已確認" : confirming ? "簽核中…" : "確認今日進度"}
        </button>
      </div>

      {expanded && (
        <div className="so-detail">
          {g.today_tickets.length === 0 && (
            <div className="so-empty">今日群組尚無 AI 產出</div>
          )}
          {g.today_tickets.map((t) => {
            const conf = t.confidence ?? "medium";
            const isSigned = t.status === "已簽核";
            return (
              <div key={t.ticket_id} className={`so-line${t.needs_review ? " blocked" : ""}${isSigned ? " signed" : ""}`}>
                <span className="so-dot">·</span>
                <span className="so-summary">{t.summary}</span>
                {isSigned ? (
                  <span className="pill ok" style={{ fontSize: 10 }}>✓ 已同步 Ragic</span>
                ) : t.needs_review ? (
                  <span className="pill danger" style={{ fontSize: 10 }}>🛑 低信心 · 已即時攔截</span>
                ) : (
                  <span className={`pill ${conf === "high" ? "ok" : "warn"}`} style={{ fontSize: 10 }}>
                    {conf === "high" ? "高信心" : "中信心"}
                  </span>
                )}
                <button className="so-source" onClick={() => onSource(t)}>查來源 →</button>
              </div>
            );
          })}
          <div className="so-detail-foot">
            <span className="mono">→ 對應 Ragic 表：<code>{g.ragic_table}</code></span>
            {!g.signed_off && confirmable > 0 && (
              <span>可簽核 <b>{confirmable}</b> 筆，低信心 <b>{lowCount}</b> 筆將被自動攔截</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function pct(r: number) { return Math.round(r * 100); }

function Tile({ label, num, frac, color, rate }: { label: string; num: number; frac: string; color: string; rate: number }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="metric">
        <span className="num tnum">{num}<span className="pct">%</span></span>
        <span className="frac">{frac}</span>
      </div>
      <div className="bar"><i style={{ width: `${Math.min(100, rate * 100)}%`, background: color }} /></div>
    </div>
  );
}

function WarRoomSkeleton() {
  return (
    <>
      <div className="pane-hdr">
        <div>
          <div className="sk" style={{ height: 24, width: 180, marginBottom: 8 }} />
          <div className="sk" style={{ height: 14, width: 260 }} />
        </div>
      </div>
      <div className="tiles"><div className="sk sk-tile" /><div className="sk sk-tile" /><div className="sk sk-tile" /></div>
      <div className="section"><div className="sk" style={{ height: 16, width: 120 }} /></div>
      <div className="signoff-list">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="sk sk-row" />)}
      </div>
    </>
  );
}

function IconInfo() {
  return (
    <svg className="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v5h1" />
    </svg>
  );
}
