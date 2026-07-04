import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, confirmSignoff, getPending, getWarroom, type PendingTicket, type Warroom } from "./api";
import { useToast } from "./Toast";

const HEALTH_LABEL: Record<string, string> = { green: "正常", yellow: "待確認", red: "逾時" };
const HEALTH_PILL: Record<string, string> = { green: "ok", yellow: "warn", red: "danger" };

interface Props {
  onRegister: (fns: { refresh: () => Promise<void>; asOf: () => string | undefined }) => void;
  onLoadingChange?: (loading: boolean) => void;
}

export default function WarRoom({ onRegister, onLoadingChange }: Props) {
  const [wr, setWr] = useState<Warroom | null>(null);
  const [pending, setPending] = useState<PendingTicket[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    onLoadingChange?.(true);
    try {
      const [w, p] = await Promise.all([getWarroom(), getPending()]);
      setWr(w);
      setPending(p.pending);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "資料載入失敗");
    } finally {
      setLoading(false);
      onLoadingChange?.(false);
    }
  }, [onLoadingChange]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    onRegister({ refresh, asOf: () => wr?.as_of });
  }, [onRegister, refresh, wr]);

  const pendingByDept = useMemo(() => {
    const m = new Map<string, PendingTicket[]>();
    for (const t of pending) {
      const arr = m.get(t.departmentId) ?? [];
      arr.push(t);
      m.set(t.departmentId, arr);
    }
    return m;
  }, [pending]);

  async function confirmDept(deptId: string, deptName: string) {
    const ids = (pendingByDept.get(deptId) ?? []).map((t) => t.ticketId);
    if (!ids.length) return;
    setConfirming(deptId);
    try {
      const r = await confirmSignoff(ids);
      await refresh();
      const parts: string[] = [];
      if (r.confirmed.length) parts.push(`已簽核 ${r.confirmed.length} 筆`);
      if (r.blocked.length) parts.push(`${r.blocked.length} 筆低信心攔截`);
      toast.show(`${deptName}：${parts.join("，")}`, r.blocked.length ? "warn" : "ok");
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
        目前顯示為 <b>demo 資料</b>（seed 灌入）· 尚未接真 LINE ingest / Ragic 匯流
      </div>

      <div className="tiles">
        <Tile
          label="本日簽核完成率"
          num={pct(wr.signoff_rate)}
          frac={`${wr.signed_depts} / ${wr.dept_count} 部門`}
          color="var(--primary)"
          rate={wr.signoff_rate}
        />
        <Tile
          label="群組整體健康度"
          num={pct(wr.health_rate)}
          frac={`${wr.green_depts} / ${wr.dept_count} 綠燈`}
          color="var(--ok)"
          rate={wr.health_rate}
        />
        <Tile
          label="今日 AI 高信心比例"
          num={pct(wr.high_conf_ratio)}
          frac={`${wr.high_num} / ${wr.high_den} tickets`}
          color="var(--warn)"
          rate={wr.high_conf_ratio}
        />
      </div>

      <div className="section">
        <h2>各部門今日狀態</h2>
        <span className="hint">點擊列展開明細（尚未實作）· 群數由租戶配置</span>
      </div>

      <div className="dept-list" role="table">
        <div className="dept-list-hdr" role="row">
          <span />
          <span>部門</span>
          <span>今日進線</span>
          <span>AI 高信心</span>
          <span>簽核狀態</span>
        </div>
        {wr.groups.map((g) => {
          const p = pendingByDept.get(g.department_id) ?? [];
          const low = p.filter((t) => t.needsReview).length;
          const isConfirming = confirming === g.department_id;
          return (
            <button
              key={g.department_id}
              className="dept-row"
              role="row"
              onClick={() => toast.show(`${g.name} 詳細頁尚未實作`, "warn")}
            >
              <span className={`lamp ${g.health}`} aria-label={HEALTH_LABEL[g.health]} />
              <span className="name">{g.name}</span>
              <span className="meta">{g.today_total} 筆</span>
              <span className="meta">{g.high_count} / {g.today_total} 高</span>
              <span className="signed" onClick={(e) => e.stopPropagation()}>
                {g.signed_off ? (
                  <span className="pill ok">✓ 已簽核</span>
                ) : p.length === 0 ? (
                  <span className="pill muted">無待簽</span>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={isConfirming}
                    onClick={() => confirmDept(g.department_id, g.name)}
                  >
                    {isConfirming ? "簽核中…" : low ? `簽核 ${p.length}（${low} 低信心）` : `簽核 ${p.length} 筆`}
                  </button>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function pct(r: number) {
  return Math.round(r * 100);
}

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
      <div className="tiles">
        <div className="sk sk-tile" /><div className="sk sk-tile" /><div className="sk sk-tile" />
      </div>
      <div className="section"><div className="sk" style={{ height: 16, width: 120 }} /></div>
      <div className="dept-list">
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
