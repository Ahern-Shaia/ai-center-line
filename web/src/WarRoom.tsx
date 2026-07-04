import { useCallback, useEffect, useState } from "react";
import { getWarroom, getPending, confirmSignoff, type Warroom, type PendingTicket } from "./api";

const CIRC = 2 * Math.PI * 50;
const pct = (r: number) => Math.round(r * 100);

function Gauge({ value, label, cap, color }: { value: number; label: string; cap: string; color: string }) {
  return (
    <div className="sheet gauge">
      <span className="rc tl" /><span className="rc tr" /><span className="rc bl" /><span className="rc br" />
      <div className="gauge-ring" role="img" aria-label={`${label} ${pct(value)}%`}>
        <svg viewBox="0 0 120 120">
          <circle className="g-track" cx="60" cy="60" r="50" />
          <circle className="g-fill" cx="60" cy="60" r="50" style={{ stroke: color, strokeDasharray: CIRC, strokeDashoffset: CIRC * (1 - value) }} />
        </svg>
        <div className="gauge-center">
          <div className="gauge-num">{pct(value)}<i>%</i></div>
          <div className="gauge-cap">{cap}</div>
        </div>
      </div>
      <div className="gauge-label">{label}</div>
    </div>
  );
}

const HEALTH_TEXT: Record<string, string> = { green: "正常", yellow: "待確認", red: "逾時" };

export default function WarRoom({ onLogout }: { onLogout: () => void }) {
  const [wr, setWr] = useState<Warroom | null>(null);
  const [pending, setPending] = useState<PendingTicket[]>([]);
  const [flash, setFlash] = useState<string>("");

  const refresh = useCallback(async () => {
    const [w, p] = await Promise.all([getWarroom(), getPending()]);
    setWr(w);
    setPending(p.pending);
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  async function confirmDept(deptId: string) {
    const ids = pending.filter((t) => t.departmentId === deptId).map((t) => t.ticketId);
    if (!ids.length) return;
    const r = await confirmSignoff(ids);
    await refresh();
    setFlash(
      r.blocked.length
        ? `已簽核 ${r.confirmed.length} 筆；${r.blocked.length} 筆低信心被攔截，須補件才可簽`
        : `已簽核 ${r.confirmed.length} 筆`,
    );
    setTimeout(() => setFlash(""), 4000);
  }

  if (!wr) return <div className="loading">載入中…</div>;

  const pendingByDept = (id: string) => pending.filter((t) => t.departmentId === id);

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <div className="brand-title">台灣福祉 AI 智慧管理戰情室</div>
          <div className="brand-sub">總經理室 · 全群組總覽（{wr.dept_count} 群）· Powered by AIPROOT</div>
        </div>
        <button className="btn-ghost" onClick={onLogout}>登出</button>
      </header>

      {flash && <div className="flash">{flash}</div>}

      <div className="sec"><span className="n">§01</span><span className="t">今日關鍵指標（÷{wr.dept_count} 動態）</span><span className="line" /></div>
      <div className="gauge-row">
        <Gauge value={wr.signoff_rate} label="本日簽核完成率" cap={`${wr.signed_depts}／${wr.dept_count} 群`} color="var(--blue)" />
        <Gauge value={wr.health_rate} label="群組整體健康度" cap={`${wr.green_depts}／${wr.dept_count} 綠燈`} color="var(--ok)" />
        <Gauge value={wr.high_conf_ratio} label="今日 AI 高信心比例" cap={`${wr.high_num}／${wr.high_den} 高信心`} color="var(--amber)" />
      </div>

      <div className="sec"><span className="n">§02</span><span className="t">各 LINE 群組即時狀態</span><span className="line" /><span className="note">{wr.dept_count} 群 · 客戶自行配置</span></div>
      <div className="group-row">
        {wr.groups.map((g) => (
          <div key={g.department_id} className="sheet group-card">
            <span className="rc tl" /><span className="rc br" />
            <div className="group-top">
              <span className="group-name">{g.name}</span>
              <span className={`g-stat ${g.health}`}><span className="gd" />{HEALTH_TEXT[g.health]}</span>
            </div>
            <div className="group-meta">今日 {g.today_total} 筆 · 高信心 {g.high_count}{g.has_low_pending ? " · 含低信心待補" : ""}</div>
            <div className="group-tbl">→ {g.ragic_table}</div>
          </div>
        ))}
      </div>

      <div className="sec"><span className="n">§03</span><span className="t">負責人每日最終確認 · 防呆機制</span><span className="line" /><span className="note">簽核後才同步 Ragic</span></div>
      <div className="sheet signoff">
        <span className="rc tl" /><span className="rc tr" /><span className="rc bl" /><span className="rc br" />
        {wr.groups.map((g) => {
          const p = pendingByDept(g.department_id);
          const low = p.filter((t) => t.needsReview).length;
          return (
            <div key={g.department_id} className={`signoff-item${low ? " lowconf" : ""}`}>
              <div className="signoff-left">
                <span className="signoff-name">{g.name}</span>
                {g.signed_off ? (
                  <span className="signoff-count done">✓ 已完成簽核</span>
                ) : p.length ? (
                  <span className={`signoff-count${low ? " warn" : ""}`}>{p.length} 筆待簽核{low ? `（${low} 筆低信心）` : ""}</span>
                ) : (
                  <span className="signoff-count muted">今日無待簽核</span>
                )}
              </div>
              {!g.signed_off && p.length > 0 && (
                <button className="btn-primary sm" onClick={() => confirmDept(g.department_id)}>確認今日進度</button>
              )}
            </div>
          );
        })}
      </div>

      <footer>台灣福祉科技 × AIPROOT · 戰情室（demo，假資料）· as of {new Date(wr.as_of).toLocaleString("zh-TW")}</footer>
    </div>
  );
}
