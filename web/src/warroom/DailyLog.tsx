import { useCallback, useEffect, useState } from "react";
import { ApiError, getWarroomDailyReports, getWarroomGroupMessages, triggerWarroomBatchRerun, type WarroomDailyDays, type WarroomGroupMessage } from "../api";
import { usePermissions } from "../permission/PermissionContext";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import { catLabel } from "../shared/categoryLabel";
import { canOpenConvoDetail, navigateTo } from "../nav";

// 一張卡最多列幾筆。這頁是「今天各群發生什麼」的掃視，不是逐條細讀 ——
// 原本 5 筆 + detail 不截斷，卡片高度差到 5 倍，三欄網格就變成一片鋸齒空白。
const MAX_ITEMS = 3;

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
          <h1>今日日誌</h1>
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
              提示 · 若當日訊息還在持續 · 分析後新來的訊息不會即時進入 · 建議 17:30 後再手動觸發 · 或等隔天自動跑
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
  const hasContent = day.uploads.filter((u) => u.dailyReports.length > 0 || u.records.length > 0);
  const quiet = day.uploads.filter((u) => u.dailyReports.length === 0 && u.records.length === 0);
  const shown = showQuiet ? day.uploads : hasContent;
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
              departmentName={u.departmentName}
              batchDate={u.batchDate}
              dailyReports={u.dailyReports}
              records={u.records}
              uploadId={u.uploadId}
            />
          ))}
        </div>
      )}
      {quiet.length > 0 && !showQuiet && (
        <div className="dl-quiet">
          <span>另 {quiet.length} 群當日無日報：</span>
          <span className="dl-quiet-names">{quiet.map((u) => u.groupName ?? u.groupId).join("、")}</span>
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

function GroupCard({
  groupId, groupName, departmentName, batchDate, dailyReports, records, uploadId,
}: {
  groupId: string;
  groupName: string | null;
  departmentName: string | null;
  batchDate: string;
  dailyReports: Array<Record<string, unknown>>;
  records: Array<Record<string, unknown>>;
  uploadId: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<WarroomGroupMessage[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function toggleExpand() {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (messages !== null) return;   // 已載入 · 不重打
    setLoading(true);
    try {
      const res = await getWarroomGroupMessages(groupId, batchDate);
      setMessages(res.messages);
      setTotal(res.total);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入群訊息失敗", "danger");
      setExpanded(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dl-card">
      <div className="dl-card-hdr">
        <span className="dl-card-group">{groupName ?? groupId}</span>
        {departmentName && <span className="dl-card-dept">{departmentName}</span>}
      </div>
      {dailyReports.length > 0 ? (
        <ul className="dl-report-list">
          {dailyReports.slice(0, MAX_ITEMS).map((r, i) => (
            <li key={i} className="dl-report-item">
              <DailyReportSummary r={r} />
            </li>
          ))}
          {dailyReports.length > MAX_ITEMS && (
            <li className="dl-report-more">
              {canOpenConvoDetail() ? (
                <button className="nc-lnk" onClick={() => navigateTo({ page: "convo-detail", uploadId })}>
                  + {dailyReports.length - MAX_ITEMS} 筆 · 查完整對話 →
                </button>
              ) : <span>+ {dailyReports.length - 5} 筆</span>}
            </li>
          )}
        </ul>
      ) : records.length > 0 ? (
        <>
          <div className="dl-records-hint">
            此群無工廠報工格式訊息 · 但 AI 抽出 <b>{records.length}</b> 項分類記錄
          </div>
          <div className="dl-records">
            {records.slice(0, MAX_ITEMS).map((r, i) => (
              <RecordItem key={i} r={r} />
            ))}
            {records.length > MAX_ITEMS && (
              <div className="dl-report-more">
                {canOpenConvoDetail() ? (
                  <button className="nc-lnk" onClick={() => navigateTo({ page: "convo-detail", uploadId })}>
                    + {records.length - MAX_ITEMS} 筆 · 查完整對話 →
                  </button>
                ) : <span>+ {records.length - 5} 筆</span>}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="dl-card-empty">當日無工作日報</div>
      )}

      <button className="dl-card-toggle" onClick={() => void toggleExpand()}>
        {expanded ? "收合原始訊息 ▲" : "展開群內原始訊息 ▼"}
      </button>

      {expanded && (
        <div className="dl-raw">
          {loading && <div style={{ fontSize: 12, color: "var(--ink-3)", padding: 8 }}>載入中…</div>}
          {!loading && messages && messages.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--ink-3)", padding: 8, textAlign: "center" }}>當日此群 bot 無收到訊息</div>
          )}
          {!loading && messages && messages.length > 0 && (
            <>
              <div className="dl-raw-hdr">bot 收到的訊息 · {total} 則{total > 100 ? "（顯示前 100）" : ""}</div>
              {messages.map((m) => (
                <div key={m.messageId} className="dl-raw-item">
                  <div className="dl-raw-meta">
                    <span className="dl-raw-time">{formatTime(m.sentAt)}</span>
                    <span className="dl-raw-who">{m.senderName ?? "(未綁定成員)"}</span>
                  </div>
                  <div className="dl-raw-text">
                    {m.messageType === "text" && m.textContent}
                    {m.messageType === "sticker" && <span style={{ color: "var(--ink-3)" }}>[貼圖]</span>}
                    {m.messageType === "image" && <span style={{ color: "var(--ink-3)" }}>[圖片]</span>}
                    {!["text", "sticker", "image"].includes(m.messageType) && <span style={{ color: "var(--ink-3)" }}>[{m.messageType}]</span>}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

// AI 抽的分類記錄 (records) · daily_reports 空時 fallback view
// 對應 schema · category / title / detail / status / person / machine_code / work_order
function RecordItem({ r }: { r: Record<string, unknown> }) {
  const category = r.category ? catLabel(r.category as string) : "未分類";
  const title = (r.title as string) || "";
  const detail = (r.detail as string) || "";
  const status = r.status as string | null;
  const person = r.person as string | null;
  const machineCode = r.machine_code as string | null;
  const workOrder = r.work_order as string | null;

  const fields: Array<[string, string]> = [];
  if (person) fields.push(["對口", person]);
  if (machineCode) fields.push(["機台", machineCode]);
  if (workOrder) fields.push(["工單", workOrder]);
  if (status) fields.push(["狀態", statusLabel(status)]);

  return (
    <div className="dl-record-item">
      <div className="dl-record-cat">{category}</div>
      <div className="dl-record-summary">
        {title}
        {detail && detail !== title && <span style={{ color: "var(--ink-2)" }}> · {detail}</span>}
      </div>
      {fields.length > 0 && (
        <div className="dl-record-fields">
          {fields.map(([k, v]) => (
            <span key={k} className="dl-record-field"><b>{k}</b>{v}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "open": return "待處理";
    case "in_progress": return "處理中";
    case "resolved": return "已結案";
    case "info": return "訊息";
    default: return status;
  }
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
