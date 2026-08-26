import { useEffect, useState } from "react";
import { Button as AriaButton, ListBox, ListBoxItem, Popover, Select, SelectValue } from "react-aria-components";
import { getSession, listAiprootTenants, type AiprootTenantOption } from "../api";
import { useT } from "../i18n/useT";

/**
 * 平台角色（aiproot_admin / consultant）用來選「現在在看哪一家」。
 *
 * 客戶方角色沒有這個問題 —— 他們只有自己一家，後端 resolveTenantId 會用 JWT 的 tenant_id。
 * 所以對他們回 `null`，呼叫端不必傳 tenantId。
 *
 * @returns [tenantId, 選擇器 UI, ready]
 *   tenantId — undefined 代表「用自己的」（客戶方角色）
 *   ready    — ⚠️ 平台角色在租戶清單載回來之前是 false。
 *              沒有這個旗標的話，首次 render 會帶著空的 tenantId 就送出請求，
 *              後端 resolveTenantId 回「需指定 tenantId」，使用者一進頁面就看到紅色錯誤。
 */
export function useTenantPicker(): [string | undefined, React.ReactNode, boolean] {
  const tr = useT();
  const role = getSession()?.role;
  const isPlatform = role === "aiproot_admin" || role === "consultant";
  const [tenants, setTenants] = useState<AiprootTenantOption[]>([]);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    if (!isPlatform) return;
    listAiprootTenants().then((r) => {
      setTenants(r.tenants);
      if (r.tenants[0]) setSelected(r.tenants[0].tenantId);
    }).catch(() => undefined);
  }, [isPlatform]);

  if (!isPlatform) return [undefined, null, true];

  const ui = (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{tr("dm.tenant")}</span>
      <Select
        className="llm-select"
        selectedKey={selected}
        onSelectionChange={(k) => setSelected(String(k))}
        aria-label={tr("dm.tenant")}
        isDisabled={tenants.length === 0}
      >
        <AriaButton className="llm-select-btn" style={{ minWidth: 220 }}>
          <SelectValue className="llm-select-value">
            {() => tenants.find((t) => t.tenantId === selected)?.tenantName ?? tr("dm.pickTenant")}
          </SelectValue>
          <svg className="llm-select-chev" width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden>
            <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </AriaButton>
        <Popover className="llm-select-pop" offset={4}>
          <ListBox className="llm-select-list" items={tenants.map((t) => ({ id: t.tenantId, name: t.tenantName }))}>
            {(item) => (
              <ListBoxItem id={item.id} textValue={item.name} className="llm-select-item">
                <span>{item.name}</span>
                <svg className="llm-select-check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="m2 7 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </Select>
    </div>
  );

  return [selected || undefined, ui, !!selected];
}
