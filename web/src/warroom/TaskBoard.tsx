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
import { assignTicket, getAssignableMembers, getTicketSource, type AssignableMember, type TicketSource } from "../api";
import { ArchivedList, UnconfirmedQueue } from "./TaskTriage";
import { OverdueLanes } from "./WorkTracking";

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
          <div className="sub">下方三欄是需要您簽核的任務 · 點卡片可展開原始對話對照</div>
        </div>
        <button className="btn" onClick={() => void refresh()} disabled={loading}>重新整理</button>
      </div>

      <UnconfirmedQueue
        tickets={board.kanban.unconfirmed}
        onOpen={setDrawer}
        onDecided={() => void refresh()}
      />

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
          note={signedNote(board)}
          emptyLabel={
            board.counts.overdueUnassigned + board.counts.overdueUnconfirmed > 0
              ? "已簽核的任務都卡住了 · 在下方「卡住的工作」"
              : undefined
          }
        />
      </div>

      {/* 逾期分流 · 兩欄的管理動作完全不同：左邊催派工、右邊問障礙。
          合成一個桶子的話主管無法分流（doc §8） */}
      <OverdueLanes
        unassigned={board.kanban.overdueUnassigned}
        unconfirmed={board.kanban.overdueUnconfirmed}
        onOpen={setDrawer}
        onChanged={() => void refresh()}
      />

      <ArchivedList
        tickets={board.kanban.archived}
        total={board.counts.archived}
        onOpen={setDrawer}
        onDecided={() => void refresh()}
      />

      <TicketDrawer
        ticket={drawer}
        onClose={() => setDrawer(null)}
        onSignoff={doSignoff}
        signing={drawer ? signing.has(drawer.ticketId) : false}
        onAssigned={() => { setDrawer(null); void refresh(); }}
      />
    </>
  );
}

/**
 * 已簽核欄的註腳。
 * 卡住的票已經移到下方的逾期分流 —— 這裡要講出去哪了，
 * 不然主管會以為簽核過的票憑空少了幾張。
 */
function signedNote(board: WarroomTaskBoard): string | undefined {
  const moved = board.counts.overdueUnassigned + board.counts.overdueUnconfirmed;
  const parts: string[] = [];
  if (moved > 0) parts.push(`另有 ${moved} 件卡住了 · 已移到下方「卡住的工作」`);
  if (board.counts.signed > 30) parts.push(`顯示最近 30 筆 · 共 ${board.counts.signed}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

type Tone = "warn" | "danger" | "ok";

function KanbanColumn({
  title, tone, count, tickets, onOpen, note, emptyLabel,
}: {
  title: string;
  tone: Tone;
  count: number;
  tickets: WarroomKanbanTicket[];
  onOpen: (t: WarroomKanbanTicket) => void;
  note?: string;
  emptyLabel?: string;
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
        {/* ⚠️ 提示放在**欄頂**不是欄底：欄高被最長的那欄撐開，
            放底部的話離空狀態近兩千像素，第一屏根本看不到（瀏覽器實測） */}
        {note && <div className="kb-col-note">{note}</div>}
        {tickets.length === 0 && (
          <div className="kb-empty">{emptyLabel ?? `目前沒有${title}的任務`}</div>
        )}
        {tickets.map((t) => (
          <TicketCard key={t.ticketId} t={t} tone={tone} onOpen={() => onOpen(t)} />
        ))}
      </div>
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
        {/* 已歸屬 = 對到系統帳號、進得了他的日報；待認領 = AI 有抽到人名但對不到，等主管派。
            兩者要分得出來，否則主管不知道哪些還需要他動手。*/}
        {t.assignStatus === "assigned" && t.assigneeAccountName ? (
          <span className="kb-who">
            <span className={`kb-avatar kb-avatar-${avatarTone(t.assigneeAccountName)}`} aria-hidden>
              {t.assigneeAccountName.slice(0, 1)}
            </span>
            {t.assigneeAccountName}
          </span>
        ) : t.assignStatus === "unclaimed" ? (
          <span className="kb-who kb-unclaimed">待認領{who ? `：${who}` : ""}</span>
        ) : who ? (
          <span className="kb-who">
            <span className={`kb-avatar kb-avatar-${avatarTone(who)}`} aria-hidden>{who.slice(0, 1)}</span>
            {who}
          </span>
        ) : <span className="kb-who kb-unassigned">未指派</span>}
        {/* 不顯示「已同步到某某系統」—— 各家用的系統不同，而且我方目前也沒有同步功能。
            已簽核欄改顯示誰簽的。*/}
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

// 手動派發 · 導入期的主要流程
// 員工還沒綁定 LINE 時 AI 對不到人，由主管指定；綁定普及後自動歸屬會接手，此處仍可覆寫。
function AssignBox({ ticket, onAssigned }: { ticket: WarroomKanbanTicket; onAssigned: () => void }) {
  const [members, setMembers] = useState<AssignableMember[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function pick(userId: string | null) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await assignTicket(ticket.ticketId, userId);
      toast.show(userId ? `已派給 ${r.assigneeName ?? ""}` : "已退回待認領", "ok");
      setOpen(false);
      onAssigned();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "派發失敗", "danger"); }
    finally { setBusy(false); }
  }

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (members) return;
    try { setMembers((await getAssignableMembers()).members); }
    catch { setMembers([]); }
  }

  const current = ticket.assignStatus === "assigned" ? ticket.assigneeAccountName : null;
  return (
    <div className="ab-wrap">
      <div className="ab-row">
        <span className="ab-lbl">當責人</span>
        <span className="ab-val">
          {current ?? (ticket.assignStatus === "unclaimed"
            ? <>待認領{ticket.assigneeDisplayName ? <span className="ab-hint">（AI 讀到「{ticket.assigneeDisplayName}」但對不到系統帳號）</span> : null}</>
            : "未指派")}
        </span>
        <button className="nc-lnk" onClick={() => void toggle()}>{open ? "取消" : current ? "改派" : "指派"}</button>
      </div>
      {open && (
        <div className="ab-opts">
          {members === null ? <span className="ab-hint">載入中…</span>
            : members.length === 0 ? <span className="ab-hint">沒有可指派的成員</span>
            : (<>
                {members.map((m) => (
                  <button key={m.userId} className="ab-opt" onClick={() => void pick(m.userId)} disabled={busy}>
                    {m.name}
                    {/* 沒綁 LINE 不影響手動派發（日報走網頁登入），只影響之後能不能自動歸屬 */}
                    {!m.hasLineBinding && <span className="ab-nobind">未綁 LINE</span>}
                  </button>
                ))}
                {current && <button className="ab-opt ab-clear" onClick={() => void pick(null)} disabled={busy}>退回待認領</button>}
              </>)}
        </div>
      )}
    </div>
  );
}

// 來源原文對照 · 預設收合（多數時候直接簽，需要時才展開）
function SourceMessages({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TicketSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (data) return;
    setLoading(true);
    try { setData(await getTicketSource(ticketId)); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : "載入失敗"); }
    finally { setLoading(false); }
  }

  return (
    <div className="ts-wrap">
      <button className="ts-toggle" onClick={() => void toggle()}>
        {open ? "收合原始訊息 ▲" : "對照原始訊息 ▼"}
      </button>
      {open && (
        <div className="ts-body">
          {loading && <div className="ts-note">載入中…</div>}
          {err && <div className="ts-note">{err}</div>}
          {data && data.unavailableReason && <div className="ts-note">{data.unavailableReason}</div>}
          {data && data.messages.length > 0 && (
            <>
              <div className="ts-hd">AI 是根據這 {data.messages.length} 則訊息整理的</div>
              {data.messages.map((m) => (
                <div key={m.id} className="ts-msg">
                  <span className="ts-msg-meta">{m.time} {m.sender}</span>
                  <span className="ts-msg-text">{m.text}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TicketDrawer({
  ticket, onClose, onSignoff, signing, onAssigned,
}: {
  ticket: WarroomKanbanTicket | null;
  onClose: () => void;
  onSignoff: (t: WarroomKanbanTicket) => void;
  signing: boolean;
  onAssigned: () => void;
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

          <AssignBox ticket={ticket} onAssigned={onAssigned} />

          {/* 簽核的人一定要看得到原文 —— AI 只是輔助，看不到原文就是幫 AI 背書 */}
          <SourceMessages ticketId={ticket.ticketId} />

          {ticket.sourceUploadId && canOpenConvoDetail() && (
            <div className="drawer-source">
              <button className="nc-lnk" onClick={() => {
                navigateTo({ page: "convo-detail", uploadId: ticket.sourceUploadId as number });
                onClose();
              }}>查當日完整對話 →</button>
            </div>
          )}
        </div>
        <div className="drawer-foot">
          {ticket.confirmStatus === "待簽核" || ticket.confirmStatus === "逾時警示" ? (
            <button className="btn btn-primary" onClick={() => onSignoff(ticket)} disabled={signing}>
              {signing ? "簽核中…" : "簽核此筆"}
            </button>
          ) : (
            <span className="drawer-note">已確認 · 正式列入紀錄</span>
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
