import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";
import {
  getLineRefs,
  getSession,
  ApiError,
} from "../../api";
import { useToast } from "../../Toast";
import { Departments } from "./Departments";
import { Members } from "./Members";

type Tab = "dept" | "member";

// 部門 / 成員管理 · aiproot 統包客戶方組織
// 頂部 tenant selector (aiproot 選看哪家客戶) · 底下 tab (部門 / 成員) 各自 CRUD
export default function DepartmentsMembers() {
  const session = getSession();
  const toast = useToast();
  const canView = session?.role === "aiproot_admin" || session?.role === "consultant";
  const canEdit = session?.role === "aiproot_admin";

  const [tenants, setTenants] = useState<Array<{ tenantId: string; tenantName: string }>>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("dept");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const loadTenants = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    try {
      const refs = await getLineRefs();
      setTenants(refs.tenants);
      if (refs.tenants.length > 0 && !selectedTenantId) {
        setSelectedTenantId(refs.tenants[0].tenantId);
      }
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入租戶失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [canView, selectedTenantId, toast]);

  useEffect(() => { loadTenants(); }, [loadTenants]);

  const triggerReload = useCallback(() => setReloadKey((k) => k + 1), []);
  const selectedTenant = useMemo(
    () => tenants.find((t) => t.tenantId === selectedTenantId),
    [tenants, selectedTenantId],
  );

  if (!canView) {
    return (
      <div className="pane">
        <div className="pane-hdr"><div><h1>部門 / 成員</h1></div></div>
        <div className="dm-empty">
          <div>此頁僅限 aiproot 平台方管理</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>部門 / 成員</h1>
          <div className="sub">aiproot 側維護客戶方組織 · 部門建立後可在「LINE 機器人管理」綁定群組</div>
        </div>
      </div>

      {/* Tenant selector */}
      <div className="dm-tenant-picker">
        <label className="dm-tenant-lbl">目前操作租戶</label>
        <Select
          className="llm-select"
          selectedKey={selectedTenantId || undefined}
          onSelectionChange={(k) => setSelectedTenantId(String(k))}
          aria-label="租戶"
          isDisabled={loading || tenants.length === 0}
        >
          <AriaButton className="llm-select-btn dm-tenant-btn">
            <SelectValue className="llm-select-value">
              {() => selectedTenant?.tenantName ?? (loading ? "載入中…" : "選擇租戶")}
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

      {/* Tabs */}
      <div className="dm-tabs">
        <button className={`dm-tab${tab === "dept" ? " active" : ""}`} onClick={() => setTab("dept")}>
          部門配置
        </button>
        <button className={`dm-tab${tab === "member" ? " active" : ""}`} onClick={() => setTab("member")}>
          成員
        </button>
      </div>

      {!selectedTenantId ? (
        <div className="dm-empty">
          <div>{loading ? "載入中…" : "請選擇租戶"}</div>
        </div>
      ) : tab === "dept" ? (
        <Departments
          key={`dept-${selectedTenantId}-${reloadKey}`}
          tenantId={selectedTenantId}
          canEdit={canEdit}
          onChanged={triggerReload}
        />
      ) : (
        <Members
          key={`mem-${selectedTenantId}-${reloadKey}`}
          tenantId={selectedTenantId}
          canEdit={canEdit}
          onChanged={triggerReload}
        />
      )}
    </div>
  );
}
