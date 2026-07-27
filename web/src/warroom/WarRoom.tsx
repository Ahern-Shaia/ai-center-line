import { useCallback, useEffect, useState } from "react";
import { ApiError, confirmSignoff, getWarroom, type Warroom, type WarroomGroup, type WarroomTicket } from "../api";
import { useToast } from "../Toast";
import SourceDrawer from "./SourceDrawer";
import { InfoTip } from "../shared/InfoTip";
import Gauge from "../shared/Gauge";
import TaskBoard from "./TaskBoard";
import DailyLog from "./DailyLog";

interface Props {
  onRegister: (fns: { refresh: () => Promise<void>; asOf: () => string | undefined }) => void;
  onLoadingChange?: (loading: boolean) => void;
}

type Tab = "dashboard" | "tasks" | "daily";

interface SourceOpen { ticketId: string; summary: string; confidence: WarroomTicket["confidence"]; needsReview: boolean }

export default function WarRoom({ onRegister, onLoadingChange }: Props) {
  const [tab, setTab] = useState<Tab>("dashboard");
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

  const tabs = (
    <div className="wr-tabs" role="tablist">
      <button role="tab" aria-selected={tab === "dashboard"} className={`wr-tab${tab === "dashboard" ? " active" : ""}`} onClick={() => setTab("dashboard")}>總覽儀表</button>
      <button role="tab" aria-selected={tab === "tasks"} className={`wr-tab${tab === "tasks" ? " active" : ""}`} onClick={() => setTab("tasks")}>任務看板</button>
      <button role="tab" aria-selected={tab === "daily"} className={`wr-tab${tab === "daily" ? " active" : ""}`} onClick={() => setTab("daily")}>今日日誌</button>
    </div>
  );

  if (tab === "tasks") return <>{tabs}<TaskBoard /></>;
  if (tab === "daily") return <>{tabs}<DailyLog /></>;

  // Dashboard tab
  if (loading && !wr) return <>{tabs}<WarRoomSkeleton /></>;
  if (err && !wr) {
    return (
      <>{tabs}
      <div className="state">
        <h3>無法載入戰情室資料</h3>
        <p>{err}</p>
        <button className="btn btn-ghost" onClick={refresh}>重試</button>
      </div>
      </>
    );
  }
  if (!wr) return <>{tabs}</>;

  return (
    <>
      {tabs}
      <div className="pane-hdr">
        <div>
          <h1>總覽儀表</h1>
          <div className="sub">當前配置 {wr.dept_count} 個 LINE 群組 · 每日 AI 分類結果匯總（可於「部門/成員」自行新增）</div>
        </div>
      </div>

      <div className="tiles">
        <Gauge value={wr.signoff_rate} label="本日簽核率" frac={`${wr.signed_depts} / ${wr.dept_count} 部門`} color="#4F46E5" />
        <Gauge value={wr.health_rate} label="群組健康度" frac={`${wr.green_depts} / ${wr.dept_count} 綠燈`} color="#059669" />
        <Gauge value={wr.high_conf_ratio} label="AI 高信心比例" frac={`${wr.high_num} / ${wr.high_den} 筆`} color="#D97706" />
      </div>

      <div className="section">
        <h2>負責人每日最終確認</h2>
        <span className="hint">確認後才會正式列入紀錄 · 系統沒把握的內容會先攔下來</span>
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
            onSource={(t) => setSource({ ticketId: t.ticket_id, summary: t.summary, confidence: t.confidence, needsReview: t.needs_review })}
          />
        ))}
      </div>

      <SourceDrawer
        open={!!source}
        onClose={() => setSource(null)}
        ticketId={source?.ticketId ?? null}
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

  const stateClass = g.signed_off
    ? "st-signed"
    : g.health === "green" ? "st-green"
    : g.health === "yellow" ? "st-yellow"
    : g.health === "red" ? "st-red"
    : "";

  return (
    <div className={`so-item ${stateClass}`}>
      <div className="so-head">
        <button className="so-toggle" onClick={onToggle} aria-expanded={expanded}>
          <span className="so-name">{g.name}</span>
          <span className="so-status">
            {g.signed_off ? (
              <>
                <span className="signer">已由</span>
                <span className="signer-name">{g.signed_by_name ?? "—"}</span>
                <span className="mono">{signedAt}</span>
                <span className="signer">簽核</span>
              </>
            ) : pending.length === 0 ? (
              <span style={{ color: "var(--ink-3)" }}>今日無待簽</span>
            ) : (
              <>
                <span className="num">{pending.length}</span>
                <span>筆待簽</span>
                {lowCount > 0 && (
                  <>
                    <span style={{ color: "var(--ink-3)" }}>·</span>
                    <span className="danger">{lowCount} 筆低信心 · 已攔截</span>
                  </>
                )}
              </>
            )}
          </span>
          <span className="so-chev" aria-hidden>{expanded ? "收合" : "展開"}</span>
        </button>
        {g.signed_off ? (
          <button className="btn confirmed-tag" disabled>已簽核</button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={(e) => { e.stopPropagation(); onConfirm(); }}
            disabled={confirming || pending.length === 0}
          >
            {confirming ? "簽核中…" : "確認今日進度"}
          </button>
        )}
      </div>

      {expanded && (
        <div className="so-detail">
          {g.today_tickets.length === 0 && (
            <div className="so-empty">今日群組尚無 AI 產出</div>
          )}
          {g.today_tickets.map((t) => {
            const conf = t.confidence ?? "medium";
            const isSigned = t.status === "已簽核";
            const tagText = isSigned ? "已確認" : t.needs_review ? "低信心 · 已攔截" : conf === "high" ? "高信心" : conf === "medium" ? "中信心" : "低信心";
            const tagClass = isSigned ? "ok" : t.needs_review ? "danger" : conf === "high" ? "ok" : "warn";
            // 說明用固定文案 · 不再依賴示範資料（原本讀 mockdata 的內容真實環境是空的）
            const tipContent = isSigned ? "已確認 · 正式列入紀錄"
              : t.needs_review ? "系統對這筆沒把握，已先攔下 · 請點「查來源」核對原文"
              : conf === "high" ? "系統判斷欄位明確" : conf === "medium" ? "部分內容為推斷 · 建議核對原文" : "訊息不夠明確 · 請核對原文";
            return (
              <div key={t.ticket_id} className={`so-line${t.needs_review ? " blocked" : ""}${isSigned ? " signed" : ""}`}>
                <span className="so-box">□</span>
                <span className="so-summary">{t.summary}</span>
                {tipContent ? (
                  <InfoTip content={tipContent}>
                    <span className={`tag ${tagClass}`}>{tagText}</span>
                  </InfoTip>
                ) : (
                  <span className={`tag ${tagClass}`}>{tagText}</span>
                )}
                <button className="so-source" onClick={() => onSource(t)}>查來源 →</button>
              </div>
            );
          })}
          <div className="so-detail-foot">
            <span>確認後才會正式列入紀錄</span>
            {!g.signed_off && confirmable > 0 && (
              <span>可簽核 <b>{confirmable}</b> 筆，低信心 <b>{lowCount}</b> 筆將被自動攔截</span>
            )}
          </div>
        </div>
      )}
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

