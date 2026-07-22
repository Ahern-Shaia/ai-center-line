import { useCallback, useEffect, useState } from "react";
import { ApiError, getWarroomDailyReports, type WarroomDailyDays } from "../api";
import { useToast } from "../Toast";

// WTB-M4 · 日誌 view · 按天列 · 每 upload 一 card
// 對照 docs/modules/warroom-task-board.md §7.3
export default function DailyLog() {
  const [data, setData] = useState<WarroomDailyDays | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<7 | 30>(7);
  const toast = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date();
      from.setDate(from.getDate() - days);
      const d = await getWarroomDailyReports({
        from: from.toISOString().slice(0, 10),
        to: new Date().toISOString().slice(0, 10),
      });
      setData(d);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入日誌失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>今日日誌</h1>
          <div className="sub">各 LINE 群組每日活動摘要 · 由 AI 從當日對話抽取</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`btn${days === 7 ? " btn-primary" : ""}`} onClick={() => setDays(7)}>近 7 天</button>
          <button className={`btn${days === 30 ? " btn-primary" : ""}`} onClick={() => setDays(30)}>近 30 天</button>
        </div>
      </div>

      {loading && !data && <div className="dm-empty">載入中…</div>}
      {data && data.days.length === 0 && <div className="dm-empty">此期間內無日誌</div>}

      {data && data.days.map((day) => (
        <div key={day.batchDate} className="dl-day">
          <div className="dl-day-hdr">
            <span className="dl-day-date">{formatDay(day.batchDate)}</span>
            <span className="dl-day-count">{day.uploads.length} 群</span>
          </div>
          <div className="dl-day-cards">
            {day.uploads.map((u) => (
              <div key={u.uploadId} className="dl-card">
                <div className="dl-card-hdr">
                  <span className="dl-card-group">{u.groupName ?? u.groupId}</span>
                  {u.departmentName && <span className="dl-card-dept">{u.departmentName}</span>}
                </div>
                {u.dailyReports.length === 0 ? (
                  <div className="dl-card-empty">當日無工作日報</div>
                ) : (
                  <ul className="dl-report-list">
                    {u.dailyReports.slice(0, 5).map((r, i) => (
                      <li key={i} className="dl-report-item">
                        <DailyReportSummary r={r} />
                      </li>
                    ))}
                    {u.dailyReports.length > 5 && (
                      <li className="dl-report-more">
                        <a onClick={() => (window.location.hash = `#/convo-detail/${u.uploadId}`)}>
                          + {u.dailyReports.length - 5} 筆 · 查完整對話 →
                        </a>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function DailyReportSummary({ r }: { r: Record<string, unknown> }) {
  const reporter = r.reporter_name || r.reporter_code || "未署名";
  const parts: string[] = [];
  if (r.line) parts.push(`線別 ${r.line}`);
  if (r.machine_code) parts.push(`機台 ${r.machine_code}`);
  if (r.work_order) parts.push(`工單 ${r.work_order}`);
  if (r.output_qty != null) parts.push(`產出 ${r.output_qty}`);
  if (r.defect_qty != null) parts.push(`不良 ${r.defect_qty}`);
  if (r.work_hours != null) parts.push(`工時 ${r.work_hours}h`);
  return (
    <>
      <span className="dl-report-who">{String(reporter)}</span>
      <span className="dl-report-parts">{parts.join(" · ") || "—"}</span>
      {r.issues != null && String(r.issues).trim() && (
        <div className="dl-report-issue">問題：{String(r.issues)}</div>
      )}
    </>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (isSameDay(d, today)) return `今日 · ${d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" })}`;
  if (isSameDay(d, yesterday)) return `昨日 · ${d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" })}`;
  return d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" });
}
