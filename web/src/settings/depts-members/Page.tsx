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
import { usePermissions } from "../../permission/PermissionContext";
import { useToast } from "../../Toast";
import { Departments } from "./Departments";
import { Members } from "./Members";

type Tab = "dept" | "member";

// 部門 / 成員管理 · v2 分權 · tenant_admin 可管自 tenant
// 對照 docs/roles-permissions-matrix.md §3.5
// initialTab：讓「權限設定教學」的「帶我去新增成員」能直接落在成員分頁
export default function DepartmentsMembers({ initialTab, onOpenGuide }: { initialTab?: Tab; onOpenGuide?: () => void } = {}) {
  const session = getSession();
  const toast = useToast();
  const perms = usePermissions();
  // View gate · 任一 view perm
  const canView = perms.hasAny("departments:view", "users:view");
  // Edit gate · 任一 manage perm
  const canEdit = perms.hasAny(
    "departments:manage-tenant", "departments:manage",
    "users:create-group-owner", "users:manage",
  );
  // 跨租戶切換是 aiproot / consultant 專屬 · 用角色判（對照矩陣 §5.2）
  // 不可用 perms.has("tenants:view") · tenant_admin 也有該 perm（看自租戶設定）· 會被誤當 aiproot
  const canSwitchTenant = session?.role === "aiproot_admin" || session?.role === "consultant";

  const [tenants, setTenants] = useState<Array<{ tenantId: string; tenantName: string }>>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [tab, setTab] = useState<Tab>(initialTab ?? "dept");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const loadTenants = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    // tenant_admin 自動用 own tenant · 不呼跨 tenant list API
    if (!canSwitchTenant && session?.tenantId) {
      setTenants([{ tenantId: session.tenantId, tenantName: "本公司" }]);
      setSelectedTenantId(session.tenantId);
      setLoading(false);
      return;
    }
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
  }, [canView, canSwitchTenant, selectedTenantId, session?.tenantId, toast]);

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
          <div>你的角色無權管理部門 / 成員 · 請聯繫管理員</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>部門 / 成員</h1>
          <div className="sub">
            {canSwitchTenant
              ? "aiproot 側維護所有客戶方組織 · 部門建立後於「LINE 機器人管理」把群組分派到部門"
              : "管理本公司部門與部門主管 · 部門建立後，到左側「LINE 群組」頁把各群組分派到對應部門（一個部門可含多個群）"}
          </div>
        </div>
        {onOpenGuide && !canSwitchTenant && (
          <div className="actions">
            <button className="btn" onClick={onOpenGuide}>📖 第一次設定？看教學</button>
          </div>
        )}
      </div>

      {/* Tenant selector (只 aiproot / consultant 顯示) */}
      {canSwitchTenant && (
      <div className="dm-tenant-picker">
        <label className="dm-tenant-lbl">目前操作公司</label>
        <Select
          className="llm-select"
          selectedKey={selectedTenantId || undefined}
          onSelectionChange={(k) => setSelectedTenantId(String(k))}
          aria-label="租戶"
          isDisabled={loading || tenants.length === 0}
        >
          <AriaButton className="llm-select-btn dm-tenant-btn">
            <SelectValue className="llm-select-value">
              {() => selectedTenant?.tenantName ?? (loading ? "載入中…" : "選擇公司")}
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
      )}

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
