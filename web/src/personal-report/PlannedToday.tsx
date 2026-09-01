/**
 * 「今日預定」· calendar-sync M4 · docs/mockup/calendar-today-plan.html
 *
 * 先前記下、預定在這一天要做的事。兩個來源合成一份（後端合好了）：
 * 群組任務卡的 `due_at`、以及先前**私訊**日報裡記下的 `dueAt`。
 *
 * ⚠️ **不自動寫進日報**。事情可能沒去成、可能改期 —— 由本人按一下才算數，
 *    跟「指派給我的任務」同一個原則。
 *
 * ⚠️ 版型**沿用「指派給我的任務」那一區的形狀**（`.pdr-raw-list` + 每列一顆
 *    「加入日報」），這是 mockup 明訂的：同樣的東西不要有兩種長相，
 *    而且幾乎不需要新的 CSS。不要在這裡發明新樣式。
 *
 * ⚠️ 獨立成檔不是潔癖：MyDailyReport.tsx 已經 622 行、過了 400 的紅線。
 */
import type { PlannedTodayItem } from "../api";
import { useT } from "../i18n/useT";

export function PlannedToday({ items, canEdit, onAdd }: {
  items: PlannedTodayItem[];
  canEdit: boolean;
  onAdd: (p: PlannedTodayItem) => void;
}) {
  const tr = useT();
  if (items.length === 0) return null;

  return (
    <div className="pdr-raw-list" style={{ marginBottom: 16, borderColor: "var(--primary)" }}>
      <div className="pdr-raw-hdr">
        {tr("pdr.plannedA")}<b>{items.length}</b>{tr("pdr.plannedB")}
      </div>
      {items.map((p) => (
        <div key={p.key} className="pdr-raw-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* ⚠️ 整天事件顯示「—」不是 00:00 —— 後者看起來像半夜有事 */}
            <span className="pdr-raw-time" style={{ paddingTop: 0 }}>{p.time ?? "—"}</span>
            <div className="pdr-raw-text" style={{ flex: 1 }}>{p.title}</div>
            <button className="btn btn-sm" disabled={!canEdit} onClick={() => onAdd(p)}>
              {tr("pdr.addToReport")}
            </button>
          </div>
          {/* 「8/21 記下」·「只寫了日期沒有時間」—— 讓人判斷這條可不可信，
              不然他看到一個不記得講過的行程，只能猜 */}
          <PlannedMeta item={p} />
        </div>
      ))}
    </div>
  );
}

function PlannedMeta({ item }: { item: PlannedTodayItem }) {
  const tr = useT();
  const parts: string[] = [];
  if (item.noteDate) parts.push(`${item.noteDate} ${tr("pdr.plannedNotedOn")}`);
  if (item.dueText) parts.push(item.dueText);
  if (item.time === null) parts.push(tr("pdr.plannedAllDay"));
  if (parts.length === 0) return null;
  return (
    <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4, paddingLeft: 56 }}>
      {parts.join(" · ")}
    </div>
  );
}
