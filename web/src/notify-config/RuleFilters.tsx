import StyledSelect from "../shared/StyledSelect";
import type { NotifyRuleRow } from "../api";

// 規則清單的篩選列 + 比對邏輯。
//
// 刻意不做查詢語法（`key:value`）—— Datadog 要學語法、Grafana 的 label 篩選要寫
// Prometheus matcher（RE2、大小寫敏感），對業助這個 persona 是廢的。
// 四個下拉 + 一個全文搜尋就夠。
//
// 分頁做在前端：目前 10 條規則，可預見是數十到數百。後端分頁沒有收益，
// 還會讓每次改篩選都多一次來回。紀錄頁才需要 server-side（筆數單調成長）。

export const PAGE_SIZE = 20;

export interface RuleFilterState {
  q: string;
  account: string;
  sourceType: string;
  event: string;
  enabled: string;
}

export const EMPTY_FILTERS: RuleFilterState = { q: "", account: "", sourceType: "", event: "", enabled: "" };

const EVENTS = [
  { id: "新增", label: "有新增時" },
  { id: "更新", label: "有更新時" },
  { id: "刪除", label: "有刪除時" },
];

/**
 * 搜尋比對規則名、來源路徑、通知對象**與通知欄位名**。
 * 只比對名稱的話，「哪條規則會通知『客戶簽回』」就找不到 —— Zapier 正是這樣，
 * 社群長年抱怨搜不到「用了哪張表」。
 */
export function matchRule(r: NotifyRuleRow, f: RuleFilterState): boolean {
  if (f.account && r.accountDisplayName !== f.account) return false;
  if (f.sourceType && r.sourceType !== f.sourceType) return false;
  if (f.event && !r.eventsLabel.includes(f.event)) return false;
  if (f.enabled && String(r.enabled) !== f.enabled) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return [r.name, r.sourceLabel, r.channelLabel, r.accountDisplayName ?? "", ...r.fieldLabels]
    .some((s) => s.toLowerCase().includes(q));
}

export default function RuleFilters({ rules, value, onChange }: {
  rules: NotifyRuleRow[];
  value: RuleFilterState;
  onChange: (next: RuleFilterState) => void;
}) {
  const accounts = [...new Set(rules.map((r) => r.accountDisplayName).filter((x): x is string => !!x))];
  const set = (patch: Partial<RuleFilterState>) => onChange({ ...value, ...patch });
  const active: Array<{ key: keyof RuleFilterState; label: string }> = [];
  if (value.q) active.push({ key: "q", label: `搜尋：${value.q}` });
  if (value.account) active.push({ key: "account", label: `客戶：${value.account}` });
  if (value.sourceType) active.push({ key: "sourceType", label: value.sourceType === "ragic_form" ? "來源：Ragic 表單" : "來源：系統事件" });
  if (value.event) active.push({ key: "event", label: `觸發：${EVENTS.find((e) => e.id === value.event)?.label ?? value.event}` });
  if (value.enabled) active.push({ key: "enabled", label: value.enabled === "true" ? "狀態：啟用" : "狀態：停用" });

  return (
    <>
      <div className="nc-tb">
        <div className="nc-tb-search">
          <input className="tf" value={value.q} onChange={(e) => set({ q: e.target.value })}
            placeholder="搜尋規則名稱、表單路徑、群組名稱或通知欄位" />
        </div>
        <StyledSelect ariaLabel="客戶" value={value.account} onChange={(v) => set({ account: v })}
          allowEmpty emptyLabel="全部客戶" placeholder="全部客戶"
          items={accounts.map((a) => ({ id: a, label: a }))} />
        <StyledSelect ariaLabel="來源" value={value.sourceType} onChange={(v) => set({ sourceType: v })}
          allowEmpty emptyLabel="全部來源" placeholder="全部來源"
          items={[{ id: "ragic_form", label: "Ragic 表單" }, { id: "internal_event", label: "系統事件" }]} />
        <StyledSelect ariaLabel="觸發" value={value.event} onChange={(v) => set({ event: v })}
          allowEmpty emptyLabel="全部觸發" placeholder="全部觸發" items={EVENTS} />
        <StyledSelect ariaLabel="狀態" value={value.enabled} onChange={(v) => set({ enabled: v })}
          allowEmpty emptyLabel="全部狀態" placeholder="全部狀態"
          items={[{ id: "true", label: "啟用" }, { id: "false", label: "停用" }]} />
      </div>

      {/* 已套用的條件 · 查證的五個競品沒有一個做這件事，
          但「為什麼只剩三筆」正是最常見的困惑 */}
      {active.length > 0 && (
        <div className="nc-chips">
          <span className="nc-chips-lbl">已套用</span>
          {active.map((a) => (
            <span key={a.key} className="nc-chip">
              {a.label}
              <button className="nc-chip-x" aria-label={`移除 ${a.label}`}
                onClick={() => set({ [a.key]: "" } as Partial<RuleFilterState>)}>✕</button>
            </span>
          ))}
          <button className="nc-chips-clear" onClick={() => onChange(EMPTY_FILTERS)}>清除全部</button>
        </div>
      )}
    </>
  );
}
