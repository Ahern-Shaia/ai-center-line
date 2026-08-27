import Spinner from "../shared/Spinner";
import { getTaipeiDate } from "../shared/taipeiDate";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getMyPersonalReport,
  getAssignedTaskSource,
  regeneratePersonalReport,
  savePersonalReport,
  type PendingRawMessage,
  type PersonalDailyReportItem,
  type PersonalDailyReportRow,
  type TicketSource,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import SourceMessageList from "../warroom/SourceMessageList";
import { bcp47, t} from "../i18n";
import { useT } from "../i18n/useT";

type AssignedTask = { ticketId: string; summary: string | null; canSeeSource?: boolean };

// PDR-M4 · 我的日報頁
// 對照 docs/modules/personal-daily-report.md §7
export default function MyDailyReport() {
  const tr = useT();
  const [date, setDate] = useState<string>(getTaipeiDate());
  const [report, setReport] = useState<PersonalDailyReportRow | null>(null);
  const [items, setItems] = useState<PersonalDailyReportItem[]>([]);
  const [pendingMessageCount, setPendingMessageCount] = useState(0);
  const [pendingMessages, setPendingMessages] = useState<PendingRawMessage[]>([]);
  const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);
  // 今天去過哪 · 系統本來就知道，只是這一頁看不到（4FR §5）
  const [todayVisits, setTodayVisits] = useState<Array<{ place: string; at: string }>>([]);
  // AI 幾點自動整理 · 每家自己設（原本前端寫死 17:30，客戶改了時間畫面就在說謊）
  const [aiRunAt, setAiRunAt] = useState<string | null>(null);
  const [userDisplayName, setUserDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // 哪一項正在就地編輯（提升到父層：編輯時把底部送出條解除固定，避免蓋住「完成」鈕）
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    setEditingIdx(null);
    try {
      const res = await getMyPersonalReport(date);
      setReport(res.report);
      setAiRunAt(res.aiRunAt);
      setPendingMessageCount(res.pendingMessageCount ?? 0);
      setPendingMessages(res.pendingMessages ?? []);
      setAssignedTasks(res.assignedTasks ?? []);
      setTodayVisits(res.todayVisits ?? []);
      setUserDisplayName(res.userDisplayName ?? "");
      // 已送出後若又重新整理過（ai_generated_at 晚於 sent_at）→ 顯示新的 AI 結果，
      // 否則員工按「重新生成」也看不到送出後新增的訊息（final_items 永遠蓋掉 ai_items）。
      const r = res.report;
      if (r && hasNewerAi(r)) setItems(r.aiItems ?? []);
      else if (r?.finalItems) setItems(r.finalItems);
      else if (r?.aiItems) setItems(r.aiItems);
      else setItems([]);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("common.loadFailed"), "danger");
    } finally {
      setLoading(false);
    }
  }, [date, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function doSave(action: "save_draft" | "send") {
    setBusy(true);
    try {
      await savePersonalReport({ date, items, action });
      toast.show(tr(action === "send" ? "pdr.sentToast" : "pdr.draftSaved"), "ok");
      setConfirmSend(false);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("common.saveFailed"), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function doRegenerate() {
    setRegenerating(true);
    try {
      const res = await regeneratePersonalReport(date);
      if (res.status === "empty") toast.show(tr("pdr.noDm"), "warn");
      else if (res.status === "completed") toast.show(tr("pdr.aiDone", { n: res.itemCount }), "ok");
      else toast.show(res.errorMessage ?? tr("pdr.genFailed"), "danger");
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("pdr.genFailed"), "danger");
    } finally {
      setRegenerating(false);
    }
  }

  const isSent = report?.status === "sent";
  // ⚠️ 自己手動加了項目就不算空 —— 只看 report 的話，畫面會同時顯示
  //    「今日尚未有記錄」和下面兩筆已加入的項目，自相矛盾
  const isEmpty = (report?.status === "empty" || (!report && !loading)) && items.length === 0;
  const isFailed = report?.status === "failed";
  // 送出後又重新整理過 → 有未送出的新版本（可再編輯、再次送出）
  const hasUnsentUpdate = report ? hasNewerAi(report) : false;

  const canEdit = (!isSent || hasUnsentUpdate) && !busy;
  // 「今天」才給加自動建議項（指派任務／打卡地點）—— 否則能把今天的任務回填到 8 天前的日報，把記錄搞亂。
  // 過去日期只能檢視 / 編輯既有內容，不能注入新的當日建議。
  const isToday = date === getTaipeiDate();

  // bot 已收到、但晚於上次 AI 整理時間的訊息 → 尚未被整理進日報
  // （AI 是輔助：原始訊息立刻可見，不必每來一則就重跑 LLM 燒 token）
  const unorganizedMessages = useMemo(() => {
    if (!report?.aiGeneratedAt) return [];
    const cut = new Date(report.aiGeneratedAt).getTime();
    return pendingMessages.filter((m) => new Date(m.sentAt).getTime() > cut);
  }, [pendingMessages, report?.aiGeneratedAt]);
  const hasItems = items.length > 0;

  const displayDate = useMemo(() => formatDay(date), [date]);
  const dateHint = useMemo(() => {
    const today = getTaipeiDate();
    if (date === today) return t("dl.today");
    const d1 = new Date(`${date}T00:00:00`);
    const d2 = new Date(`${today}T00:00:00`);
    const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 1) return t("dl.yesterday");
    if (diff > 0) return t("pdr.daysAgo", { n: diff });
    return "";
  }, [date]);

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>{tr("nav.myDailyReport")} · {displayDate}</h1>
          <div className="sub">
            {report?.aiGeneratedAt && !isSent && !isFailed && (
              <>{tr("pdr.aiAt", { at: formatDateTime(report.aiGeneratedAt) })}</>
            )}
            {isSent && !hasUnsentUpdate && <>{tr("pdr.sentAt", { at: formatDateTime(report.sentAt!) })}</>}
            {isSent && hasUnsentUpdate && (
              <span style={{ color: "var(--warn)" }}>
                {tr("pdr.sentAt", { at: formatDateTime(report.sentAt!) })} · <b>{tr("pdr.newSinceSent")}</b> · {tr("pdr.canResend")}
              </span>
            )}
            {isEmpty && <>{tr("pdr.subEmpty")}</>}
            {isFailed && <>{tr("pdr.subFailed")}</>}
          </div>
        </div>
        <div className="hdr-toolbar">
          <div className="hdr-group">
            <label className="hdr-label" htmlFor="pdr-date">{tr("mt.viewDate")}</label>
            <input
              id="pdr-date"
              type="date"
              className="tf"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={getTaipeiDate()}
              disabled={busy}
            />
            <div className="hdr-group-hint">{dateHint}</div>
          </div>
          <div className="hdr-group">
            <label className="hdr-label">{tr("dl.actions")}</label>
            <button
              className="btn"
              onClick={() => void doRegenerate()}
              disabled={busy || regenerating}
            >
              {regenerating ? tr("pdr.generating") : tr("pdr.regenerate")}
            </button>
            <div className="hdr-group-hint">{tr("pdr.regenHint")}</div>
          </div>
        </div>
      </div>

      {loading && !report && <Spinner block />}

      {isEmpty && !loading && (
        pendingMessageCount > 0 ? (
          <div>
            <div className="dm-empty" style={{ marginBottom: 12 }}>
              <div>{tr("pdr.pendingA")}<b>{pendingMessageCount}</b>{tr("pdr.pendingB")}</div>
              <div className="dm-empty-hint">{tr("pdr.pendingHint")} · {aiRunAt ? tr("pdr.orWaitAt", { at: aiRunAt }) : tr("pdr.orWait")}</div>
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => void doRegenerate()} disabled={regenerating}>
                {regenerating ? tr("pdr.generating") : tr("pdr.organizeNow")}
              </button>
            </div>
            <div className="pdr-raw-list">
              <div className="pdr-raw-hdr">{tr("pdr.rawHdr")}</div>
              {pendingMessages.map((m) => (
                <div key={m.messageId} className="pdr-raw-item">
                  <div className="pdr-raw-time">{formatTimeHM(m.sentAt)}</div>
                  <div className="pdr-raw-text">
                    {m.messageType === "text" && m.textContent}
                    {m.messageType === "sticker" && <span style={{ color: "var(--ink-3)" }}>{tr("gc.sticker")}</span>}
                    {m.messageType === "image" && <span style={{ color: "var(--ink-3)" }}>{tr("gc.image")}</span>}
                    {!["text", "sticker", "image"].includes(m.messageType) && <span style={{ color: "var(--ink-3)" }}>[{m.messageType}]</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="dm-empty">
            <div>{tr("pdr.emptyToday")}</div>
            {/* 不寫租戶名 —— 這頁是從各租戶自己的 bot 開的，寫死一家的名字對其他租戶就是錯的。
                頁首副標也是用「私訊 bot」，維持一致。 */}
            <div className="dm-empty-hint">{tr("pdr.emptyTodayHint")}{aiRunAt ? ` · ${tr("pdr.alsoAutoAt", { at: aiRunAt })}` : ""}</div>
          </div>
        )
      )}

      {isFailed && !loading && (
        <div className="dm-empty" style={{ background: "var(--warn-tint)", border: "1px solid #F5D5A6" }}>
          <b>{tr("pdr.aiFailed")}</b>
          {report?.errorMessage && <div style={{ marginTop: 6, fontSize: 12 }}>{report.errorMessage}</div>}
        </div>
      )}

      {/* ⚠️ 這兩個「可加入日報」的區塊刻意放在 hasItems 條件**之外**。
          原本包在裡面，等於日報還空的時候不顯示 —— 而那正是最需要它的時候。
          日報 16 份只有 3 份送出，就是因為打開來是一片空白、要自己想。*/}
        {/* 今天打卡去過的地方 · 一樣不自動寫進日報，由本人決定（4FR §5）
            日報 16 份只有 3 份送出，多半是因為「要自己想今天做了什麼」——
            系統知道他去了哪，給他看，讓這件事從「想」變成「改」。*/}
        {isToday && todayVisits.length > 0 && (
          <div className="pdr-raw-list" style={{ marginTop: 16 }}>
            <div className="pdr-raw-hdr">
              {tr("pdr.visitsA")}<b>{todayVisits.length}</b>{tr("pdr.visitsB")}
            </div>
            {todayVisits.map((v, i) => (
              <div key={`${v.place}-${v.at}-${i}`} className="pdr-raw-item" style={{ alignItems: "center" }}>
                <div className="pdr-raw-time">{v.at}</div>
                <div className="pdr-raw-text">{v.place}</div>
                <button className="btn btn-sm" disabled={!canEdit}
                  onClick={() => setItems((s) => [...s, {
                    title: v.place, detail: "", time: v.at, followup: "", source: "attendance",
                  } as PersonalDailyReportItem])}>{tr("pdr.addToReport")}</button>
              </div>
            ))}
          </div>
        )}

        {/* 指派給我的任務 · 由本人決定要不要納入日報（task-to-personal-report §5）
            不自動寫進去：AI 歸屬可能錯、日報也可能已確認 —— 本人是最後一道防線。*/}
        {isToday && assignedTasks.length > 0 && (
          <div className="pdr-raw-list" style={{ marginTop: 16, borderColor: "var(--primary)" }}>
            <div className="pdr-raw-hdr">
              {tr("pdr.tasksA")}<b>{assignedTasks.length}</b>{tr("pdr.tasksB")}
            </div>
            {assignedTasks.map((t) => (
              <AssignedTaskItem
                key={t.ticketId}
                task={t}
                canEdit={canEdit}
                onAdd={() => setItems((s) => [...s, {
                  title: t.summary ?? "", detail: "", time: "",
                  followup: "", source: "assigned_task", ticketId: t.ticketId,
                } as PersonalDailyReportItem])}
              />
            ))}
          </div>
        )}

      {(hasItems || (report && report.aiItems.length > 0)) && (
        <>
          <div className="pdr-items">
            {items.map((item, idx) => (
              <ItemCard
                key={idx}
                item={item}
                idx={idx}
                editing={editingIdx === idx}
                onStartEdit={() => setEditingIdx(idx)}
                onStopEdit={() => setEditingIdx(null)}
                onChange={(updated) => {
                  if (!canEdit) return;
                  setItems((s) => s.map((it, i) => i === idx ? updated : it));
                }}
                onDelete={() => { if (canEdit) { setEditingIdx(null); setItems((s) => s.filter((_, i) => i !== idx)); } }}
                readonly={!canEdit}
              />
            ))}

            {canEdit && (
              <button className="btn pdr-add" onClick={() => { setEditingIdx(items.length); setItems((s) => [...s, { title: "", detail: "", time: "", followup: "" }]); }}>
                {tr("pdr.addManual")}
              </button>
            )}
          </div>

          {/* bot 已收到、但還沒被 AI 整理進上面項目的訊息 · 立刻可見（不必等 AI，也不浪費 token）*/}
          {unorganizedMessages.length > 0 && (
            <div className="pdr-raw-list" style={{ marginTop: 16, borderColor: "var(--warn)" }}>
              <div className="pdr-raw-hdr" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span>{tr("pdr.unorgA")}<b>{unorganizedMessages.length}</b>{tr("pdr.unorgB")}</span>
                <button className="btn btn-sm" onClick={() => void doRegenerate()} disabled={regenerating}>
                  {regenerating ? tr("pdr.organizing") : tr("pdr.organizeInto")}
                </button>
              </div>
              {unorganizedMessages.map((m) => (
                <div key={m.messageId} className="pdr-raw-item">
                  <div className="pdr-raw-time">{formatTimeHM(m.sentAt)}</div>
                  <div className="pdr-raw-text">
                    {m.messageType === "text" && m.textContent}
                    {m.messageType === "sticker" && <span style={{ color: "var(--ink-3)" }}>{tr("gc.sticker")}</span>}
                    {m.messageType === "image" && <span style={{ color: "var(--ink-3)" }}>{tr("gc.image")}</span>}
                    {!["text", "sticker", "image"].includes(m.messageType) && <span style={{ color: "var(--ink-3)" }}>[{m.messageType}]</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {items.length > 0 && (
            <ReportPreview
              items={items}
              userDisplayName={userDisplayName}
              displayDate={displayDate}
              isSent={isSent && !hasUnsentUpdate}
              live={!isSent || hasUnsentUpdate}
            />
          )}
        </>
      )}

      {/* ⚠️ 條件不要求 report 存在。原本寫 `report && ...`，結果是：
          今天沒有 AI 日報、但自己從打卡/任務加了項目 → 加得進去卻沒有送出按鈕，
          使用者走到死路。只要有東西可送就要給他送出的地方。*/}
      {(report || items.length > 0) && !isEmpty && !isFailed && (
        <div className={`pdr-foot${editingIdx !== null ? " pdr-foot-flow" : ""}`}>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {(report?.messageCount ?? 0) > 0 && <>{tr("pdr.dmCount", { n: report!.messageCount })} · </>}
            {isSent && !hasUnsentUpdate
              ? <span style={{ color: "var(--ok-600)" }}>{tr("pdr.sentNotified")}</span>
              : hasUnsentUpdate
                ? <span style={{ color: "var(--warn)" }}>{tr("pdr.hasUnsent", { n: items.length })}</span>
                : items.length > 0
                  ? t("pdr.nPending", { n: items.length })
                  : t("pdr.noItems")}
          </div>
          {(!isSent || hasUnsentUpdate) && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => void doSave("save_draft")} disabled={busy || !hasItems}>
                {tr("pdr.saveDraft")}
              </button>
              <button className="btn btn-primary" onClick={() => setConfirmSend(true)} disabled={busy || !hasItems}>
                {tr(hasUnsentUpdate ? "pdr.resend" : "pdr.send")}
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmSend}
        onClose={() => !busy && setConfirmSend(false)}
        onConfirm={() => void doSave("send")}
        busy={busy}
        title={tr("pdr.sendTitle")}
        body={
          <div>
            <div style={{ marginBottom: 10, fontSize: 13, color: "var(--ink-3)" }}>
              {tr("pdr.sendBodyA")}<b style={{ color: "var(--ink)" }}>{items.length}</b>{tr("pdr.sendBodyB")}
            </div>
            <ReportPreview items={items} userDisplayName={userDisplayName} displayDate={displayDate} isSent={false} live={false} />
          </div>
        }
        confirmLabel={tr("pdr.confirmSend")}
        tone="primary"
      />
    </div>
  );
}

// 時間格式：24 小時制 HH:MM 或區間 HH:MM-HH:MM（空字串＝未填 · 允許）
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d(\s*[-~]\s*([01]?\d|2[0-3]):[0-5]\d)?$/;
// 輸入時即擋掉非時間字元（數字/冒號/連字號/波浪號/空白以外一律去掉 · 例如「1ww」→「1」）
const cleanTimeInput = (s: string) => s.replace(/[^\d:\-~\s]/g, "");
// 失焦時自動補冒號：純數字 830→08:30、0830→08:30、0830-1000→08:30-10:00（藍領少打冒號）
function normalizeTimeOnBlur(s: string): string {
  const t = s.trim();
  const colon = (d: string) => (d.length === 3 ? `0${d[0]}:${d.slice(1)}` : `${d.slice(0, 2)}:${d.slice(2)}`);
  if (/^\d{3,4}$/.test(t)) return colon(t);
  const m = t.match(/^(\d{3,4})\s*[-~]\s*(\d{3,4})$/);
  if (m) return `${colon(m[1])}-${colon(m[2])}`;
  return t;
}

function ItemCard({
  item, idx, editing, onChange, onDelete, onStartEdit, onStopEdit, readonly,
}: {
  item: PersonalDailyReportItem;
  idx: number;
  editing: boolean;
  onChange: (u: PersonalDailyReportItem) => void;
  onDelete: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  readonly: boolean;
}) {
  const tr = useT();
  const [timeErr, setTimeErr] = useState("");

  function finishEdit() {
    const t = (item.time ?? "").trim();
    if (t && !TIME_RE.test(t)) {
      setTimeErr(tr("pdr.timeErr"));
      return;
    }
    setTimeErr("");
    onStopEdit();
  }

  if (editing && !readonly) {
    return (
      <div className="pdr-item pdr-item-edit">
        <div className="pdr-item-row">
          <input
            className="tf pdr-time"
            inputMode="numeric"
            placeholder={tr("pdr.timePh")}
            value={item.time ?? ""}
            onChange={(e) => { onChange({ ...item, time: cleanTimeInput(e.target.value) }); if (timeErr) setTimeErr(""); }}
            onBlur={() => { const v = normalizeTimeOnBlur(item.time ?? ""); if (v !== (item.time ?? "")) onChange({ ...item, time: v }); }}
          />
          <input
            className="tf pdr-title"
            placeholder={tr("pdr.titlePh")}
            value={item.title}
            onChange={(e) => onChange({ ...item, title: e.target.value })}
          />
        </div>
        <textarea
          className="tf pdr-detail"
          placeholder={tr("pdr.detailPh")}
          rows={3}
          value={item.detail ?? ""}
          onChange={(e) => onChange({ ...item, detail: e.target.value })}
        />
        <input
          className="tf"
          placeholder={tr("pdr.followupPh")}
          value={item.followup ?? ""}
          onChange={(e) => onChange({ ...item, followup: e.target.value })}
        />
        {timeErr && <div style={{ color: "var(--danger)", fontSize: 12, lineHeight: 1.5 }}>{timeErr}</div>}
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button className="btn small btn-primary" onClick={finishEdit}>{tr("pdr.done")}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="pdr-item">
      <div className="pdr-item-hdr">
        <span className="pdr-item-idx">{idx + 1}</span>
        {item.time && <span className="pdr-item-time">{item.time}</span>}
        <span className="pdr-item-title">{item.title || tr("pdr.untitled")}</span>
        {!readonly && (
          <div className="pdr-item-actions">
            <button className="btn small" onClick={onStartEdit}>{tr("pdr.edit")}</button>
            <button className="btn small" onClick={onDelete}>{tr("common.delete")}</button>
          </div>
        )}
      </div>
      {item.detail && <div className="pdr-item-detail">{item.detail}</div>}
      {item.followup && (
        <div className="pdr-item-followup">
          <b>{tr("pdr.followup")}</b> · {item.followup}
        </div>
      )}
    </div>
  );
}

function ReportPreview({
  items, userDisplayName, displayDate, isSent, live,
}: {
  items: PersonalDailyReportItem[];
  userDisplayName: string;
  displayDate: string;
  isSent: boolean;
  live: boolean;
}) {
  const tr = useT();
  return (
    <div className="pdr-preview">
      <div className="pdr-preview-hdr">
        <span>{tr("pdr.preview")}</span>
        {live && <span className="pdr-preview-badge">live preview</span>}
      </div>
      <div className="pdr-preview-title">{userDisplayName || tr("pdr.employee")} · {tr("pdr.personalReport")}</div>
      <div className="pdr-preview-date">{displayDate}</div>
      {items.map((it, idx) => (
        <div key={idx} className="pdr-preview-item">
          <div className="pdr-preview-item-hdr">
            <span className="pdr-preview-idx">{idx + 1}.</span>
            <span className="pdr-preview-title-text">{it.title || tr("pdr.untitled")}</span>
            {it.time && <span className="pdr-preview-time">{it.time}</span>}
          </div>
          {it.detail && <div className="pdr-preview-detail">{it.detail}</div>}
          {it.followup && <div className="pdr-preview-followup">→ {tr("pdr.followup")} · {it.followup}</div>}
        </div>
      ))}
      <div className="pdr-preview-foot">{tr("pdr.previewFoot", { n: items.length })} · {tr(isSent ? "pdr.isSent" : "pdr.notSent")}</div>
    </div>
  );
}

/** 已送出、但之後又重新整理過 → 有尚未送出的新版本（例如送出後又私訊了新內容）*/
function hasNewerAi(r: PersonalDailyReportRow): boolean {
  if (r.status !== "sent" || !r.sentAt || !r.aiGeneratedAt) return false;
  return new Date(r.aiGeneratedAt).getTime() > new Date(r.sentAt).getTime();
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(bcp47(), { year: "numeric", month: "numeric", day: "numeric", weekday: "long" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(bcp47(), { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatTimeHM(iso: string): string {
  return new Date(iso).toLocaleTimeString(bcp47(), { hour12: false, hour: "2-digit", minute: "2-digit" });
}

// 指派任務一列 · 可加入日報 + （部門制 gate 通過時）展開對照原始對話
// F-3：只有 canSeeSource（任務屬本人部門）才給展開；跨部門後端會 403、前端也不顯示按鈕。
function AssignedTaskItem({ task, canEdit, onAdd }: {
  task: AssignedTask;
  canEdit: boolean;
  onAdd: () => void;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<TicketSource | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (source) return;
    setLoading(true);
    try {
      setSource(await getAssignedTaskSource(task.ticketId));
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("pdr.loadSourceFailed"), "danger");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pdr-raw-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="pdr-raw-text" style={{ flex: 1 }}>{task.summary ?? tr("pdr.noSummary")}</div>
        <button className="btn btn-sm" disabled={!canEdit} onClick={onAdd}>{tr("pdr.addToReport")}</button>
      </div>
      {task.canSeeSource && (
        <button className="dl-card-toggle" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => void toggle()}>
          {tr(open ? "kb.hideSource" : "pdr.showSource")}
        </button>
      )}
      {open && (
        <div className="dl-raw" style={{ marginTop: 6 }}>
          {loading && <div style={{ fontSize: 12, color: "var(--ink-3)", padding: 8 }}>{tr("common.loading")}</div>}
          {!loading && source && <SourceMessageList data={source} />}
        </div>
      )}
    </div>
  );
}
