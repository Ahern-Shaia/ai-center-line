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
import { canOpenConvoDetail, navigateTo } from "../nav";

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

type Tone = "warn" | "danger" | "ok";

function KanbanColumn({
  title, tone, count, tickets, onOpen, note,
}: {
  title: string;
  tone: Tone;
  count: number;
  tickets: WarroomKanbanTicket[];
  onOpen: (t: WarroomKanbanTicket) => void;
  note?: string;
}) {
  return (
    <div className="kb-col">
      <div className="kb-col-hdr">
        {/* 色＋形＋字三重編碼：燈點只是輔助，欄名本身就講清楚狀態 */}
        <span className={`kb-dot kb-dot-${tone}`} aria-hidden />
        <span className="kb-col-title">{title}</span>
        <span className="kb-col-count">{count}</span>
      </div>
      <div className="kb-col-body">
        {tickets.length === 0 && (
          <div className="kb-empty">目前無 {title}</div>
        )}
        {tickets.map((t) => (
          <TicketCard key={t.ticketId} t={t} tone={tone} onOpen={() => onOpen(t)} />
        ))}
      </div>
      {note && <div className="kb-col-foot">{note}</div>}
    </div>
  );
}

function TicketCard({ t, tone, onOpen }: { t: WarroomKanbanTicket; tone: Tone; onOpen: () => void }) {
  // 高信度是本看板預設（sub 已說明）· 逐卡標「信度高」反成雜訊 · 只在中/低時提醒審核者留意
  const confChip = t.confidence === "medium" ? { label: "信度中", level: "mid" }
    : t.confidence === "low" ? { label: "信度低", level: "low" }
      : null;
  // 逾時要顯「量級」不只是「在逾時欄」—— 逾 1 天和逾 15 天的處理順序完全不同
  const overdueDays = tone === "danger" ? daysOverdue(t.dueAt) : null;
  const dueText = t.dueAt && overdueDays == null ? formatDate(t.dueAt) : null;
  const who = t.assigneeDisplayName;

  return (
    <button className="kb-card" onClick={onOpen}>
      <span className={`kb-stripe kb-stripe-${tone}`} aria-hidden />
      <div className="kb-card-summary">{t.summary}</div>
      <div className="kb-card-meta">
        {t.category && <span className="kb-tag">{catLabel(t.category)}</span>}
        {confChip && (
          <span className={`kb-conf kb-conf-${confChip.level}`}>
            <span className="kb-conf-d" aria-hidden />
            {confChip.label}
          </span>
        )}
        {overdueDays != null && <span className="kb-over">逾時 {overdueDays} 天</span>}
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
      <div className="kb-card-foot">
        {who ? (
          <span className="kb-who">
            <span className={`kb-avatar kb-avatar-${avatarTone(who)}`} aria-hidden>{who.slice(0, 1)}</span>
            {who}
          </span>
        ) : <span className="kb-who kb-unassigned">未指派</span>}
        {/* mockup 這裡是「已同步 Ragic」，但目前沒有 Ragic 同步、資料也沒這欄位 →
            不做假訊號，已簽核欄改顯示誰簽的 */}
        <span>{tone === "ok" && t.confirmedByName ? `${t.confirmedByName} 已簽核` : t.departmentName ?? ""}</span>
      </div>
    </button>
  );
}

// 逾期天數 · 只在逾時欄用；未逾期（含今天）回 null，避免顯示「逾時 0 天」
function daysOverdue(dueAt: string | null): number | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const startOfDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((startOfDay(new Date()) - startOfDay(due)) / 86_400_000);
  return diff > 0 ? diff : null;
}

// avatar 底色依姓名決定 · 同一人每次都同色（隨機會讓人以為換人了）
const AVATAR_TONES = ["blue", "green", "rose", "amber", "slate"] as const;
function avatarTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
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

          {ticket.sourceUploadId && canOpenConvoDetail() && (
            <div className="drawer-source">
              <button className="nc-lnk" onClick={() => {
                navigateTo({ page: "convo-detail", uploadId: ticket.sourceUploadId as number });
                onClose();
              }}>查對話上下文 →</button>
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
