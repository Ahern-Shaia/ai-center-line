import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getMyPersonalReport,
  regeneratePersonalReport,
  savePersonalReport,
  type PersonalDailyReportItem,
  type PersonalDailyReportRow,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";

// PDR-M4 · 我的日報頁
// 對照 docs/modules/personal-daily-report.md §7
export default function MyDailyReport() {
  const [date, setDate] = useState<string>(getTaipeiDate());
  const [report, setReport] = useState<PersonalDailyReportRow | null>(null);
  const [items, setItems] = useState<PersonalDailyReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyPersonalReport(date);
      setReport(res.report);
      // 若已有 final_items · load · 否則 load ai_items 供編輯
      if (res.report?.finalItems) setItems(res.report.finalItems);
      else if (res.report?.aiItems) setItems(res.report.aiItems);
      else setItems([]);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [date, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function doSave(action: "save_draft" | "send") {
    setBusy(true);
    try {
      await savePersonalReport({ date, items, action });
      toast.show(action === "send" ? "日報已送出主管" : "草稿已儲存", "ok");
      setConfirmSend(false);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "儲存失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function doRegenerate() {
    setRegenerating(true);
    try {
      const res = await regeneratePersonalReport(date);
      if (res.status === "empty") toast.show("今日無私訊記錄 · 傳幾則給 bot 後再重新生成", "warn");
      else if (res.status === "completed") toast.show(`AI 整理 ${res.itemCount} 項`, "ok");
      else toast.show(res.errorMessage ?? "生成失敗", "danger");
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "生成失敗", "danger");
    } finally {
      setRegenerating(false);
    }
  }

  const isSent = report?.status === "sent";
  const isEmpty = report?.status === "empty" || (!report && !loading);
  const isFailed = report?.status === "failed";

  const canEdit = !isSent && !busy;
  const hasItems = items.length > 0;

  const displayDate = useMemo(() => formatDay(date), [date]);

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>我的日報 · {displayDate}</h1>
          <div className="sub">
            {report?.aiGeneratedAt && !isSent && !isFailed && (
              <>✨ AI 已於 {formatDateTime(report.aiGeneratedAt)} 整理 · 請確認或微調</>
            )}
            {isSent && <>✅ 已於 {formatDateTime(report.sentAt!)} 送出</>}
            {isEmpty && <>今日尚未記錄 · 私訊 bot 一些內容後可按重新生成</>}
            {isFailed && <>AI 整理失敗 · 可重新生成 or 聯繫業助</>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="date"
            className="tf"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={getTaipeiDate()}
            disabled={busy}
          />
          <button className="btn" onClick={() => void doRegenerate()} disabled={busy || regenerating}>
            {regenerating ? "生成中…" : "重新生成"}
          </button>
        </div>
      </div>

      {loading && !report && <div className="dm-empty">載入中…</div>}

      {isEmpty && !loading && (
        <div className="dm-empty">
          <div>今日尚未有記錄</div>
          <div className="dm-empty-hint">私訊台灣福祉 bot 幾則今日工作 · AI 會自動整理 · 17:30 也會自動觸發</div>
        </div>
      )}

      {isFailed && !loading && (
        <div className="dm-empty" style={{ background: "var(--warn-tint)", border: "1px solid #F5D5A6" }}>
          <b>AI 整理失敗</b>
          {report?.errorMessage && <div style={{ marginTop: 6, fontSize: 12 }}>{report.errorMessage}</div>}
        </div>
      )}

      {(hasItems || (report && report.aiItems.length > 0)) && (
        <div className="pdr-items">
          {items.map((item, idx) => (
            <ItemCard
              key={idx}
              item={item}
              idx={idx}
              onChange={(updated) => {
                if (!canEdit) return;
                setItems((s) => s.map((it, i) => i === idx ? updated : it));
              }}
              onDelete={() => canEdit && setItems((s) => s.filter((_, i) => i !== idx))}
              readonly={!canEdit}
            />
          ))}

          {canEdit && (
            <button className="btn pdr-add" onClick={() => setItems((s) => [...s, { title: "", detail: "", time: "", followup: "" }])}>
              + 手動加一項
            </button>
          )}
        </div>
      )}

      {report && !isEmpty && !isFailed && (
        <div className="pdr-foot">
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {report.messageCount > 0 && <>今日私訊 {report.messageCount} 則 · </>}
            {isSent
              ? <span style={{ color: "var(--ok-600)" }}>已送出 · 主管已收到通知</span>
              : items.length > 0
                ? `${items.length} 項待送出`
                : "尚無項目"}
          </div>
          {!isSent && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => void doSave("save_draft")} disabled={busy || !hasItems}>
                儲存草稿
              </button>
              <button className="btn btn-primary" onClick={() => setConfirmSend(true)} disabled={busy || !hasItems}>
                送出日報
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
        title="送出今日日報"
        body={
          <>
            即將送出 <b>{items.length}</b> 項日報給主管<br />
            送出後：
            <ul style={{ marginLeft: 20, marginTop: 6 }}>
              <li>主管會收到通知</li>
              <li>此份日報不能再改</li>
              <li>可到 aiproot 記錄查詢</li>
            </ul>
          </>
        }
        confirmLabel="送出"
        tone="primary"
      />
    </div>
  );
}

function ItemCard({
  item, idx, onChange, onDelete, readonly,
}: {
  item: PersonalDailyReportItem;
  idx: number;
  onChange: (u: PersonalDailyReportItem) => void;
  onDelete: () => void;
  readonly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (editing && !readonly) {
    return (
      <div className="pdr-item pdr-item-edit">
        <div className="pdr-item-row">
          <input
            className="tf pdr-time"
            placeholder="時間 · 例 08:30 或 08:30-10:00"
            value={item.time ?? ""}
            onChange={(e) => onChange({ ...item, time: e.target.value })}
          />
          <input
            className="tf pdr-title"
            placeholder="事項標題"
            value={item.title}
            onChange={(e) => onChange({ ...item, title: e.target.value })}
          />
        </div>
        <textarea
          className="tf pdr-detail"
          placeholder="內容摘要"
          rows={3}
          value={item.detail ?? ""}
          onChange={(e) => onChange({ ...item, detail: e.target.value })}
        />
        <input
          className="tf"
          placeholder="追蹤事項 · 例 明日 09:00 跟人資申請"
          value={item.followup ?? ""}
          onChange={(e) => onChange({ ...item, followup: e.target.value })}
        />
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button className="btn small" onClick={() => setEditing(false)}>完成</button>
        </div>
      </div>
    );
  }
  return (
    <div className="pdr-item">
      <div className="pdr-item-hdr">
        <span className="pdr-item-idx">{idx + 1}</span>
        {item.time && <span className="pdr-item-time">{item.time}</span>}
        <span className="pdr-item-title">{item.title || "（未命名事項）"}</span>
        {!readonly && (
          <div className="pdr-item-actions">
            <button className="btn small" onClick={() => setEditing(true)}>編輯</button>
            <button className="btn small" onClick={onDelete}>刪除</button>
          </div>
        )}
      </div>
      {item.detail && <div className="pdr-item-detail">{item.detail}</div>}
      {item.followup && (
        <div className="pdr-item-followup">
          <b>追蹤</b> · {item.followup}
        </div>
      )}
    </div>
  );
}

function getTaipeiDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-TW", { year: "numeric", month: "numeric", day: "numeric", weekday: "long" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
