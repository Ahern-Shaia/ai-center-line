import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getTeamPersonalReports,
  type PersonalDailyReportRow,
  type PersonalDailyReportItem,
} from "../api";
import StyledSelect from "../shared/StyledSelect";
import { useToast } from "../Toast";

// 部門日報 · 主管（group_owner / tenant_admin）看下屬送出的個人日報
// 對應 LINE 通知「○○ 已送出 個人日報 · 進戰情室 → 部門日報查看」的落點
//
// scope 全靠後端 RLS（personal_daily_report_scope policy）：
//   group_owner 只看得到自己部門成員的日報、tenant_admin 看全租戶。
//   前端不自己 scope（2026-07-30 prod 驗證）。部門下拉只是視覺過濾、非權限邊界。
//
// 設計：docs/modules/design-research-daily-report.md（方向 C · 對標 Metabase）——
//   後端為每人每天都建一筆（沒回報的 status='empty'），全部平鋪會被空列淹沒
//   （實測 21 筆裡 12 筆空）。這裡預設只顯示「有內容」，空日報收成底部一行聚合，
//   要查「誰沒交」切「未回報」。慣例沿用 .dm-table / .pill / .btn / StyledSelect。

// 狀態 pill 沿用表格狀態欄慣例 .nc-pill（同 TenantManagement / notify LogsTab），非 inline 的 .pill
const STATUS: Record<PersonalDailyReportRow["status"], { label: string; pill: string }> = {
  sent: { label: "已送出", pill: "ok" },
  confirmed: { label: "待送出", pill: "warn" },
  draft: { label: "草稿", pill: "mut" },
  empty: { label: "當日無內容", pill: "mut" },
  failed: { label: "產生失敗", pill: "danger" },
};

type Filter = "content" | "empty" | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "content", label: "有內容" },
  { key: "empty", label: "未回報" },
  { key: "all", label: "全部" },
];

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `星期${WEEKDAY[new Date(y, m - 1, d).getDay()]}`;
}
function previewOf(items: PersonalDailyReportItem[]): string {
  if (items.length === 0) return "";
  const head = items.slice(0, 2).map((i) => i.title || "（未命名事項）").join("、");
  return items.length > 2 ? `${head}…` : head;
}

export default function TeamDailyReport() {
  const toast = useToast();
  const [days, setDays] = useState<7 | 30>(7);
  const [filter, setFilter] = useState<Filter>("content");
  const [dept, setDept] = useState<string>("");   // "" = 全部部門
  const [rows, setRows] = useState<PersonalDailyReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date();
      from.setDate(from.getDate() - days);
      const r = await getTeamPersonalReports({
        from: from.toISOString().slice(0, 10),
        to: new Date().toISOString().slice(0, 10),
      });
      setRows(r.reports);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "載入部門日報失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const departments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.departmentName).filter((d): d is string => !!d))).sort(),
    [rows],
  );

  const deptMatch = useCallback((r: PersonalDailyReportRow) => !dept || r.departmentName === dept, [dept]);

  // 「未回報」＝後端明確標的 status==='empty'（那天沒內容）；其餘 (sent/confirmed/draft/failed) 皆算有內容
  const visible = useMemo(() => rows.filter((r) => {
    if (!deptMatch(r)) return false;
    if (filter === "all") return true;
    return filter === "empty" ? r.status === "empty" : r.status !== "empty";
  }), [rows, filter, deptMatch]);

  // 目前 scope 下被隱藏的空日報數（給聚合行）
  const hiddenEmpty = useMemo(
    () => rows.filter((r) => deptMatch(r) && r.status === "empty").length,
    [rows, deptMatch],
  );

  // 依日期分組（新到舊）· 方向 A 時間軸
  const groups = useMemo(() => {
    const map = new Map<string, PersonalDailyReportRow[]>();
    for (const r of visible) {
      const arr = map.get(r.reportDate) ?? [];
      arr.push(r);
      map.set(r.reportDate, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);

  const toggleDate = (d: string) => setCollapsedDates((prev) => {
    const next = new Set(prev);
    next.has(d) ? next.delete(d) : next.add(d);
    return next;
  });

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>部門日報</h1>
          <div className="sub">部門成員送出的每日工作日報 · 點一列展開看內容</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="seg">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={filter === f.key ? "on" : ""}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >{f.label}</button>
            ))}
          </div>
          {departments.length > 1 && (
            <div style={{ minWidth: 132 }}>
              <StyledSelect
                items={departments.map((d) => ({ id: d, label: d }))}
                value={dept}
                onChange={setDept}
                ariaLabel="依部門過濾"
                allowEmpty
                emptyLabel="全部部門"
                width={132}
              />
            </div>
          )}
          <div className="seg">
            <button className={days === 7 ? "on" : ""} onClick={() => setDays(7)}>近 7 天</button>
            <button className={days === 30 ? "on" : ""} onClick={() => setDays(30)}>近 30 天</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="dm-empty">載入中…</div>
      ) : rows.length === 0 ? (
        <div className="dm-empty">
          此範圍內尚無部門日報
          <div className="dm-empty-hint">
            員工於 LINE 私訊 bot 後由 AI 生成日報、確認送出，才會出現在這裡。
            group_owner 只看得到自己部門的成員。
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="dm-empty">
          {filter === "content"
            ? "這段期間部門成員都沒有送出有內容的日報"
            : filter === "empty"
              ? "這段期間每個人都有回報，沒有空日報"
              : "此部門在這段期間沒有日報"}
          {filter === "content" && hiddenEmpty > 0 && (
            <div className="dm-empty-hint">切「未回報」可看有哪 {hiddenEmpty} 筆當日無內容。</div>
          )}
        </div>
      ) : (
        <div>
          {groups.map(([date, list]) => {
            const gCollapsed = collapsedDates.has(date);
            return (
              <div className="dr-grp" key={date}>
                <div className="dr-grp-hd" onClick={() => toggleDate(date)}>
                  <span className="gchev">{gCollapsed ? "▸" : "▾"}</span>
                  <span className="d mono">{date}</span>
                  <span className="wk">{weekdayOf(date)}</span>
                  <span className="c">{list.length} 筆</span>
                </div>
                {!gCollapsed && list.map((r) => (
                  <TeamReportRow
                    key={r.reportId}
                    row={r}
                    open={openId === r.reportId}
                    onToggle={() => setOpenId(openId === r.reportId ? null : r.reportId)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {!loading && filter === "content" && hiddenEmpty > 0 && (
        <div
          className="dm-info-note"
          role="button"
          tabIndex={0}
          onClick={() => setFilter("empty")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFilter("empty"); } }}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
        >
          <span>另有 <b>{hiddenEmpty}</b> 筆當日無內容（預設隱藏）</span>
          <span style={{ marginLeft: "auto", color: "var(--primary)", fontWeight: 600 }}>顯示 →</span>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="login-hint" style={{ marginTop: 12 }}>
          顯示 {visible.length} 筆 · 依你的角色範圍：部門主管看自己部門、租戶管理者看全公司。空日報預設隱藏。
        </div>
      )}
    </div>
  );
}

function TeamReportRow({ row, open, onToggle }: {
  row: PersonalDailyReportRow;
  open: boolean;
  onToggle: () => void;
}) {
  const items = row.finalItems ?? row.aiItems ?? [];
  const st = STATUS[row.status];
  return (
    <div className="dr-row">
      <div className="dr-row-hd" onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}>
        <span className={`st-dot ${st.pill}`} />
        <span className="dr-nm">{row.userDisplayName ?? "（未命名）"}</span>
        {row.departmentName
          ? <span className="dr-dept">{row.departmentName}</span>
          : <span className="dr-dept" style={{ color: "var(--ink-3)" }}>未分派</span>}
        <span className={`nc-pill ${st.pill}`}>{st.label}</span>
        <span className="dr-n">{items.length}</span>
        <span className="dr-prev">{previewOf(items)}</span>
        <span className="dr-chev">{open ? "▴" : "▾"}</span>
      </div>
      {open && (
        <div className="dr-body">
          {items.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>這份日報沒有項目。</div>
          ) : (
            items.map((it, i) => (
              <div key={i} className="pdr-item">
                <div className="pdr-item-hdr">
                  <span className="pdr-item-idx">{i + 1}</span>
                  {it.time && <span className="pdr-item-time">{it.time}</span>}
                  <span className="pdr-item-title">{it.title || "（未命名事項）"}</span>
                </div>
                {it.detail && <div className="pdr-item-detail">{it.detail}</div>}
                {it.followup && (
                  <div className="pdr-item-followup"><b>追蹤</b> · {it.followup}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
