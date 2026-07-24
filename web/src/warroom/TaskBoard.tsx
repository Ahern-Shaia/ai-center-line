import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  confirmSignoff,
  getWarroomTasks,
  type WarroomKanbanTicket,
  type WarroomTaskBoard,
} from "../api";
import { useToast } from "../Toast";
import { catLabel } from "../shared/categoryLabel";

// WTB-M4 · 任務看板 Kanban 3 欄 (待簽核 / 逾時 / 已簽核)
// 對照 docs/modules/warroom-task-board.md §7.2
export default function TaskBoard() {
  const [board, setBoard] = useState<WarroomTaskBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<WarroomKanbanTicket | null>(null);
  const [signing, setSigning] = useState<Set<string>>(new Set());
  const toast = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const b = await getWarroomTasks();
      setBoard(b);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入任務失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const doSignoff = useCallback(async (ticket: WarroomKanbanTicket) => {
    setSigning((s) => new Set(s).add(ticket.ticketId));
    try {
      await confirmSignoff([ticket.ticketId]);
      toast.show(`已簽核：${ticket.summary.slice(0, 20)}`, "ok");
      setDrawer(null);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "簽核失敗", "danger");
    } finally {
      setSigning((s) => {
        const next = new Set(s);
        next.delete(ticket.ticketId);
        return next;
      });
    }
  }, [refresh, toast]);

  if (loading && !board) return <div className="dm-empty">載入任務看板中…</div>;
  if (!board) return null;

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>任務看板</h1>
          <div className="sub">看板 · 高信度 AI 抽取的任務 · 點卡片展開對話上下文 · 支援單筆簽核</div>
        </div>
        <button className="btn" onClick={() => void refresh()} disabled={loading}>重新整理</button>
      </div>

      <div className="kanban">
        <KanbanColumn
          title="待簽核"
          tone="warn"
          count={board.counts.pending}
          tickets={board.kanban.pending}
          onOpen={setDrawer}
        />
        <KanbanColumn
          title="逾時警示"
          tone="danger"
          count={board.counts.overdue}
          tickets={board.kanban.overdue}
          onOpen={setDrawer}
        />
        <KanbanColumn
          title="已簽核"
          tone="ok"
          count={board.counts.signed}
          tickets={board.kanban.signed}
          onOpen={setDrawer}
          note={board.counts.signed > 30 ? `顯示最近 30 筆 · 共 ${board.counts.signed}` : undefined}
        />
      </div>

      <TicketDrawer
        ticket={drawer}
        onClose={() => setDrawer(null)}
        onSignoff={doSignoff}
        signing={drawer ? signing.has(drawer.ticketId) : false}
      />
    </>
  );
}

function KanbanColumn({
  title, tone, count, tickets, onOpen, note,
}: {
  title: string;
  tone: "warn" | "danger" | "ok";
  count: number;
  tickets: WarroomKanbanTicket[];
  onOpen: (t: WarroomKanbanTicket) => void;
  note?: string;
}) {
  return (
    <div className={`kb-col kb-tone-${tone}`}>
      <div className="kb-col-hdr">
        <span className="kb-col-title">{title}</span>
        <span className="kb-col-count">{count}</span>
      </div>
      <div className="kb-col-body">
        {tickets.length === 0 && (
          <div className="kb-empty">目前無 {title}</div>
        )}
        {tickets.map((t) => (
          <TicketCard key={t.ticketId} t={t} onOpen={() => onOpen(t)} />
        ))}
      </div>
      {note && <div className="kb-col-foot">{note}</div>}
    </div>
  );
}

function TicketCard({ t, onOpen }: { t: WarroomKanbanTicket; onOpen: () => void }) {
  const dueText = t.dueAt ? formatDate(t.dueAt) : null;
  // 高信度是本看板預設（sub 已說明）· 逐卡標「信度高」反成雜訊 · 只在中/低時提醒審核者留意
  const confChip = t.confidence === "medium" ? { label: "信度中", level: "mid" }
    : t.confidence === "low" ? { label: "信度低", level: "low" }
      : null;
  return (
    <button className="kb-card" onClick={onOpen}>
      <div className="kb-card-summary">{t.summary}</div>
      <div className="kb-card-meta">
        {t.category && <span className="kb-tag">{catLabel(t.category)}</span>}
        {confChip && <span className={`kb-conf kb-conf-${confChip.level}`}>{confChip.label}</span>}
        {t.assigneeDisplayName && (
          <span className="kb-assignee">
            <svg className="kb-ic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <circle cx="12" cy="8" r="3.2" />
              <path d="M5.5 19a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
            </svg>
            {t.assigneeDisplayName}
          </span>
        )}
        {dueText && (
          <span className="kb-due">
            <svg className="kb-ic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <rect x="3.5" y="5" width="17" height="15" rx="2" />
              <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" strokeLinecap="round" />
            </svg>
            {dueText}
          </span>
        )}
      </div>
      {t.departmentName && <div className="kb-card-dept">{t.departmentName}</div>}
    </button>
  );
}

function TicketDrawer({
  ticket, onClose, onSignoff, signing,
}: {
  ticket: WarroomKanbanTicket | null;
  onClose: () => void;
  onSignoff: (t: WarroomKanbanTicket) => void;
  signing: boolean;
}) {
  const created = useMemo(() => ticket ? formatDateTime(ticket.createdAt) : "", [ticket]);
  const confirmed = useMemo(() => ticket?.confirmedAt ? formatDateTime(ticket.confirmedAt) : "", [ticket]);
  if (!ticket) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-hdr">
          <h3>任務詳情</h3>
          <button className="drawer-close" onClick={onClose} aria-label="關閉">×</button>
        </div>
        <div className="drawer-body">
          <div className="drawer-summary">{ticket.summary}</div>

          <dl className="drawer-meta">
            {ticket.category && (<><dt>分類</dt><dd>{catLabel(ticket.category)}</dd></>)}
            {ticket.departmentName && (<><dt>部門</dt><dd>{ticket.departmentName}</dd></>)}
            {ticket.assigneeDisplayName && (<><dt>指派</dt><dd>{ticket.assigneeDisplayName}</dd></>)}
            {ticket.dueAt && (<><dt>截止</dt><dd>{formatDate(ticket.dueAt)}</dd></>)}
            <dt>建立</dt><dd>{created}</dd>
            {ticket.confirmedAt && (<><dt>簽核</dt><dd>{ticket.confirmedByName ?? "—"} · {confirmed}</dd></>)}
            <dt>狀態</dt><dd>{ticket.confirmStatus}</dd>
          </dl>

          {ticket.sourceUploadId && (
            <div className="drawer-source">
              <a href={`#/convo-detail/${ticket.sourceUploadId}`} onClick={(e) => {
                e.preventDefault();
                // 目前用 hash 表示 · 未來若接 route framework 換掉
                window.location.hash = `#/convo-detail/${ticket.sourceUploadId}`;
                onClose();
              }}>查對話上下文 →</a>
            </div>
          )}
        </div>
        <div className="drawer-foot">
          {ticket.confirmStatus === "待簽核" || ticket.confirmStatus === "逾時警示" ? (
            <button className="btn btn-primary" onClick={() => onSignoff(ticket)} disabled={signing}>
              {signing ? "簽核中…" : "簽核此筆"}
            </button>
          ) : (
            <span className="drawer-note">已簽核 · 已同步至 Ragic</span>
          )}
        </div>
      </aside>
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
