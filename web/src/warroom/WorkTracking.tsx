import { useState } from "react";
import {
  ApiError, closeTicketWork, reopenTicketWork,
  type WarroomKanbanTicket, type WorkOutcome,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";

// 任務追蹤到結束 · docs/modules/task-completion-tracking.md
//
// ⚠️ 措辭鐵則（F-26）：一律「尚未確認完成」不用「未完成」。
// 後者說的是工作狀態 —— 人做完但還沒回報時它是**假的**，
// 而那正是讓人不再信任這個畫面的原因。
//
// ⚠️ 這一頁是**主管視角**。當責人的入口是 LINE 引用回覆
// （prod 20 張任務有名字、0 張對得上系統帳號），網頁對他們不存在。

const OUTCOMES: Array<{ value: WorkOutcome; label: string; hint: string }> = [
  { value: "完成", label: "完成", hint: "事情做好了" },
  { value: "不用做了", label: "不用做了", hint: "後來取消、或改用別的方式處理" },
  { value: "轉他人", label: "轉給別人", hint: "不在這個人手上了" },
  // ⭐ 四個裡最有價值的一個 —— 唯一會讓事情**往上走**的選項。
  //    沒有它，卡住的人只能不按任何鍵，任務靜靜躺著沒人知道。
  { value: "做不到", label: "做不到", hint: "缺料、缺人、缺權限 —— 需要有人處理障礙" },
];

/**
 * 逾期分流 · 兩欄的管理動作完全不同（競品研究 C-3）：
 *   未開始   → 催派工
 *   未確認完成 → 問障礙
 * 合成一個桶子的話主管無法分流。
 */
export function OverdueLanes({
  unassigned, unconfirmed, onOpen, onChanged,
}: {
  unassigned: WarroomKanbanTicket[];
  unconfirmed: WarroomKanbanTicket[];
  onOpen: (t: WarroomKanbanTicket) => void;
  onChanged: () => void;
}) {
  if (unassigned.length === 0 && unconfirmed.length === 0) return null;
  return (
    <>
      {/* 講清楚這兩欄回答的是「另一個問題」—— 上面三欄問「AI 抽得對不對」，
          這裡問「工作有沒有在動」。不說的話會被當成同一件事重複列 */}
      <div className="wt-lanes-hd">
        <h2 className="wt-lanes-title">卡住的工作</h2>
        <span className="wt-lanes-sub">
已簽核超過 7 天、但沒有人回報完成的 · 上面三欄問「AI 抽得對不對」，這裡問「工作有沒有在動」
        </span>
      </div>
      <section className="wt-lanes">
      <OverdueLane
        title="逾期未開始"
        tone="warn"
        hint="沒人接，或接了完全沒動靜 · 主管要做的是指派，或決定不用做"
        tickets={unassigned}
        onOpen={onOpen}
        onChanged={onChanged}
      />
      <OverdueLane
        title="逾期未確認完成"
        tone="danger"
        hint="有人接了但卡住 · 主管要做的是問障礙"
        tickets={unconfirmed}
        onOpen={onOpen}
        onChanged={onChanged}
      />
      </section>
    </>
  );
}

function OverdueLane({
  title, tone, hint, tickets, onOpen, onChanged,
}: {
  title: string;
  tone: "warn" | "danger";
  hint: string;
  tickets: WarroomKanbanTicket[];
  onOpen: (t: WarroomKanbanTicket) => void;
  onChanged: () => void;
}) {
  return (
    <div className={`wt-lane ${tone}`}>
      <div className="wt-lane-hd">
        <span className="wt-lane-title">{title}</span>
        <span className="wt-lane-count">{tickets.length} 件</span>
      </div>
      <div className="wt-lane-hint">{hint}</div>
      {tickets.length === 0
        ? <div className="wt-empty">目前沒有</div>
        : tickets.map((t) => (
            <WorkCard key={t.ticketId} ticket={t} onOpen={onOpen} onChanged={onChanged} />
          ))}
    </div>
  );
}

export function WorkCard({
  ticket, onOpen, onChanged,
}: {
  ticket: WarroomKanbanTicket;
  onOpen: (t: WarroomKanbanTicket) => void;
  onChanged: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const days = daysSince(ticket.createdAt);
  return (
    <div className="wt-card">
      <button className="wt-card-main" onClick={() => onOpen(ticket)}>
        <div className="wt-card-title">{ticket.summary || "（無摘要）"}</div>
        <div className="wt-card-meta">
          <span>{ticket.assigneeDisplayName ?? "未指派"}</span>
          {/* 未綁定的當責人只是文字不是身分 —— 不要讓人以為那是精確的（F-23） */}
          {ticket.assigneeDisplayName && !ticket.assigneeUserId && (
            <span className="wt-soft">（未綁定）</span>
          )}
          <span className="wt-mono">開了 {days} 天</span>
          <span className="wt-state">{ticket.displayState}</span>
        </div>
        {ticket.workLastReportNote
          ? <div className="wt-note">最後回報：{ticket.workLastReportNote}</div>
          : <div className="wt-note wt-soft">從未回報</div>}
      </button>
      <div className="wt-card-acts">
        <button className="btn" onClick={() => setClosing(true)}>補登結束</button>
      </div>
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
          {/* 代結案要讓人知道會留痕 —— 這不是威嚇，是避免日後爭議時查不到 */}
          {ticket.assigneeDisplayName && (
            <p className="wt-form-foot">
              會記錄為由您代 {ticket.assigneeDisplayName} 結束。
            </p>
          )}
        </div>
      }
    />
  );
}

/**
 * 已結束的任務 · 顯示是誰結的，並可還原。
 *
 * 代結案與本人回報**不可以長得一樣**（抄釘釘：創建人結束的待辦標成
 * 「被創建人結束」而不是「我完成」）。這是日後爭議時唯一的證據，
 * 也讓完成率不會被代標灌水。
 */
export function ClosedBadge({ ticket }: { ticket: WarroomKanbanTicket }) {
  if (ticket.workStatus !== "closed") return null;
  const proxied = ticket.workClosedVia === "web" && ticket.workClosedByName;
  return (
    <span className={`wt-badge ${proxied ? "warn" : "ok"}`}>
      {proxied
        ? `由 ${ticket.workClosedByName} 代為結束`
        : ticket.workClosedVia === "line_reply"
          ? `本人於 LINE 回報${ticket.workOutcome === "完成" ? "完成" : `「${ticket.workOutcome}」`}`
          : ticket.displayState}
    </span>
  );
}

export function ReopenButton({ ticket, onChanged }: { ticket: WarroomKanbanTicket; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (ticket.workStatus !== "closed") return null;
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

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
