import { useState } from "react";
import {
  ApiError, closeTicketWork, reopenTicketWork,
  type WarroomKanbanTicket, type WorkOutcome,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";

// 任務追蹤到結束 · 網頁端的補登（M5）
// docs/modules/task-completion-tracking.md §7
//
// ⚠️ 這裡是**補登**不是主要入口 —— 主要入口是 LINE 引用回覆
// （prod 20 張任務有當責人姓名、0 張對得上系統帳號，網頁對他們不存在）。
// 這一段給的是主管：他有帳號，而且是那個佇列的洩壓閥。
//
// ⚠️ 位置在 **drawer 不在卡面**（Asana 兩層：卡面快速視圖、點開才深入）。
// 卡面只留 triage 需要的量級 pill（design-research-taskboard.md §3 克制）。
//
// ⚠️ 措辭鐵則：一律「尚未確認完成」不用「未完成」——
// 後者說的是工作狀態，人做完但還沒回報時它是**假的**（F-26）。

const OUTCOMES: Array<{ value: WorkOutcome; label: string; hint: string }> = [
  { value: "完成", label: "完成", hint: "事情做好了" },
  { value: "不用做了", label: "不用做了", hint: "後來取消、或改用別的方式處理" },
  { value: "轉他人", label: "轉給別人", hint: "不在這個人手上了" },
  // ⭐ 四個裡最有價值的一個 —— 唯一會讓事情**往上走**的選項。
  //    沒有它，卡住的人只能不按任何鍵，任務靜靜躺著沒人知道。
  { value: "做不到", label: "做不到", hint: "缺料、缺人、缺權限 —— 需要有人處理障礙" },
];

/**
 * Drawer 底部的工作狀態區。
 * 未結束 → 一顆「補登結束」；已結束 → 顯示是誰結的 ＋ 可還原。
 */
export function WorkStatusBox({
  ticket, onChanged,
}: {
  ticket: WarroomKanbanTicket;
  onChanged: () => void;
}) {
  const [closing, setClosing] = useState(false);

  if (ticket.workStatus === "closed") {
    return (
      <div className="wt-box">
        <ClosedLine ticket={ticket} />
        <ReopenButton ticket={ticket} onChanged={onChanged} />
      </div>
    );
  }

  return (
    <div className="wt-box">
      <span className="wt-box-state">
        {ticket.stuckDays != null ? `尚未確認完成 · 已 ${ticket.stuckDays} 天` : "尚未確認完成"}
      </span>
      <button className="btn" onClick={() => setClosing(true)}>補登結束</button>
      <CloseDialog
        open={closing}
        ticket={ticket}
        onClose={() => setClosing(false)}
        onDone={() => { setClosing(false); onChanged(); }}
      />
    </div>
  );
}

/**
 * 補登結束 · 四選一。
 *
 * 不做「一鍵完成」：四個選項對應四種完全不同的後續 ——
 * 完成進統計、不用做了排除在分母外、轉他人要有人接、做不到是求救訊號。
 * 壓成一個布林，這四種訊號就全部消失了。
 */
function CloseDialog({
  open, ticket, onClose, onDone,
}: {
  open: boolean;
  ticket: WarroomKanbanTicket;
  onClose: () => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<WorkOutcome>("完成");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit() {
    setBusy(true);
    try {
      await closeTicketWork(ticket.ticketId, outcome, note.trim() || undefined);
      toast.show(`已標記為「${outcome}」`, "ok");
      setNote("");
      onDone();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "操作失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => void submit()}
      title="結束這件任務"
      confirmLabel="確認結束"
      busy={busy}
      body={
        <div className="wt-form">
          <div className="wt-form-target">{ticket.summary}</div>
          <label className="wt-form-label">為什麼結束？</label>
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              className={`wt-opt ${outcome === o.value ? "sel" : ""}`}
              onClick={() => setOutcome(o.value)}
              type="button"
            >
              <span className="wt-radio" aria-hidden />
              <span>
                <b>{o.label}</b>
                <span className="wt-opt-hint">{o.hint}</span>
              </span>
            </button>
          ))}
          <label className="wt-form-label" htmlFor="wt-note">補一句話（選填）</label>
          <textarea
            id="wt-note"
            className="wt-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          {/* 代結案要讓人知道會留痕 —— 不是威嚇，是避免日後爭議時查不到 */}
          {ticket.assigneeDisplayName && (
            <p className="wt-form-foot">會記錄為由您代 {ticket.assigneeDisplayName} 結束。</p>
          )}
        </div>
      }
    />
  );
}

/**
 * ⚠️ 代結案與本人回報**不可以長得一樣**（抄釘釘：創建人結束的待辦
 * 標成「被創建人結束」而不是「我完成」）。這是日後爭議時唯一的證據，
 * 也讓完成率不會被代標灌水。
 */
function ClosedLine({ ticket }: { ticket: WarroomKanbanTicket }) {
  const proxied = ticket.workClosedVia === "web" && ticket.workClosedByName;
  return (
    <span className={`wt-box-state ${proxied ? "warn" : "ok"}`}>
      {proxied
        ? `由 ${ticket.workClosedByName} 代為結束（${ticket.workOutcome}）`
        : ticket.workClosedVia === "line_reply"
          ? `本人於 LINE 回報「${ticket.workOutcome}」`
          : ticket.displayState}
    </span>
  );
}

function ReopenButton({ ticket, onChanged }: { ticket: WarroomKanbanTicket; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await reopenTicketWork(ticket.ticketId);
          toast.show("已還原成尚未確認完成", "ok");
          onChanged();
        } catch (e) {
          toast.show(e instanceof ApiError ? e.message : "還原失敗", "danger");
        } finally { setBusy(false); }
      }}
    >
      還原
    </button>
  );
}
