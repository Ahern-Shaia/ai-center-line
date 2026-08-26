import Spinner from "../shared/Spinner";
import { useCallback, useEffect, useState } from "react";
import { ApiError, getWarroomDailyReports, triggerWarroomBatchRerun, type WarroomDailyDays } from "../api";
import { usePermissions } from "../permission/PermissionContext";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import GroupCard from "./GroupCard";
import { usePageGuide } from "../shared/usePageGuide";
import { t } from "../i18n";
import { useT } from "../i18n/useT";

// WTB-M4 · 日誌 view · 按天列 · 每 upload 一 card
// scheduler-config M4 · 加「立即分析」按鈕（tenant_admin / aiproot 可觸發）
// 對照 docs/modules/warroom-task-board.md §7.3 · docs/modules/scheduler-config.md §6
export default function DailyLog() {
  const tr = useT();
  const guide = usePageGuide("daily-log");
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
      toast.show(err instanceof ApiError ? err.message : tr("dl.loadFailed"), "danger");
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function doAnalyze() {
    setAnalyzing(true);
    try {
      const res = await triggerWarroomBatchRerun();
      toast.show(tr("dl.analysisDone", { total: res.total, ok: res.completed, empty: res.empty, failed: res.failed }), res.failed === 0 ? "ok" : "warn");
      setConfirmAnalyze(false);
      await refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("dl.analysisFailed"), "danger");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>{tr("nav.dailyLog")}{guide.toggle}</h1>
          <div className="sub">{tr("dl.sub")}</div>
        </div>
        <div className="hdr-toolbar">
          <div className="hdr-group">
            <label className="hdr-label">{tr("dl.range")}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button className={`btn${days === 7 ? " btn-primary" : ""}`} onClick={() => setDays(7)}>{tr("dl.days7")}</button>
              <button className={`btn${days === 30 ? " btn-primary" : ""}`} onClick={() => setDays(30)}>{tr("dl.days30")}</button>
            </div>
          </div>
          {canTriggerAnalyze && (
            <div className="hdr-group">
              <label className="hdr-label">{tr("dl.actions")}</label>
              <button
                className="btn btn-primary"
                onClick={() => setConfirmAnalyze(true)}
                disabled={analyzing}
              >{analyzing ? tr("dl.analysing") : tr("dl.analyseNow")}</button>
              <div className="hdr-group-hint">{tr("dl.analyseHint")}</div>
            </div>
          )}
        </div>
      </div>
      {guide.panel}

      <ConfirmDialog
        open={confirmAnalyze}
        onClose={() => !analyzing && setConfirmAnalyze(false)}
        onConfirm={() => void doAnalyze()}
        busy={analyzing}
        title={tr("dl.analyseTitle")}
        body={
          <div>
            {tr("dl.analyseBody")}
            <div style={{ marginTop: 10, padding: 10, background: "var(--warn-tint)", border: "1px solid #F5D5A6", borderRadius: 6, fontSize: 12, color: "#7A4E1B" }}>
              {tr("dl.analyseTip", { when: data?.batchRunAt ?? "" })}
            </div>
          </div>
        }
        confirmLabel={tr("dl.analyseConfirm")}
        tone="primary"
      />

      {loading && !data && <Spinner block />}
      {data && data.days.length === 0 && (
        <div className="dm-empty">
          {tr("dl.noneInRange")}
          {/* 剛導入的頭幾天一定是空的 —— 只說「無日誌」會讓人以為是壞了 */}
          <div className="dm-empty-hint">
            {tr("dl.noneInRangeHint")}
          </div>
        </div>
      )}

      {/* V4 · 摘要條：一眼知道今天要不要細看（掃描型摘要的入口）*/}
      {data && data.days.length > 0 && <SummaryBar day={data.days[0]} />}

      {/* V4 · 時間軸脊：今日這一「頁」攤開、往前的日期收合成脊上節點（logbook by structure）*/}
      {data && data.days.length > 0 && (
        <div className="dl-timeline">
          {data.days.map((day, i) => (
            <TimelineDay key={day.batchDate} day={day} today={i === 0} />
          ))}
        </div>
      )}
    </>
  );
}

// ⚠️ 「這個群今天有沒有內容」的單一判準 —— 三種產出都算。
//    原本只看 dailyReports/records，於是「只有報修派工單」的群被歸成「今日無活動」摺疊起來，
//    等於抽出來也看不到（service_intake 上線後才會踩到）。新增產出型別時要一起加進這裡。
type DailyUpload = WarroomDailyDays["days"][number]["uploads"][number];
const itemsOf = (u: DailyUpload) =>
  u.dailyReports.length + u.records.length + (u.serviceIntake?.length ?? 0);
const hasAnyContent = (u: DailyUpload) => itemsOf(u) > 0;

// 今日概況 —— 需注意（未分派/未完成）優先，其餘一句話帶過
function daySummary(day: WarroomDailyDays["days"][number]) {
  const attn = day.uploads.filter((u) => u.analysisIncomplete || !u.departmentId);
  const active = day.uploads.filter((u) => !u.analysisIncomplete && u.departmentId && hasAnyContent(u));
  const reports = active.reduce((n, u) => n + u.dailyReports.length, 0);
  const records = active.reduce((n, u) => n + u.records.length, 0);
  const intake = active.reduce((n, u) => n + (u.serviceIntake?.length ?? 0), 0);
  return { attn: attn.length, active: active.length, reports, records, intake };
}

function SummaryBar({ day }: { day: WarroomDailyDays["days"][number] }) {
  const tr = useT();
  const { attn, active, reports, records, intake } = daySummary(day);
  const parts: string[] = [];
  if (reports > 0) parts.push(t("dl.nReports", { n: reports }));
  if (intake > 0) parts.push(t("dl.nIntake", { n: intake }));
  if (records > 0) parts.push(t("dl.nRecords", { n: records }));
  return (
    <div className="dl-sumbar">
      {tr("dl.todayActive", { n: active })}
      {attn > 0 && <> · <b className="warn">{tr("dl.needAttention", { n: attn })}</b></>}
      {parts.length > 0 && <> · {parts.join("、")}</>}
    </div>
  );
}

// 時間軸的一個「日期節點」。今日＝攤開的一頁（實心節點）；往前＝收合的節點（空心，點開翻頁）。
function TimelineDay({ day, today }: { day: WarroomDailyDays["days"][number]; today: boolean }) {
  const tr = useT();
  const [open, setOpen] = useState(today);
  const [showQuiet, setShowQuiet] = useState(false);

  // 需注意（未分派/未完成）置頂 → 有內容 → 無活動收成一行。掃描時眼睛只在琥珀燈點停。
  const attn = day.uploads.filter((u) => u.analysisIncomplete || !u.departmentId);
  const finished = day.uploads.filter((u) => !u.analysisIncomplete && u.departmentId);
  const hasContent = finished.filter(hasAnyContent);
  const quiet = finished.filter((u) => !hasAnyContent(u));
  const shown = [...attn, ...(showQuiet ? [...hasContent, ...quiet] : hasContent)];
  const itemCount = hasContent.reduce((n, u) => n + itemsOf(u), 0);

  // today/past 只管大小排版；發光實心點跟著 open（展開中的日期就發光）
  return (
    <div className={`dl-tl-node${today ? " today" : " past"}${open ? " is-open" : ""}`}>
      {today ? (
        <div className="dl-tl-date">{formatDay(day.batchDate)}</div>
      ) : (
        <button className="dl-tl-date dl-tl-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="dl-tl-chev" aria-hidden>{open ? "▾" : "▸"}</span>
          {formatDay(day.batchDate)}
          <span className="dl-tl-c">{tr("dl.groupsItems", { g: hasContent.length, n: itemCount })}{attn.length > 0 && <b className="warn"> · {tr("dl.attnShort", { n: attn.length })}</b>}</span>
        </button>
      )}

      {open && (
        <div className="dl-tl-entries">
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
              serviceIntake={u.serviceIntake ?? []}
              uploadId={u.uploadId}
              analysisIncomplete={u.analysisIncomplete}
            />
          ))}
          {quiet.length > 0 && !showQuiet && (
            <div className="dl-quiet">
              <span className="dlr-dot dlr-dot-mute" aria-hidden /> {tr("dl.quiet", { n: quiet.length })}
              {quiet.map((u) => u.groupName ?? t("dl.unnamed", { id: u.groupId.slice(-6) })).join("、")}
              <button className="dl-quiet-toggle" onClick={() => setShowQuiet(true)}>{tr("common.expand")}</button>
            </div>
          )}
          {quiet.length > 0 && showQuiet && (
            <div className="dl-quiet"><button className="dl-quiet-toggle" onClick={() => setShowQuiet(false)}>{tr("dl.collapseQuiet", { n: quiet.length })}</button></div>
          )}
          {shown.length === 0 && quiet.length === 0 && (
            <div className="dm-empty" style={{ padding: "10px 0" }}>
              {tr("dl.noneThatDay")}
              <div className="dm-empty-hint">{tr("dl.noDayHint")}</div>
            </div>
          )}
        </div>
      )}
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
  if (isSameDay(d, today)) return `${t("dl.today")} · ${d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" })}`;
  if (isSameDay(d, yesterday)) return `${t("dl.yesterday")} · ${d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" })}`;
  return d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" });
}
