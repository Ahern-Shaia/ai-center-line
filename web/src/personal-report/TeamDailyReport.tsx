import Spinner from "../shared/Spinner";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getTeamPersonalReports,
  type PersonalDailyReportRow,
} from "../api";
import StyledSelect from "../shared/StyledSelect";
import { useTenantPicker } from "../shared/TenantPicker";
import { useToast } from "../Toast";
import { t } from "../i18n";
import { useT } from "../i18n/useT";

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
  sent: { label: "tdr.sent", pill: "ok" },
  confirmed: { label: "tdr.confirmed", pill: "warn" },
  draft: { label: "tdr.draft", pill: "mut" },
  empty: { label: "tdr.emptyDay", pill: "mut" },
  failed: { label: "tdr.failed", pill: "danger" },
};

type Filter = "content" | "empty" | "all";
const FILTERS: { key: Filter; labelKey: string }[] = [
  { key: "content", labelKey: "tdr.hasContent" },
  { key: "empty", labelKey: "tdr.noReport" },
  { key: "all", labelKey: "audit.all" },
];

const WEEKDAY = ["wd.0", "wd.1", "wd.2", "wd.3", "wd.4", "wd.5", "wd.6"];
function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  return t(WEEKDAY[new Date(y, m - 1, d).getDay()]);
}

export default function TeamDailyReport() {
  const tr = useT();
  const toast = useToast();
  // 平台角色要指定看哪一家；租戶角色回 undefined（後端用 JWT 的 tenant_id）
  const [pickedTenantId, tenantPicker, tenantReady] = useTenantPicker();
  const [days, setDays] = useState<7 | 30>(7);
  const [filter, setFilter] = useState<Filter>("content");
  const [dept, setDept] = useState<string>("");   // "" = 全部部門
  const [rows, setRows] = useState<PersonalDailyReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    // 平台角色要等租戶清單載回來才查 —— 否則會帶著空 tenantId 送出，
    // 後端回「請先選擇要查看的租戶」，使用者一進頁面就看到紅色錯誤
    if (!tenantReady) return;
    setLoading(true);
    try {
      const from = new Date();
      from.setDate(from.getDate() - days);
      const r = await getTeamPersonalReports({
        from: from.toISOString().slice(0, 10),
        to: new Date().toISOString().slice(0, 10),
        tenantId: pickedTenantId,
      });
      setRows(r.reports);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : tr("tdr.loadFailed"), "danger");
    } finally {
      setLoading(false);
    }
  }, [days, toast, pickedTenantId, tenantReady]);

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
          <h1>{tr("nav.teamReport")}</h1>
          <div className="sub">{tr("tdr.sub")}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {tenantPicker}
          <div className="seg">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={filter === f.key ? "on" : ""}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >{tr(f.labelKey)}</button>
            ))}
          </div>
          {departments.length > 1 && (
            <div style={{ minWidth: 132 }}>
              <StyledSelect
                items={departments.map((d) => ({ id: d, label: d }))}
                value={dept}
                onChange={setDept}
                ariaLabel={tr("tdr.byDept")}
                allowEmpty
                emptyLabel={tr("tdr.allDepts")}
                width={132}
              />
            </div>
          )}
          <div className="seg">
            <button className={days === 7 ? "on" : ""} onClick={() => setDays(7)}>{tr("dl.days7")}</button>
            <button className={days === 30 ? "on" : ""} onClick={() => setDays(30)}>{tr("dl.days30")}</button>
          </div>
        </div>
      </div>

      {loading ? (
        <Spinner block />
      ) : rows.length === 0 ? (
        <div className="dm-empty">
          {tr("tdr.noneInRange")}
          <div className="dm-empty-hint">
            {tr("tdr.noneHint1")}
            {tr("tdr.noneHint2")}
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="dm-empty">
          {filter === "content"
            ? tr("tdr.emptyContent")
            : filter === "empty"
              ? tr("tdr.emptyNone")
              : tr("tdr.emptyDept")}
          {filter === "content" && hiddenEmpty > 0 && (
            <div className="dm-empty-hint">{tr("tdr.emptyHint", { n: hiddenEmpty })}</div>
          )}
        </div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th style={{ width: "22%" }}>{tr("col.name")}</th>
                <th style={{ width: "22%" }}>{tr("col.dept")}</th>
                <th className="num" style={{ width: "9%" }}>{tr("tdr.items")}</th>
                <th style={{ width: "18%" }}>{tr("kb.fldStatus")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([date, list]) => {
                const gCollapsed = collapsedDates.has(date);
                return (
                  <Fragment key={date}>
                    <tr className="dr-grp-row" onClick={() => toggleDate(date)}>
                      <td colSpan={5}>
                        <span className="gchev">{gCollapsed ? "▸" : "▾"}</span>
                        <span className="mono">{date}</span>
                        <span className="wk">{weekdayOf(date)}</span>
                        <span className="c">{tr("tdr.nRows", { n: list.length })}</span>
                      </td>
                    </tr>
                    {!gCollapsed && list.map((r) => (
                      <TeamReportRow
                        key={r.reportId}
                        row={r}
                        open={openId === r.reportId}
                        onToggle={() => setOpenId(openId === r.reportId ? null : r.reportId)}
                      />
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
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
          <span>{tr("tdr.hiddenN", { n: hiddenEmpty })}</span>
          <span style={{ marginLeft: "auto", color: "var(--primary)", fontWeight: 600 }}>{tr("tdr.show")}</span>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="login-hint" style={{ marginTop: 12 }}>
          {tr("tdr.foot", { n: visible.length })}
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
  const tr = useT();
  const items = row.finalItems ?? row.aiItems ?? [];
  const st = STATUS[row.status];
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td className="dm-td-name">{row.userDisplayName ?? tr("tdr.unnamed")}</td>
        <td>{row.departmentName ?? <span style={{ color: "var(--ink-3)" }}>{tr("gc.noDeptPill")}</span>}</td>
        <td className="num">{items.length}</td>
        <td><span className={`st-dot ${st.pill}`} /><span className={`nc-pill ${st.pill}`}>{tr(st.label)}</span></td>
        <td style={{ textAlign: "right", color: "var(--ink-3)" }}>{tr(open ? "tdr.collapse" : "tdr.expand")}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ background: "var(--surface-2, #F5F6F8)", padding: "10px 14px" }}>
            {items.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{tr("tdr.noItems")}</div>
            ) : (
              items.map((it, i) => (
                <div key={i} className="pdr-item">
                  <div className="pdr-item-hdr">
                    <span className="pdr-item-idx">{i + 1}</span>
                    {it.time && <span className="pdr-item-time">{it.time}</span>}
                    <span className="pdr-item-title">{it.title || tr("pdr.untitled")}</span>
                  </div>
                  {it.detail && <div className="pdr-item-detail">{it.detail}</div>}
                  {it.followup && (
                    <div className="pdr-item-followup"><b>{tr("pdr.followup")}</b> · {it.followup}</div>
                  )}
                </div>
              ))
            )}
          </td>
        </tr>
      )}
    </>
  );
}
