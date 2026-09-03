import { useState } from "react";
import {
  ApiError, closeTicketWork, reopenTicketWork,
  type WarroomKanbanTicket, type WorkOutcome,
} from "../api";
import { useToast } from "../Toast";
import { useT } from "../i18n/useT";
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

// ⚠️ `value` 是 DB 值（work_outcome）· labelKey/hintKey 才是顯示。
//    翻掉 value 會讓結案比對失效（同 confirm_status 的紀律）。
const OUTCOMES: Array<{ value: WorkOutcome; labelKey: string; hintKey: string }> = [
  { value: "完成", labelKey: "outcome.完成", hintKey: "outcomeHint.完成" },
  { value: "不用做了", labelKey: "outcome.不用做了", hintKey: "outcomeHint.不用做了" },
  { value: "轉他人", labelKey: "outcome.轉他人", hintKey: "outcomeHint.轉他人" },
  // ⭐ 四個裡最有價值的一個 —— 唯一會讓事情**往上走**的選項。
  //    沒有它，卡住的人只能不按任何鍵，任務靜靜躺著沒人知道。
  { value: "做不到", labelKey: "outcome.做不到", hintKey: "outcomeHint.做不到" },
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
  const tr = useT();
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
        {ticket.stuckDays != null ? tr("wt.unconfirmedDays", { n: ticket.stuckDays }) : tr("wt.unconfirmed")}
      </span>
      <button className="btn" onClick={() => setClosing(true)}>{tr("wt.logClose")}</button>
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
  const tr = useT();

  async function submit() {
    setBusy(true);
    try {
      await closeTicketWork(ticket.ticketId, outcome, note.trim() || undefined);
      toast.show(tr("wt.marked", { what: tr(`outcome.${outcome}`) }), "ok");
      setNote("");
      onDone();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : tr("common.actionFailed"), "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => void submit()}
      title={tr("wt.closeTitle")}
      confirmLabel={tr("wt.closeConfirm")}
      busy={busy}
      body={
        <div className="wt-form">
          <div className="wt-form-target">{ticket.summary}</div>
          <label className="wt-form-label">{tr("wt.whyClose")}</label>
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              className={`wt-opt ${outcome === o.value ? "sel" : ""}`}
              onClick={() => setOutcome(o.value)}
              type="button"
            >
              <span className="wt-radio" aria-hidden />
              <span>
                <b>{tr(o.labelKey)}</b>
                <span className="wt-opt-hint">{tr(o.hintKey)}</span>
              </span>
            </button>
          ))}
          <label className="wt-form-label" htmlFor="wt-note">{tr("wt.note")}</label>
          <textarea
            id="wt-note"
            className="wt-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          {/* 代結案要讓人知道會留痕 —— 不是威嚇，是避免日後爭議時查不到 */}
          {ticket.assigneeDisplayName && (
            <p className="wt-form-foot">{tr("wt.onBehalf", { name: ticket.assigneeDisplayName })}</p>
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
  const tr = useT();
  // ⚠️⚠️ 判斷順序要先看 workClosedBySelf，再看 via。
  //    2026-09-03 起員工可以在日報上自己結束任務，那條路寫的 via 也是 'web' ——
  //    跟主管代結案一模一樣。只看 via 的話會顯示「由 ○○ 代為結束」而那個 ○○ 就是本人，
  //    主管會以為有人越俎代庖（task-close-by-assignee F-1）。
  const proxied = ticket.workClosedVia === "web" && !ticket.workClosedBySelf && ticket.workClosedByName;
  const what = tr(`outcome.${ticket.workOutcome}`);
  return (
    <span className={`wt-box-state ${proxied ? "warn" : "ok"}`}>
      {proxied
        ? tr("wt.closedByOther", { name: ticket.workClosedByName ?? "—", what })
        : ticket.workClosedVia === "line_reply"
          ? tr("wt.closedSelf", { what })
          // 本人在日報上按的 —— 跟 LINE 回報都是「本人」，但來源不同，講清楚比較好追
          : ticket.workClosedBySelf
            ? tr("wt.closedSelfWeb", { what })
            : ticket.displayState}
    </span>
  );
}

function ReopenButton({ ticket, onChanged }: { ticket: WarroomKanbanTicket; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const tr = useT();
  return (
    <button
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await reopenTicketWork(ticket.ticketId);
          toast.show(tr("wt.reopened"), "ok");
          onChanged();
        } catch (e) {
          toast.show(e instanceof ApiError ? e.message : tr("wt.reopenFailed"), "danger");
        } finally { setBusy(false); }
      }}
    >
      {tr("common.undo")}
    </button>
  );
}
