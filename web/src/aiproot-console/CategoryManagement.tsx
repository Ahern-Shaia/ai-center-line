import Spinner from "../shared/Spinner";
import { useCallback, useEffect, useState } from "react";
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";
import {
  ApiError,
  archiveCategory,
  listAiprootTenants,
  listCategories,
  renameCategory,
  type AiprootTenantOption,
  type CategoryRegistryItem,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";

// WTB-M5 · AIPROOT 分類管理
// 對照 docs/modules/warroom-task-board.md §5.3
// 依租戶列 category · rename · archive
export default function CategoryManagement() {
  const toast = useToast();
  const [tenants, setTenants] = useState<AiprootTenantOption[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [items, setItems] = useState<CategoryRegistryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<CategoryRegistryItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmArchive, setConfirmArchive] = useState<CategoryRegistryItem | null>(null);

  useEffect(() => {
    listAiprootTenants().then((r) => {
      setTenants(r.tenants);
      if (r.tenants[0]) setSelectedTenantId(r.tenants[0].tenantId);
    }).catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    if (!selectedTenantId) return;
    setLoading(true);
    try {
      const r = await listCategories(selectedTenantId, "all");
      setItems(r.categories);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入分類失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function doRename() {
    if (!renaming || !renameValue.trim()) return;
    setBusy(true);
    try {
      await renameCategory(renaming.categoryId, renameValue.trim());
      toast.show(`已改名：${renaming.categoryName} → ${renameValue.trim()}`, "ok");
      setRenaming(null);
      setRenameValue("");
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "改名失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function doArchive() {
    if (!confirmArchive) return;
    setBusy(true);
    try {
      await archiveCategory(confirmArchive.categoryId);
      toast.show(`已封存：${confirmArchive.categoryName}`, "ok");
      setConfirmArchive(null);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "封存失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  const activeItems = items.filter((i) => i.status === "active");
  const archivedItems = items.filter((i) => i.status === "archived");

  return (
    <div className="pane">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>分類管理</h1>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
            Pipeline 產出的 AI 分類詞庫 · 可改顯示名 / 封存不用的分類
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>租戶</span>
          <Select
            className="llm-select"
            selectedKey={selectedTenantId}
            onSelectionChange={(k) => setSelectedTenantId(String(k))}
            aria-label="租戶"
            isDisabled={loading || busy || tenants.length === 0}
          >
            <AriaButton className="llm-select-btn" style={{ minWidth: 220 }}>
              <SelectValue className="llm-select-value">
                {() => tenants.find((t) => t.tenantId === selectedTenantId)?.tenantName ?? "選擇租戶"}
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
          <button className="btn" onClick={() => void refresh()} disabled={loading || busy}>重新整理</button>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <Spinner block />
      ) : items.length === 0 ? (
        <div className="dm-empty">
          尚無分類
          <div className="dm-empty-hint">此租戶的 pipeline 尚未產出任何分類 · 跑幾次對話分析後這裡會列出</div>
        </div>
      ) : (
        <>
          <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>使用中（{activeItems.length}）</h3>
          <CategoryTable items={activeItems} onRename={(c) => { setRenaming(c); setRenameValue(c.categoryName); }} onArchive={setConfirmArchive} busy={busy} />

          {archivedItems.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, margin: "20px 0 8px", color: "var(--ink-3)" }}>已封存（{archivedItems.length}）</h3>
              <CategoryTable items={archivedItems} onRename={(c) => { setRenaming(c); setRenameValue(c.categoryName); }} onArchive={setConfirmArchive} busy={busy} showArchived />
            </>
          )}
        </>
      )}

      {/* Rename modal */}
      <ConfirmDialog
        open={!!renaming}
        onClose={() => !busy && setRenaming(null)}
        onConfirm={() => void doRename()}
        busy={busy || !renameValue.trim()}
        title={`改名分類：${renaming?.categoryName}`}
        body={renaming && (
          <>
            <div style={{ marginBottom: 8 }}>
              目前顯示名：<b>{renaming.categoryName}</b><br />
              代號（不變）：<code className="mono">{renaming.categorySlug}</code>
            </div>
            <input
              type="text"
              className="tf"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="新顯示名"
              autoFocus
              style={{ width: "100%" }}
            />
          </>
        )}
        confirmLabel="改名"
        tone="primary"
      />

      {/* Archive confirm */}
      <ConfirmDialog
        open={!!confirmArchive}
        onClose={() => !busy && setConfirmArchive(null)}
        onConfirm={() => void doArchive()}
        busy={busy}
        title="封存分類"
        body={confirmArchive && (
          <>
            即將封存 <b>{confirmArchive.categoryName}</b><br />
            代號：<code className="mono">{confirmArchive.categorySlug}</code><br /><br />
            封存後：
            <ul style={{ marginLeft: 20, marginTop: 6 }}>
              <li>此分類不再顯示在使用中列表</li>
              <li>AI 分析下次不會提示此分類（但仍可能產出相同代號 · 會自動復活）</li>
              <li>已材料化為任務的分類名保留</li>
            </ul>
          </>
        )}
        confirmLabel="封存"
        tone="danger"
      />
    </div>
  );
}

function CategoryTable({
  items, onRename, onArchive, busy, showArchived,
}: {
  items: CategoryRegistryItem[];
  onRename: (c: CategoryRegistryItem) => void;
  onArchive: (c: CategoryRegistryItem) => void;
  busy: boolean;
  showArchived?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="dm-table-wrap">
      <table className="dm-table">
        <thead>
          <tr>
            <th>顯示名</th>
            <th>代號</th>
            <th style={{ textAlign: "right" }}>使用次數</th>
            <th>最後使用</th>
            <th>首次出現</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.categoryId} style={showArchived ? { opacity: 0.55 } : undefined}>
              <td className="dm-td-name">{c.categoryName}</td>
              <td className="mono" style={{ fontSize: 12 }}>{c.categorySlug}</td>
              <td style={{ textAlign: "right" }} className="mono">{c.usageCount}</td>
              <td className="mono">{formatDate(c.lastUsedAt)}</td>
              <td className="mono">{formatDate(c.firstSeenAt)}</td>
              <td>
                {!showArchived && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn small" onClick={() => onRename(c)} disabled={busy}>改名</button>
                    <button className="btn small" onClick={() => onArchive(c)} disabled={busy}>封存</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
