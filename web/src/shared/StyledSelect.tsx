import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";
import { useT } from "../i18n/useT";

// 專案統一的下拉選單 · 對齊 CategoryManagement / BindingAudit / LlmSettings 樣式
// 對照 memory feedback_grep_ui_components_before_writing · 別用 native <select>
//
// 用法：
//   <StyledSelect
//     items={[{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }]}
//     value={val}
//     onChange={setVal}
//     ariaLabel="選擇項目"
//   />
//
// 支援 allowEmpty · 加「未分派 / 全部」空選項 (label 可自訂)

export interface StyledSelectItem {
  id: string;
  label: string;
  hint?: string;    // 顯示於選項右側灰字 (e.g. 部門名或計數)
}

interface Props {
  items: StyledSelectItem[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  placeholder?: string;                     // 沒選時顯示 · default 「選擇」
  allowEmpty?: boolean;                     // 是否加「未分派」空選項
  emptyLabel?: string;                      // allowEmpty 時的 label · default 「未分派」
  width?: number | string;                  // button min-width · default "100%"
  className?: string;
}

export default function StyledSelect({
  items, value, onChange, ariaLabel, disabled,
  placeholder,
  allowEmpty = false,
  emptyLabel,
  width = "100%",
  className = "llm-select",
}: Props) {
  const tr = useT();
  const selected = items.find((it) => it.id === value);
  // React-aria Select 需要 key · 空值用特殊 key "__empty__"
  const EMPTY_KEY = "__empty__";
  const selectedKey = value || (allowEmpty ? EMPTY_KEY : undefined);
  const listItems = allowEmpty
    ? [{ id: EMPTY_KEY, label: emptyLabel ?? tr("common.unassigned"), hint: undefined }, ...items]
    : items;

  return (
    <Select
      className={className}
      selectedKey={selectedKey}
      onSelectionChange={(k) => {
        const s = String(k);
        onChange(s === EMPTY_KEY ? "" : s);
      }}
      aria-label={ariaLabel}
      isDisabled={disabled || items.length === 0}
    >
      <AriaButton className="llm-select-btn" style={{ width, minWidth: 0 }}>
        <SelectValue className="llm-select-value">
          {() => {
            if (!value && allowEmpty) return emptyLabel ?? tr("common.unassigned");
            if (!value) return placeholder ?? tr("common.choose");
            return selected?.label ?? placeholder ?? tr("common.choose");
          }}
        </SelectValue>
        <svg className="llm-select-chev" width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden>
          <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </AriaButton>
      <Popover className="llm-select-pop" offset={4}>
        <ListBox className="llm-select-list" items={listItems}>
          {(item) => (
            <ListBoxItem id={item.id} textValue={item.label} className="llm-select-item">
              <span>{item.label}</span>
              {item.hint && <span style={{ fontSize: 11, color: "var(--ink-3)", marginRight: 8 }}>{item.hint}</span>}
              <svg className="llm-select-check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="m2 7 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}
