import { useCallback, useEffect, useMemo, useState } from "react";
import SourceMessageList from "./SourceMessageList";
import {
  ApiError,
  confirmSignoff,
  getWarroomTasks,
  triggerWarroomBatchRerun,
  type WarroomKanbanTicket,
  type WarroomTaskBoard,
} from "../api";
import { useToast } from "../Toast";
import { t } from "../i18n";
import { useT } from "../i18n/useT";
import { catLabel } from "../shared/categoryLabel";
import { canOpenConvoDetail, navigateTo } from "../nav";
import { assignTicket, getAssignableMembers, getTicketSource, notifyOthers, type AssignableMember, type TicketSource } from "../api";
import { UnconfirmedQueue } from "./TaskTriage";
import ArchivePage from "./ArchivePage";
import { WorkStatusBox } from "./WorkTracking";
import { usePageGuide } from "../shared/usePageGuide";
import { confirmLabel } from "../shared/confirmStatusLabel";

// WTB-M4 · 任務看板 Kanban 3 欄 (待核對 / 逾時 / 已核對)
// 對照 docs/modules/warroom-task-board.md §7.2
export default function TaskBoard() {
  const tr = useT();
  const guide = usePageGuide("task-board");
  const [board, setBoard] = useState<WarroomTaskBoard | null>(null);
  // 「只看卡住的」· Linear 的 display options —— 要聚焦用篩選，不用另開一個容器
  const [onlyStuck, setOnlyStuck] = useState(false);
  // 分類篩選（null = 全部）· V5：68 張混雜一欄時，先讓主管能一次只看一類
  const [catFilter, setCatFilter] = useState<string | null>(null);
  // 分類組的收合覆寫 · key = `${欄名}::${分類}`；預設前 2 組展開（見 isGroupCollapsed）
  const [groupToggled, setGroupToggled] = useState<Set<string>>(new Set());
  // V4 · 存查改成獨立次頁（不再壓在看板底部）· 由 toolbar「存查」按鈕切換
  const [showArchive, setShowArchive] = useState(false);
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
      toast.show(err instanceof ApiError ? err.message : tr("kb.loadFailed"), "danger");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const doSignoff = useCallback(async (ticket: WarroomKanbanTicket) => {
    setSigning((s) => new Set(s).add(ticket.ticketId));
    try {
      await confirmSignoff([ticket.ticketId]);
      toast.show(tr("kb.verifiedOne", { s: ticket.summary.slice(0, 20) }), "ok");
      setDrawer(null);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("kb.verifyFailed"), "danger");
    } finally {
      setSigning((s) => {
        const next = new Set(s);
        next.delete(ticket.ticketId);
        return next;
      });
    }
  }, [refresh, toast]);

  if (loading && !board) return <div className="dm-empty">{tr("kb.loading")}</div>;
  if (!board) return null;

  // V4 · 存查次頁：偶爾瀏覽、大量紀錄 → 獨立去處，不塞回主看板（判準見 mockup taskboard-v4-focus）
  // M3b · 它有自己的分頁查詢與篩選狀態，所以是獨立元件，不是這裡的一個 if 分支
  if (showArchive) {
    return (
      <>
        <ArchivePage
          onBack={() => setShowArchive(false)}
          onOpen={setDrawer}
          onDecided={() => void refresh()}
        />
        <TicketDrawer ticket={drawer} onClose={() => setDrawer(null)} onSignoff={doSignoff} signing={drawer ? signing.has(drawer.ticketId) : false} onAssigned={() => { setDrawer(null); void refresh(); }} />
      </>
    );
  }

  // 篩選只影響「顯示什麼」，不影響欄頭計數 —— 計數要一直是真實總數，
  // 否則開了篩選之後數字跟著變，人會分不清是篩掉了還是真的少了
  const pick = (list: typeof board.kanban.pending) => {
    const byStuck = onlyStuck ? list.filter((t) => t.stuckDays != null) : list;
    return catFilter ? byStuck.filter((t) => (t.category || UNCAT) === catFilter) : byStuck;
  };

  // 分類篩選 chip 的來源＝待處理的兩欄（已核對是回顧用，不影響 triage 的分類視野）
  const catChips = groupByCategory([...board.kanban.pending, ...board.kanban.overdue]);
  const catTotal = board.kanban.pending.length + board.kanban.overdue.length;

  const isGroupCollapsed = (colTitle: string, catKey: string, idx: number) => {
    // 預設前 2 組展開、其餘收合（68 張分 5 組時，一次攤開全部等於沒分組）；使用者點過就反轉
    const def = idx >= 2;
    return groupToggled.has(`${colTitle}::${catKey}`) ? !def : def;
  };
  const toggleGroup = (colTitle: string, catKey: string) => setGroupToggled((prev) => {
    const next = new Set(prev);
    const k = `${colTitle}::${catKey}`;
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });

  return (
    <>
      <div className="pane-hdr">
        <div>
          <h1>{tr("nav.taskBoard")}{guide.toggle}</h1>
          <div className="sub">{tr("kb.sub")}</div>
        </div>
        <div className="kb-viewbar">
          {board.counts.stuck > 0 && (
            <button
              className={`btn btn-sm${onlyStuck ? " btn-primary" : ""}`}
              onClick={() => setOnlyStuck((v) => !v)}
            >
              {onlyStuck ? tr("kb.showAll") : tr("kb.onlyStuck", { n: board.counts.stuck })}
            </button>
          )}
          {/* V4 · 存查入口在 toolbar（穩定位置，不隨看板變長往下跑）· 點開進獨立次頁 */}
          {board.counts.archived > 0 && (
            <button className="btn" onClick={() => setShowArchive(true)}>
              {tr("arc.title")} <span className="mono" style={{ color: "var(--ink-3)" }}>{board.counts.archived}</span>
            </button>
          )}
          <button className="btn" onClick={() => void refresh()} disabled={loading}>{tr("common.refresh")}</button>
        </div>
      </div>
      {guide.panel}

      {/* V5 · 分類篩選 · 68 張混雜時先讓主管一次只看一類（維保要判「派給誰」、研發討論要判「算不算任務」）*/}
      {catChips.length > 1 && (
        <div className="kb-catbar">
          <button
            className={`kb-cchip${catFilter === null ? " on" : ""}`}
            onClick={() => setCatFilter(null)}
          >{tr("kb.all")} <span className="n">{catTotal}</span></button>
          {catChips.map((g) => (
            <button
              key={g.key}
              className={`kb-cchip${catFilter === g.key ? " on" : ""}`}
              onClick={() => setCatFilter(catFilter === g.key ? null : g.key)}
            >
              <span className={`kb-cdot kb-avatar-${catTone(g.key)}`} aria-hidden />
              {g.label} <span className="n">{g.items.length}</span>
            </button>
          ))}
        </div>
      )}

      <UnconfirmedQueue
        tickets={board.kanban.unconfirmed}
        onOpen={setDrawer}
        onDecided={() => void refresh()}
      />

      {/* ⭐ 整份看板都空的時候，逐欄各說一次「目前沒有…的任務」對新客戶等於沒說。
          新客戶第一天開這一頁一定是空的 —— 那正是最該解釋「這頁的東西從哪來」的時機。 */}
      {board.counts.pending === 0 && board.counts.overdue === 0 && board.counts.signed === 0
        && board.kanban.unconfirmed.length === 0 && (
        <div className="kb-board-empty">
          <div className="kb-board-empty-h">{tr("kb.emptyTitle")}</div>
          <div className="kb-board-empty-b">
            {tr("kb.emptyHint")}
          </div>
          <TriggerAnalysisButton />
        </div>
      )}

      <div className="kanban">
        <KanbanColumn
          title={tr("confirmStatus.待簽核")}
          tone="warn"
          count={board.counts.pending}
          tickets={pick(board.kanban.pending)}
          onOpen={setDrawer}
          grouped
          isCollapsed={isGroupCollapsed}
          onToggleGroup={toggleGroup}
        />
        <KanbanColumn
          title={tr("confirmStatus.逾時警示")}
          tone="danger"
          count={board.counts.overdue}
          tickets={pick(board.kanban.overdue)}
          onOpen={setDrawer}
          grouped
          isCollapsed={isGroupCollapsed}
          onToggleGroup={toggleGroup}
        />
        <KanbanColumn
          title={tr("confirmStatus.已簽核")}
          tone="ok"
          count={board.counts.signed}
          tickets={pick(board.kanban.signed)}
          onOpen={setDrawer}
          note={signedNote(board)}
        />
      </div>

      {/* V4 · 存查已移到 toolbar「存查」按鈕 → 獨立次頁（見上方 showArchive 分支），不再壓在看板底部 */}

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

/** 已核對欄的註腳 · 只在超過顯示上限時才講 */
// ⚠️ 這是**純輔助函式不是元件** —— 不可以在這裡用 useT()（違反 Rules of Hooks）。
//    用純函式 t()：呼叫它的 TaskBoard 已經訂閱了語言，重繪照樣發生。
function signedNote(board: WarroomTaskBoard): string | undefined {
  return board.counts.signed > 30 ? t("kb.recent30", { n: board.counts.signed }) : undefined;
}

type Tone = "warn" | "danger" | "ok";

function KanbanColumn({
  title, tone, count, tickets, onOpen, note, emptyLabel,
  grouped, isCollapsed, onToggleGroup,
}: {
  title: string;
  tone: Tone;
  count: number;
  tickets: WarroomKanbanTicket[];
  onOpen: (t: WarroomKanbanTicket) => void;
  note?: string;
  emptyLabel?: string;
  /** V5 · 依分類收攏（待核對／逾時這種要 triage 的欄才開；已核對是回顧用，平鋪即可）*/
  grouped?: boolean;
  isCollapsed?: (colTitle: string, catKey: string, idx: number) => boolean;
  onToggleGroup?: (colTitle: string, catKey: string) => void;
}) {
  const tr = useT();
  // 只有一組時不必分組（例：套了分類篩選）—— 多一層組頭只是噪音
  const groups = grouped ? groupByCategory(tickets) : [];
  const useGroups = grouped && groups.length > 1;
  // 空欄收起來 —— 留一個 400px 高的空框沒有資訊量，只是噪音（prod 分布 13/0/2）
  return (
    <div className={`kb-col${tickets.length === 0 ? " is-empty" : ""}`}>
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
          <div className="kb-empty">{emptyLabel ?? tr("kb.emptyCol", { col: title })}</div>
        )}
        {useGroups
          ? groups.map((g, idx) => {
            const collapsed = isCollapsed?.(title, g.key, idx) ?? false;
            return (
              <div className={`kb-grp${collapsed ? " is-collapsed" : ""}`} key={g.key}>
                <button className="kb-grp-hdr" onClick={() => onToggleGroup?.(title, g.key)} aria-expanded={!collapsed}>
                  <span className="kb-grp-chev" aria-hidden>{collapsed ? "▸" : "▾"}</span>
                  <span className={`kb-cdot kb-avatar-${catTone(g.key)}`} aria-hidden />
                  <span className="kb-grp-title">{g.label}</span>
                  <span className="kb-grp-count">{tr("kb.nCards", { n: g.items.length })}</span>
                </button>
                {!collapsed && (
                  <div className="kb-grp-body">
                    {g.items.map((t) => (
                      <TicketCard key={t.ticketId} t={t} tone={tone} onOpen={() => onOpen(t)} inGroup />
                    ))}
                  </div>
                )}
              </div>
            );
          })
          : tickets.map((t) => (
            <TicketCard key={t.ticketId} t={t} tone={tone} onOpen={() => onOpen(t)} />
          ))}
      </div>
    </div>
  );
}

function TicketCard({ t, tone, onOpen, inGroup }: {
  t: WarroomKanbanTicket; tone: Tone; onOpen: () => void;
  /** 在分類組內 → 分類已在組頭寫過，卡片就不再重複（改讓來源群組出頭）*/
  inGroup?: boolean;
}) {
  const tr = useT();
  // 高信度是本看板預設（sub 已說明）· 逐卡標「信度高」反成雜訊 · 只在中/低時提醒審核者留意
  const confChip = t.confidence === "medium"
    ? { label: tr("kb.confMid"), level: "mid", tip: tr("kb.confMidTip") }
    : t.confidence === "low"
      ? { label: tr("kb.confLow"), level: "low", tip: tr("kb.confLowTip") }
      : null;
  // 逾時要顯「量級」不只是「在逾時欄」—— 逾 1 天和逾 15 天的處理順序完全不同
  // ⚠️ 改吃後端算好的 overdueDays：prod 的 due_at 100% 是 null，
  //    只吃 due_at 的舊寫法讓這個 pill **從來沒顯示過**
  //    （design-research-taskboard.md §4 那行 ⬜ 掛了五天的真正原因）
  const overdueDays = tone === "danger" ? t.overdueDays : null;
  const dueText = t.dueAt && overdueDays == null ? formatDate(t.dueAt) : null;
  const who = t.assigneeDisplayName;

  return (
    <button className="kb-card" onClick={onOpen}>
      <span className={`kb-stripe kb-stripe-${tone}`} aria-hidden />
      <div className="kb-card-summary">{t.summary}</div>
      <div className="kb-card-meta">
        {t.groupName && <span className="kb-group" title={tr("kb.fromGroup", { g: t.groupName })}>{t.groupName}</span>}
        {!inGroup && t.category && <span className="kb-tag">{catLabel(t.category, t.categoryName)}</span>}
        {confChip && (
          <span className={`kb-conf kb-conf-${confChip.level}`} title={confChip.tip}>
            <span className="kb-conf-d" aria-hidden />
            {confChip.label}
          </span>
        )}
        {overdueDays != null && <span className="kb-over">{tr("kb.overdueDays", { n: overdueDays })}</span>}
        {/* 卡住＝**量級**不是歸屬（design-research-taskboard.md §2 弱點 #3）。
            沿用 V3 已裁定的實心 pill，形用 ● 圓點與「逾時」的無形做區隔 ——
            色＋形＋字三重編碼，不只靠顏色。正常的卡片不長這個 pill。 */}
        {t.stuckDays != null && (
          <span className={`kb-stuck${t.stuckKind === "unassigned" ? " hot" : ""}`}>
            <span className="kb-stuck-d" aria-hidden />
            {tr("kb.stuck", { n: t.stuckDays ?? 0, kind: tr(t.stuckKind === "unassigned" ? "kb.stuckUnassigned" : "kb.stuckNoReport") })}
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
          <span className="kb-who kb-unclaimed">{tr("kb.unclaimed")}{who ? `：${who}` : ""}</span>
        ) : who ? (
          <span className="kb-who">
            <span className={`kb-avatar kb-avatar-${avatarTone(who)}`} aria-hidden>{who.slice(0, 1)}</span>
            {who}
          </span>
        ) : <span className="kb-who kb-unassigned">{tr("kb.unassigned")}</span>}
        {/* 不顯示「已同步到某某系統」—— 各家用的系統不同，而且我方目前也沒有同步功能。
            已核對欄改顯示誰核對的。*/}
        <span>{tone === "ok" && t.confirmedByName ? tr("kb.verifiedBy", { name: t.confirmedByName }) : t.departmentName ?? ""}</span>
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

// 分類色 · 沿用同一組色盤與雜湊法。
// ⚠️ 分類是**開放字串**（WTB-M2 category_registry 動態註冊），不可寫死清單 ——
//    用雜湊配色，新分類自動有顏色且同名恆同色。
const UNCAT = "__uncat__";
function catTone(category: string): string {
  return avatarTone(category || UNCAT);
}

/** 依分類分組 · 張數多的排前面（主管先處理大宗）· 未分類墊底 */
function groupByCategory(tickets: WarroomKanbanTicket[]): Array<{ key: string; label: string; items: WarroomKanbanTicket[] }> {
  const map = new Map<string, WarroomKanbanTicket[]>();
  for (const t of tickets) {
    const key = t.category || UNCAT;
    const arr = map.get(key) ?? [];
    arr.push(t);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([key, items]) => ({ key, label: key === UNCAT ? t("kb.uncategorized") : catLabel(key, items[0]?.categoryName), items }))
    .sort((a, b) => (a.key === UNCAT ? 1 : b.key === UNCAT ? -1 : 0) || b.items.length - a.items.length);
}

// 手動派發 · 導入期的主要流程
// 員工還沒綁定 LINE 時 AI 對不到人，由主管指定；綁定普及後自動歸屬會接手，此處仍可覆寫。
function AssignBox({ ticket, onAssigned }: { ticket: WarroomKanbanTicket; onAssigned: () => void }) {
  const tr = useT();
  const [members, setMembers] = useState<AssignableMember[] | null>(null);
  const [open, setOpen] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const NOTIFY_SKIP_LABEL: Record<string, string> = {
  no_binding: "kb.skip.no_binding",
  no_bot: "kb.skip.no_bot",
  disabled: "kb.skip.disabled",
  already_notified: "kb.skip.already_notified",
  push_failed: "kb.skip.push_failed",
};

async function pick(userId: string | null) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await assignTicket(ticket.ticketId, userId);
      // ⚠️ 通知結果一定要說出來。只講「已派給 X」而私訊沒送出的話，
      //    主管會以為對方知道了，事情就卡在那裡（FMEA A-1 · P0）。
      toast.show(
        !userId ? tr("kb.returnedToUnclaimed")
          : r.notified ? tr("kb.assignedNotified", { name: r.assigneeName ?? "" })
          : tr("kb.assignedNotNotified", { name: r.assigneeName ?? "", why: tr(NOTIFY_SKIP_LABEL[r.notifySkipReason ?? "push_failed"]) }),
        !userId || r.notified ? "ok" : "warn",
      );
      setOpen(false);
      onAssigned();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : tr("kb.assignFailed"), "danger"); }
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
        <span className="ab-lbl">{tr("kb.owner")}</span>
        <span className="ab-val">
          {current ?? (ticket.assignStatus === "unclaimed"
            ? <>{tr("kb.unclaimed")}{ticket.assigneeDisplayName ? <span className="ab-hint">{tr("kb.aiReadName", { name: ticket.assigneeDisplayName })}</span> : null}</>
            : tr("kb.unassigned"))}
        </span>
        <button className="nc-lnk" onClick={() => void toggle()}>{open ? tr("common.cancel") : tr(current ? "kb.reassign" : "kb.assign")}</button>
      </div>

      {/* ⚠️ 知會刻意是**指派之外的獨立動作**（台灣福祉 ④ · OQ-TWH-5）：
          指派現在是「一次點擊、零個選擇」，把勾選塞進去會讓每次指派都多一輪判斷，
          而「要讓別人也知道」是少數情況。所以另開一列，不動主流程。 */}
      <div className="ab-row">
        <span className="ab-lbl">{tr("kb.alsoNotify")}</span>
        <span className="ab-val ab-hint">{tr("kb.alsoNotifyHint")}</span>
        <button className="nc-lnk" onClick={() => setCcOpen((v) => !v)}>{ccOpen ? tr("common.cancel") : tr("kb.pickPeople")}</button>
      </div>
      {ccOpen && (
        <CcPicker
          ticketId={ticket.ticketId}
          excludeUserId={ticket.assigneeUserId}
          onDone={() => setCcOpen(false)}
        />
      )}
      {open && (
        <div className="ab-opts">
          {members === null ? <span className="ab-hint">{tr("common.loading")}</span>
            : members.length === 0 ? <span className="ab-hint">{tr("kb.noAssignable")}</span>
            : (<>
                {members.map((m) => (
                  <button key={m.userId} className="ab-opt" onClick={() => void pick(m.userId)} disabled={busy}>
                    {m.name}
                    {/* 沒綁 LINE 不影響手動派發（日報走網頁登入），只影響之後能不能自動歸屬 */}
                    {!m.hasLineBinding && <span className="ab-nobind">{tr("kb.noLine")}</span>}
                  </button>
                ))}
                {current && <button className="ab-opt ab-clear" onClick={() => void pick(null)} disabled={busy}>{tr("kb.returnToUnclaimed")}</button>}
              </>)}
        </div>
      )}
    </div>
  );
}

// 來源原文對照 · 預設收合（多數時候直接簽，需要時才展開）
function SourceMessages({ ticketId }: { ticketId: string }) {
  const tr = useT();
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
    catch (e) { setErr(e instanceof Error ? e.message : tr("common.loadFailed")); }
    finally { setLoading(false); }
  }

  return (
    <div className="ts-wrap">
      <button className="ts-toggle" onClick={() => void toggle()}>
        {open ? tr("kb.hideSource") : tr("kb.showSource")}
      </button>
      {open && (
        <div className="ts-body">
          {loading && <div className="ts-note">{tr("common.loading")}</div>}
          {err && <div className="ts-note">{err}</div>}
          {data && data.unavailableReason && <div className="ts-note">{data.unavailableReason}</div>}
          {data && <SourceMessageList data={data} />}
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
  const tr = useT();
  const created = useMemo(() => ticket ? formatDateTime(ticket.createdAt) : "", [ticket]);
  const confirmed = useMemo(() => ticket?.confirmedAt ? formatDateTime(ticket.confirmedAt) : "", [ticket]);
  if (!ticket) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-hdr">
          <h3>{tr("kb.detail")}</h3>
          <button className="drawer-close" onClick={onClose} aria-label={tr("common.close")}>×</button>
        </div>
        <div className="drawer-body">
          <div className="drawer-summary">{ticket.summary}</div>

          <dl className="drawer-meta">
            {ticket.groupName && (<><dt>{tr("kb.fldGroup")}</dt><dd>{ticket.groupName}</dd></>)}
            {ticket.category && (<><dt>{tr("kb.fldCategory")}</dt><dd>{catLabel(ticket.category, ticket.categoryName)}</dd></>)}
            {ticket.departmentName && (<><dt>{tr("kb.fldDept")}</dt><dd>{ticket.departmentName}</dd></>)}
            {ticket.assigneeDisplayName && (<><dt>{tr("kb.fldAssignee")}</dt><dd>{ticket.assigneeDisplayName}</dd></>)}
            {ticket.dueAt && (<><dt>{tr("kb.fldDue")}</dt><dd>{formatDate(ticket.dueAt)}</dd></>)}
            <dt>{tr("kb.fldCreated")}</dt><dd>{created}</dd>
            {ticket.confirmedAt && (<><dt>{tr("kb.fldVerified")}</dt><dd>{ticket.confirmedByName ?? "—"} · {confirmed}</dd></>)}
            <dt>{tr("kb.fldStatus")}</dt><dd>{confirmLabel(ticket.confirmStatus)}</dd>
          </dl>

          <AssignBox ticket={ticket} onAssigned={onAssigned} />

          {/* 核對的人一定要看得到原文 —— AI 只是輔助，看不到原文就是幫 AI 背書 */}
          <SourceMessages ticketId={ticket.ticketId} />

          {ticket.sourceUploadId && canOpenConvoDetail() && (
            <div className="drawer-source">
              <button className="nc-lnk" onClick={() => {
                navigateTo({ page: "convo-detail", uploadId: ticket.sourceUploadId as number });
                onClose();
              }}>{tr("kb.viewFullDay")}</button>
            </div>
          )}
        </div>
        <div className="drawer-foot">
          {/* 工作狀態（第四條軸）· 只有已核對的才有意義 ——
              還在核對佇列的，主管的動作是「核對」不是「補登結束」 */}
          {ticket.confirmStatus === "已簽核" && (
            <WorkStatusBox ticket={ticket} onChanged={onAssigned} />
          )}
          {ticket.confirmStatus === "待簽核" || ticket.confirmStatus === "逾時警示" ? (
            <button className="btn btn-primary" onClick={() => onSignoff(ticket)} disabled={signing}>
              {signing ? tr("wr.verifying") : tr("kb.verifyThis")}
            </button>
          ) : (
            <span className="drawer-note">{tr("wr.tipConfirmed")}</span>
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

// 空看板上的「立即分析」· custom onboarding（空狀態當老師）
//
// ⚠️ 不自己做防連點：後端 `POST /warroom/batches/rerun` 已有**每租戶 5 分鐘限流**，
//    自己再做一套只會兩邊不一致。這裡只負責把 429 的中文訊息好好呈現。
function TriggerAnalysisButton() {
  const tr = useT();
  const toast = useToast();
  const [running, setRunning] = useState(false);
  return (
    <button
      className="btn btn-primary"
      disabled={running}
      onClick={async () => {
        setRunning(true);
        try {
          const r = await triggerWarroomBatchRerun();
          toast.show(
            r.completed > 0
              ? tr("kb.analysisDone", { total: r.total, done: r.completed })
              : tr("kb.analysisEmpty", { total: r.total }),
            r.completed > 0 ? "ok" : "info",
          );
          window.location.reload();
        } catch (e) {
          toast.show(e instanceof ApiError ? e.message : tr("kb.triggerFailed"), "danger");
        } finally {
          setRunning(false);
        }
      }}
    >
      {running ? tr("kb.analysing") : tr("kb.analyseNow")}
    </button>
  );
}

/**
 * 知會其他人 · 多選後一次送出。
 *
 * 自己載成員名單，不共用 AssignBox 的 `toggle()` —— 那個會順便打開指派面板。
 * ⚠️ 排除當責人：他已經收過指派通知了（後端也會再擋一次，這裡是不要讓人選得到）。
 */
function CcPicker({ ticketId, excludeUserId, onDone }: {
  ticketId: string;
  excludeUserId: string | null;
  onDone: () => void;
}) {
  const tr = useT();
  const [members, setMembers] = useState<AssignableMember[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    getAssignableMembers()
      .then((r) => { if (alive) setMembers(r.members.filter((m) => m.userId !== excludeUserId)); })
      .catch(() => { if (alive) setMembers([]); });
    return () => { alive = false; };
  }, [excludeUserId]);

  const toggleOne = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else if (n.size < 5) n.add(id);          // 後端上限 5，這裡先擋住不讓人白按
    else toast.show(tr("kb.max5"), "warn");
    return n;
  });

  async function send() {
    if (picked.size === 0 || busy) return;
    setBusy(true);
    try {
      const r = await notifyOthers(ticketId, [...picked]);
      // ⚠️ 逐一講結果 —— 只說「已通知」而其中一個沒送到，
      //    主管會以為對方都知道了（同指派通知那條 A-1 的判準）
      const ok = r.results.filter((x) => x.notified);
      const bad = r.results.filter((x) => !x.notified);
      toast.show(
        bad.length === 0
          ? tr("kb.notified", { names: ok.map((x) => x.name ?? "").join("、") })
          : tr("kb.notifiedPartial", { n: ok.length, who: bad.map((x) => x.name ?? "?").join("、") }),
        bad.length === 0 ? "ok" : "warn",
      );
      onDone();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : tr("kb.notifyFailed"), "danger");
    } finally { setBusy(false); }
  }

  if (members === null) return <div className="ab-opts"><span className="ab-hint">{tr("common.loading")}</span></div>;
  if (members.length === 0) return <div className="ab-opts"><span className="ab-hint">{tr("kb.noOthers")}</span></div>;

  return (
    <div className="ab-opts">
      {members.map((m) => (
        <button
          key={m.userId}
          className={`ab-opt${picked.has(m.userId) ? " is-picked" : ""}`}
          onClick={() => toggleOne(m.userId)}
          disabled={busy}
        >
          <span className="ab-check" aria-hidden>{picked.has(m.userId) ? "✓" : ""}</span>
          {m.name}
          {/* 沒綁 LINE 就收不到私訊 —— 先講，不要讓人選了才發現 */}
          {!m.hasLineBinding && <span className="ab-nobind">{tr("kb.noLineCantReach")}</span>}
        </button>
      ))}
      <button className="btn btn-primary ab-send" onClick={() => void send()} disabled={busy || picked.size === 0}>
        {busy ? tr("kb.sending") : tr("kb.notifyN", { n: picked.size })}
      </button>
    </div>
  );
}
