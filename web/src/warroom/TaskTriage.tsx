import { useState } from "react";
import { ApiError, decideTicket, type WarroomKanbanTicket } from "../api";
import { useToast } from "../Toast";
import { RECORD_STATUS_LABEL as STATUS_LABEL } from "../shared/recordStatusLabel";

// 任務看板的兩個附加區塊 · docs/modules/task-materialization-gate.md
//
// 為什麼不做成看板的第 4、5 欄：這兩區的動作跟簽核不一樣。
// 待確認要回答「這件事要不要追」，看板三欄回答「AI 抽得對不對」。
// 混在同一排會讓人以為都是待辦佇列，而且五欄擠在一起誰也看不清楚。



/**
 * 待確認 · AI 有整理出來但沒有十足把握的事。
 *
 * 刻意**不做「全部收為任務」**：多一顆批次鈕，實務上就等於預設全收，
 * 門檻等於沒有（doc F-5）。一件一件看是這個區塊的重點，不是它的缺點。
 */
export function UnconfirmedQueue({
  tickets, onOpen, onDecided,
}: {
  tickets: WarroomKanbanTicket[];
  onOpen: (t: WarroomKanbanTicket) => void;
  onDecided: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // V4 · 預設收合 —— 待確認是次要 triage，進頁時看板才是主角。
  // 原本 useState(true) 讓它進頁就全展開成一道牆，把看板擠到下面（2026-07-30 雜亂根因）。
  const [open, setOpen] = useState(false);

  if (tickets.length === 0) return null;

  async function decide(t: WarroomKanbanTicket, accept: boolean) {
    setBusy(t.ticketId);
    try {
      await decideTicket(t.ticketId, accept);
      toast.show(accept ? "已收為任務，接著可以簽核" : "已標記為不用追", "ok");
      onDecided();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "操作失敗", "danger");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="tri-box tri-box-warn">
      <button className="tri-hdr" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="kb-dot kb-dot-mid" aria-hidden />
        <span className="tri-title">請您確認</span>
        <span className="kb-col-count">{tickets.length}</span>
        <span className="tri-hint">
          AI 整理出這些事，但沒有十足把握。請看一下要不要追蹤。
        </span>
        <span className="tri-caret" aria-hidden>{open ? "收合 ▴" : "展開檢視 ▾"}</span>
      </button>

      {open && (
        <div className="tri-body tri-body-cap">
          {tickets.map((t) => (
            <div key={t.ticketId} className="tri-row">
              <button className="tri-sum" onClick={() => onOpen(t)} title="點開看原始對話">
                {t.summary}
              </button>
              <span className="tri-meta">
                {t.departmentName ?? "未分派部門"}
                {t.status ? ` · ${STATUS_LABEL[t.status] ?? t.status}` : ""}
                {t.assigneeDisplayName ? ` · ${t.assigneeDisplayName}` : ""}
              </span>
              <span className="tri-act">
                <button className="btn btn-primary" disabled={busy === t.ticketId}
                  onClick={() => void decide(t, true)}>收為任務</button>
                <button className="btn" disabled={busy === t.ticketId}
                  onClick={() => void decide(t, false)}>不用追</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 未列入待辦 · 公告、已完成、以及主管標「不用追」的。
 *
 * 這些**不是**被丟掉的東西——AI 多半抽得很準，只是它們不需要簽核。
 * 預設收合但點得開，而且可以改回待辦：
 * 直接不建卡、或標了不用追就徹底消失，按錯了都沒有任何補救途徑（doc F-1 · P0）。
 */
export function ArchivedList({
  tickets, total, onOpen, onDecided,
}: {
  tickets: WarroomKanbanTicket[];
  total: number;
  onOpen: (t: WarroomKanbanTicket) => void;
  onDecided: () => void;
}) {
  // V4 · 存查改成獨立次頁（由 TaskBoard 的「存查」按鈕進來）· 不再收合、不再壓在看板底部。
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function restore(t: WarroomKanbanTicket) {
    setBusy(t.ticketId);
    try {
      await decideTicket(t.ticketId, true);
      toast.show("已改列待辦", "ok");
      onDecided();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "操作失敗", "danger");
    } finally {
      setBusy(null);
    }
  }

  if (total === 0) {
    return <div className="dm-empty">目前沒有存查紀錄</div>;
  }

  return (
    <section className="tri-box tri-box-quiet">
        <div className="tri-body">
          {tickets.map((t) => (
            <div key={t.ticketId} className="tri-row">
              <button className="tri-sum" onClick={() => onOpen(t)} title="點開看原始對話">
                {t.summary}
              </button>
              <span className="tri-meta">
                {t.confirmStatus === "已忽略"
                  ? "您標記不用追"
                  : t.status ? STATUS_LABEL[t.status] ?? t.status : "—"}
                {` · ${t.departmentName ?? "未分派部門"}`}
              </span>
              {t.confirmStatus === "已忽略" && (
                <span className="tri-act">
                  <button className="btn" disabled={busy === t.ticketId}
                    onClick={() => void restore(t)}>改列待辦</button>
                </span>
              )}
            </div>
          ))}
          {total > tickets.length && (
            <div className="kb-col-foot">顯示最近 {tickets.length} 筆 · 共 {total} 筆</div>
          )}
        </div>
    </section>
  );
}
