import { useCallback, useEffect, useState } from "react";
import { ApiError, confirmSignoff, getWarroom, type Warroom, type WarroomGroup, type WarroomTicket } from "../api";
import { useToast } from "../Toast";
import { bcp47, t} from "../i18n";
import { useT } from "../i18n/useT";
import SourceDrawer from "./SourceDrawer";
import { InfoTip } from "../shared/InfoTip";
import Gauge from "../shared/Gauge";
import { usePageGuide } from "../shared/usePageGuide";

interface Props {
  onRegister: (fns: { refresh: () => Promise<void>; asOf: () => string | undefined }) => void;
  onLoadingChange?: (loading: boolean) => void;
}

interface SourceOpen { ticketId: string; summary: string; confidence: WarroomTicket["confidence"]; needsReview: boolean }

export default function WarRoom({ onRegister, onLoadingChange }: Props) {
  const guide = usePageGuide("warroom");
  const [wr, setWr] = useState<Warroom | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["auto-expand-lowconf"]));  // placeholder；下面初次載入時自動展開有低信心的
  const [confirming, setConfirming] = useState<string | null>(null);
  const [source, setSource] = useState<SourceOpen | null>(null);
  const toast = useToast();
  const tr = useT();

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
      setErr(e instanceof ApiError ? e.message : t("wr.loadFailed"));
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
      toast.show(t("wr.nothingVerifiable", { name: g.name, n: pending.length }), "warn");
      return;
    }
    setConfirming(g.department_id);
    try {
      const r = await confirmSignoff(confirmable.map((t) => t.ticket_id));
      const parts: string[] = [];
      if (r.confirmed.length) parts.push(t("wr.verifiedN", { n: r.confirmed.length }));
      if (pending.length - confirmable.length > 0) parts.push(t("wr.heldN", { n: pending.length - confirmable.length }));
      toast.show(`${g.name}：${parts.join("，")}`, r.blocked.length ? "warn" : "ok");
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : t("wr.verifyFailed"), "danger");
    } finally {
      setConfirming(null);
    }
  }

  // ⚠️ 這裡原本有三個 tab（總覽儀表／任務看板／今日日誌）。
  // 任務看板是我們整天在做的核心產出，卻要先點「總覽儀表」再點 tab 才到得了，
  // 而次要的「素材看板」有一級入口 —— 導覽上找不到自己的主產品。
  // 2026-07-29（M3）三者都升成一級入口，tab 全數移除（OQ-NAV-3：不保留，
  // tab 與側欄同時存在會讓人不知道該從哪進去）。

  // Dashboard tab
  if (loading && !wr) return <WarRoomSkeleton />;
  if (err && !wr) {
    return (
      <div className="state">
        <h3>{tr("wr.loadFailedTitle")}</h3>
        <p>{err}</p>
        <button className="btn btn-ghost" onClick={refresh}>{tr("common.retry")}</button>
      </div>
    );
  }
  if (!wr) return null;

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>{tr("nav.warroom")}{guide.toggle}</h1>
          {/* ⚠️ 這個數字是 **departments 的筆數**（warroom.service.ts 的 N = depts.length），
              不是 LINE 群組數。本產品一個部門綁一個群，數字碰巧一樣，
              但名詞混用會讓客戶在「部門/成員」頁對不上帳。 */}
          <div className="sub">{tr("wr.sub", { n: wr.dept_count })}</div>
        </div>
      </div>
      {guide.panel}

      <div className="tiles">
        {/* ⚠️ 三個環的分母不同（部門 / 部門 / 已標記筆數），
            前兩個都是「部門」、第三個是「已標記的筆數」。
            不把單位寫完整的話，看的人會以為三個數字可以互相比較。 */}
        <Gauge value={wr.signoff_rate} label={tr("wr.signoffRate")}
               frac={tr("wr.fracDeptSigned", { n: wr.signed_depts, total: wr.dept_count })} color="#4F46E5" />
        <Gauge value={wr.health_rate} label={tr("wr.health")}
               frac={tr("wr.fracDeptGreen", { n: wr.green_depts, total: wr.dept_count })} color="#059669" />
        <Gauge value={wr.high_conf_ratio} label={tr("wr.highConf")}
               frac={tr("wr.fracTagged", { n: wr.high_num, total: wr.high_den })} color="#D97706" />
      </div>

      <div className="section">
        <h2>{tr("wr.dailySignoff")}</h2>
        <span className="hint">{tr("wr.dailySignoffHint")}</span>
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
  const tr = useT();
  const pending = g.today_tickets.filter((t) => t.status === "待簽核");
  const lowCount = pending.filter((t) => t.needs_review).length;
  const confirmable = pending.length - lowCount;
  const signedAt = g.signed_at
    ? new Date(g.signed_at).toLocaleTimeString(bcp47(), { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;

  // P2 · 有待辦的列要跳得出來 —— 原本它跟「今日無待簽」只差一個小數字，
  // 主管掃過去分不出哪幾列才需要他處理
  const stateClass = (pending.length > 0 && !g.signed_off ? "so-actionable " : "") + (g.signed_off
    ? "st-signed"
    : g.health === "green" ? "st-green"
    : g.health === "yellow" ? "st-yellow"
    : g.health === "red" ? "st-red"
    : "");

  return (
    <div className={`so-item ${stateClass}`}>
      <div className="so-head">
        <button className="so-toggle" onClick={onToggle} aria-expanded={expanded}>
          <span className="so-name">{g.name}</span>
          <span className="so-status">
            {g.signed_off ? (
              <>
                <span className="signer">{tr("wr.signedBy")}</span>
                <span className="signer-name">{g.signed_by_name ?? "—"}</span>
                <span className="mono">{signedAt}</span>
                <span className="signer">{tr("wr.verified")}</span>
              </>
            ) : pending.length === 0 ? (
              <span style={{ color: "var(--ink-3)" }}>{tr("wr.noneToday")}</span>
            ) : (
              <>
                <span className="num">{pending.length}</span>
                <span>{tr("wr.toVerify")}</span>
                {lowCount > 0 && (
                  <>
                    <span style={{ color: "var(--ink-3)" }}>·</span>
                    <span className="danger">{tr("wr.lowConfHeld", { n: lowCount })}</span>
                  </>
                )}
              </>
            )}
          </span>
          <span className="so-chev" aria-hidden>{expanded ? tr("common.collapse") : tr("common.expand")}</span>
        </button>
        {/* ⚠️ 沒事可做的列**不掛主要按鈕**。
            原本 disabled 仍是紫色實心，於是整頁視覺重量最高的
            是一整欄長得一樣、而且過半沒事可做的按鈕 ——
            使用者得先讀完文字才知道這顆不用按，那就是多一次判斷。 */}
        {g.signed_off ? (
          <button className="btn confirmed-tag" disabled>{tr("wr.done")}</button>
        ) : pending.length === 0 ? (
          <span className="so-noop">—</span>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={(e) => { e.stopPropagation(); onConfirm(); }}
            disabled={confirming}
          >
            {confirming ? tr("wr.verifying") : tr("wr.confirmN", { n: pending.length })}
          </button>
        )}
      </div>

      {expanded && (
        <div className="so-detail">
          {g.today_tickets.length === 0 && (
            <div className="so-empty">
              {tr("wr.emptyToday")}
              <div className="so-empty-hint">{tr("wr.emptyTodayHint")}</div>
            </div>
          )}
          {g.today_tickets.map((t) => {
            const conf = t.confidence ?? "medium";
            const isSigned = t.status === "已簽核";
            const tagText = isSigned ? tr("wr.tagConfirmed") : t.needs_review ? tr("wr.tagHeld") : tr(`wr.conf.${conf}`);
            const tagClass = isSigned ? "ok" : t.needs_review ? "danger" : conf === "high" ? "ok" : "warn";
            // 說明用固定文案 · 不再依賴示範資料（原本讀 mockdata 的內容真實環境是空的）
            const tipContent = isSigned ? tr("wr.tipConfirmed")
              : t.needs_review ? tr("wr.tipHeld") : tr(`wr.tip.${conf}`);
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
                <button className="so-source" onClick={() => onSource(t)}>{tr("wr.viewSource")}</button>
              </div>
            );
          })}
          <div className="so-detail-foot">
            <span>{tr("wr.footNote")}</span>
            {!g.signed_off && confirmable > 0 && (
              <span>{tr("wr.footCounts", { ok: confirmable, low: lowCount })}</span>
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

