import { useCallback, useEffect, useState } from "react";
import { ApiError, getWarroomDailyReports, triggerWarroomBatchRerun, type WarroomDailyDays } from "../api";
import { usePermissions } from "../permission/PermissionContext";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import GroupCard from "./GroupCard";

// WTB-M4 · 日誌 view · 按天列 · 每 upload 一 card
// scheduler-config M4 · 加「立即分析」按鈕（tenant_admin / aiproot 可觸發）
// 對照 docs/modules/warroom-task-board.md §7.3 · docs/modules/scheduler-config.md §6
export default function DailyLog() {
  const [data, setData] = useState<WarroomDailyDays | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<7 | 30>(7);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmAnalyze, setConfirmAnalyze] = useState(false);
  const toast = useToast();
  const perms = usePermissions();
  // tenant_admin / aiproot 可手動觸發自 tenant group_batch 分析
  const canTriggerAnalyze = perms.has("scheduler-config:manage-tenant") || perms.has("scheduler-config:manage-platform");

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

  async function doAnalyze() {
    setAnalyzing(true);
    try {
      const res = await triggerWarroomBatchRerun();
      toast.show(`分析完成 · 掃 ${res.total} 群組 · ${res.completed} 成功 / ${res.empty} 無資料 / ${res.failed} 失敗`, res.failed === 0 ? "ok" : "warn");
      setConfirmAnalyze(false);
      await refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "分析失敗", "danger");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>群組日誌</h1>
          <div className="sub">各 LINE 群組每日活動摘要 · 由 AI 從當日對話抽取</div>
        </div>
        <div className="hdr-toolbar">
          <div className="hdr-group">
            <label className="hdr-label">查看範圍</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button className={`btn${days === 7 ? " btn-primary" : ""}`} onClick={() => setDays(7)}>近 7 天</button>
              <button className={`btn${days === 30 ? " btn-primary" : ""}`} onClick={() => setDays(30)}>近 30 天</button>
            </div>
          </div>
          {canTriggerAnalyze && (
            <div className="hdr-group">
              <label className="hdr-label">當日操作</label>
              <button
                className="btn btn-primary"
                onClick={() => setConfirmAnalyze(true)}
                disabled={analyzing}
              >{analyzing ? "分析中…" : "立即分析"}</button>
              <div className="hdr-group-hint">AI 掃當日訊息並整理</div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmAnalyze}
        onClose={() => !analyzing && setConfirmAnalyze(false)}
        onConfirm={() => void doAnalyze()}
        busy={analyzing}
        title="立即分析今日對話"
        body={
          <div>
            將對本 tenant 所有 LINE 群組立即跑 AI 分析今日對話 · 需 30–60 秒
            <div style={{ marginTop: 10, padding: 10, background: "var(--warn-tint)", border: "1px solid #F5D5A6", borderRadius: 6, fontSize: 12, color: "#7A4E1B" }}>
              提示 · 若當日訊息還在持續 · 分析後新來的訊息不會即時進入 · {data?.batchRunAt ? `建議 ${data.batchRunAt} 後再手動觸發` : "建議當日訊息結束後再手動觸發"} · 或等隔天自動跑
            </div>
          </div>
        }
        confirmLabel="確定分析"
        tone="primary"
      />

      {loading && !data && <div className="dm-empty">載入中…</div>}
      {data && data.days.length === 0 && <div className="dm-empty">此期間內無日誌</div>}

      {/* 只有最近一天預設展開 —— 7 天 × 6-9 群 ≈ 60 張卡全攤開，
          使用者要找「今天怎麼樣」得先滑過前六天。往前查是偶發需求，不該是預設。*/}
      {data && data.days.map((day, i) => (
        <DaySection key={day.batchDate} day={day} defaultOpen={i === 0} />
      ))}
    </>
  );
}

// 一天一段。當日沒有任何內容的群不佔一整格 —— 6 群裡 4 群沒日報時，
// 版面 2/3 會是「當日無工作日報」的空卡片，把真正有內容的那 2 張擠掉。
// 收成一行，需要時再展開（原始訊息仍看得到，只是不預設佔版面）。
function DaySection({ day, defaultOpen }: { day: WarroomDailyDays["days"][number]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [showQuiet, setShowQuiet] = useState(false);
  // ⚠️ 分析未完成的卡片**不可以**落進 quiet 桶 —— 那個桶會被收合成
  //    「另 N 群當日無日報」，正是要修掉的那句誤導。它沒有內容不是因為沒事發生。
  const incomplete = day.uploads.filter((u) => u.analysisIncomplete);
  const finished = day.uploads.filter((u) => !u.analysisIncomplete);
  const hasContent = finished.filter((u) => u.dailyReports.length > 0 || u.records.length > 0);
  const quiet = finished.filter((u) => u.dailyReports.length === 0 && u.records.length === 0);
  const shown = [...incomplete, ...(showQuiet ? finished : hasContent)];
  const itemCount = hasContent.reduce((n, u) => n + u.dailyReports.length + u.records.length, 0);

  return (
    <div className="dl-day">
      <button className={`dl-day-hdr dl-day-btn${open ? "" : " collapsed"}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <svg className="dl-day-chev" width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="dl-day-date">{formatDay(day.batchDate)}</span>
        <span className="dl-day-count">
          {hasContent.length} 群有日報 · {itemCount} 筆{quiet.length > 0 && ` · ${quiet.length} 群無`}
          {incomplete.length > 0 && <b style={{ color: "var(--warn)" }}> · {incomplete.length} 群未完成</b>}
        </span>
      </button>
      {!open ? null : (<>
      {shown.length > 0 && (
        <div className="dl-day-cards">
          {shown.map((u) => (
            <GroupCard
              key={u.uploadId}
              groupId={u.groupId}
              groupName={u.groupName}
              departmentId={u.departmentId}
              departmentName={u.departmentName}
              batchDate={u.batchDate}
              dailyReports={u.dailyReports}
              records={u.records}
              uploadId={u.uploadId}
              analysisIncomplete={u.analysisIncomplete}
            />
          ))}
        </div>
      )}
      {quiet.length > 0 && !showQuiet && (
        <div className="dl-quiet">
          <span>另 {quiet.length} 群當日無日報：</span>
          <span className="dl-quiet-names">{quiet.map((u) => u.groupName ?? `未命名群組 · ${u.groupId.slice(-6)}`).join("、")}</span>
          <button className="dl-quiet-toggle" onClick={() => setShowQuiet(true)}>展開查看原始訊息</button>
        </div>
      )}
      {quiet.length > 0 && showQuiet && (
        <div className="dl-quiet">
          <button className="dl-quiet-toggle" onClick={() => setShowQuiet(false)}>收合無日報的 {quiet.length} 群</button>
        </div>
      )}
      {hasContent.length === 0 && !showQuiet && quiet.length === 0 && (
        <div className="dm-empty" style={{ padding: "12px 0" }}>當日無資料</div>
      )}
      </>)}
    </div>
  );
}



// AI 抽的分類記錄 (records) · daily_reports 空時 fallback view
// 對應 schema · category / title / detail / status / person / machine_code / work_order


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
