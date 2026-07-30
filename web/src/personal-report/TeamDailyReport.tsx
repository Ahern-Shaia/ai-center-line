import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  getTeamPersonalReports,
  type PersonalDailyReportRow,
  type PersonalDailyReportItem,
} from "../api";
import { useToast } from "../Toast";

// 部門日報 · 主管（group_owner / tenant_admin）看下屬送出的個人日報
// 對應 LINE 通知「○○ 已送出 個人日報 · 進戰情室 → 部門日報查看」的落點
//
// scope 全靠後端 RLS（personal_daily_report_scope policy）：
//   group_owner 只看得到自己部門成員的日報、tenant_admin 看全租戶。
//   查詢本身沒有部門過濾 —— 前端不需要、也不該自己 scope（2026-07-30 prod 驗證）。
//
// 慣例：table=.dm-table · 日期範圍沿用群組日誌的「近 7/30 天」· item 渲染重用 .pdr-item

const STATUS: Record<PersonalDailyReportRow["status"], { label: string; tone: string }> = {
  sent: { label: "已送出", tone: "var(--ok-600)" },
  confirmed: { label: "待送出", tone: "var(--warn)" },
  draft: { label: "草稿", tone: "var(--ink-3)" },
  empty: { label: "當日無內容", tone: "var(--ink-3)" },
  failed: { label: "產生失敗", tone: "var(--rose-600)" },
};

export default function TeamDailyReport() {
  const toast = useToast();
  const [days, setDays] = useState<7 | 30>(7);
  const [rows, setRows] = useState<PersonalDailyReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

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

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>部門日報</h1>
          <div className="sub">部門成員送出的每日工作日報 · 點一列展開看內容</div>
        </div>
        <div className="hdr-toolbar">
          <div className="hdr-group">
            <label className="hdr-label">查看範圍</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button className={`btn${days === 7 ? " btn-primary" : ""}`} onClick={() => setDays(7)}>近 7 天</button>
              <button className={`btn${days === 30 ? " btn-primary" : ""}`} onClick={() => setDays(30)}>近 30 天</button>
            </div>
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
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th style={{ width: "14%" }}>日期</th>
                <th style={{ width: "20%" }}>姓名</th>
                <th style={{ width: "20%" }}>部門</th>
                <th className="num" style={{ width: "10%" }}>項數</th>
                <th style={{ width: "14%" }}>狀態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const items = r.finalItems ?? r.aiItems ?? [];
                const open = openId === r.reportId;
                const st = STATUS[r.status];
                return (
                  <TeamReportRow
                    key={r.reportId}
                    row={r}
                    items={items}
                    open={open}
                    statusLabel={st.label}
                    statusTone={st.tone}
                    onToggle={() => setOpenId(open ? null : r.reportId)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="login-hint" style={{ marginTop: 12 }}>
        共 {rows.length} 筆 · 顯示範圍依你的角色：部門主管看自己部門、租戶管理者看全公司。
      </div>
    </div>
  );
}

function TeamReportRow({ row, items, open, statusLabel, statusTone, onToggle }: {
  row: PersonalDailyReportRow;
  items: PersonalDailyReportItem[];
  open: boolean;
  statusLabel: string;
  statusTone: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td className="mono">{row.reportDate}</td>
        <td className="dm-td-name">{row.userDisplayName ?? "（未命名）"}</td>
        <td>{row.departmentName ?? <span style={{ color: "var(--ink-3)" }}>未分派部門</span>}</td>
        <td className="num">{items.length}</td>
        <td style={{ color: statusTone, fontWeight: 500 }}>{statusLabel}</td>
        <td style={{ textAlign: "right", color: "var(--ink-3)" }}>{open ? "收合 ▲" : "展開 ▼"}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: "var(--surface-2, #F5F6F8)", padding: "10px 14px" }}>
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
          </td>
        </tr>
      )}
    </>
  );
}
