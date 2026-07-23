import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  createRole,
  deleteRole,
  listPermissions,
  listRoles,
  renameRole,
  updateRolePermissions,
  type PermissionDto,
  type RoleDto,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";

// PE-M5 · 權限管理 UI
// 對照 docs/roles-permissions-matrix.md + docs/modules/permission-engine.md §5.3
export default function RolesManagement() {
  const toast = useToast();
  const [allPerms, setAllPerms] = useState<PermissionDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingPerms, setEditingPerms] = useState<Set<string>>(new Set());
  const [createDialog, setCreateDialog] = useState(false);
  const [renameDialog, setRenameDialog] = useState<RoleDto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RoleDto | null>(null);
  const [newRoleKey, setNewRoleKey] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [renameValue, setRenameValue] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [permsRes, rolesRes] = await Promise.all([listPermissions(), listRoles()]);
      setAllPerms(permsRes.permissions);
      setRoles(rolesRes.roles);
      if (rolesRes.roles.length > 0 && !selectedRoleId) {
        setSelectedRoleId(rolesRes.roles[0].roleId);
      }
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [selectedRoleId, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.roleId === selectedRoleId),
    [roles, selectedRoleId],
  );

  // Load 選中 role 的 perms 進 editingPerms
  useEffect(() => {
    if (selectedRole) setEditingPerms(new Set(selectedRole.permissions));
  }, [selectedRole]);

  // 按 resource 分組
  const permsByResource = useMemo(() => {
    const map = new Map<string, PermissionDto[]>();
    for (const p of allPerms) {
      const list = map.get(p.resource) ?? [];
      list.push(p);
      map.set(p.resource, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [allPerms]);

  function togglePerm(permId: string) {
    setEditingPerms((s) => {
      const next = new Set(s);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
  }

  async function savePerms() {
    if (!selectedRole) return;
    setBusy(true);
    try {
      await updateRolePermissions(selectedRole.roleId, Array.from(editingPerms));
      toast.show(`${selectedRole.roleName} 權限已更新`, "ok");
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "更新失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function doCreate() {
    if (!newRoleKey.trim() || !newRoleName.trim()) return;
    setBusy(true);
    try {
      await createRole({
        roleKey: newRoleKey.trim(),
        roleName: newRoleName.trim(),
        tenantId: null,
        permissionIds: [],
      });
      toast.show(`已建立 ${newRoleName}`, "ok");
      setCreateDialog(false);
      setNewRoleKey("");
      setNewRoleName("");
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "建立失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function doRename() {
    if (!renameDialog || !renameValue.trim()) return;
    setBusy(true);
    try {
      await renameRole(renameDialog.roleId, renameValue.trim());
      toast.show(`已改名為 ${renameValue.trim()}`, "ok");
      setRenameDialog(null);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "改名失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await deleteRole(confirmDelete.roleId);
      toast.show(`已刪除 ${confirmDelete.roleName}`, "ok");
      setConfirmDelete(null);
      void refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "刪除失敗", "danger");
    } finally {
      setBusy(false);
    }
  }

  const dirty = selectedRole && (
    editingPerms.size !== selectedRole.permissions.length ||
    !selectedRole.permissions.every((p) => editingPerms.has(p))
  );

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>權限管理</h1>
          <div className="sub">
            管理系統內 role · 每個 role 的 permission 打勾配置 · 內建 role 可改權限但不可刪 / 改代號
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateDialog(true)} disabled={busy}>
          + 新增自訂角色
        </button>
      </div>

      {loading && roles.length === 0 ? (
        <div className="dm-empty">載入中…</div>
      ) : (
        <div className="rm-layout">
          {/* Left · Role list */}
          <aside className="rm-sidebar">
            <div className="rm-sidebar-hdr">角色（{roles.length}）</div>
            {roles.map((r) => (
              <button
                key={r.roleId}
                className={`rm-role-item${selectedRoleId === r.roleId ? " active" : ""}`}
                onClick={() => setSelectedRoleId(r.roleId)}
              >
                <div className="rm-role-name">
                  {r.roleName}
                  {r.isSystem && <span className="rm-role-badge">內建</span>}
                </div>
                <div className="rm-role-key">{r.roleKey}</div>
                <div className="rm-role-perms">{r.permissions.length} 項權限</div>
              </button>
            ))}
          </aside>

          {/* Right · Permission editor */}
          <div className="rm-editor">
            {!selectedRole ? (
              <div className="dm-empty">選一個角色</div>
            ) : (
              <>
                <div className="rm-editor-hdr">
                  <div>
                    <h2 className="rm-editor-title">
                      {selectedRole.roleName}
                      {selectedRole.isSystem && <span className="rm-role-badge">內建</span>}
                    </h2>
                    <div className="rm-editor-sub">
                      代號：<code className="mono">{selectedRole.roleKey}</code>
                      {selectedRole.tenantId && <> · 租戶專屬</>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {!selectedRole.isSystem && (
                      <>
                        <button className="btn small" onClick={() => { setRenameDialog(selectedRole); setRenameValue(selectedRole.roleName); }} disabled={busy}>改名</button>
                        <button className="btn small" onClick={() => setConfirmDelete(selectedRole)} disabled={busy}>刪除</button>
                      </>
                    )}
                  </div>
                </div>

                <div className="rm-perms-scroll">
                  {permsByResource.map(([resource, perms]) => (
                    <div key={resource} className="rm-perm-group">
                      <div className="rm-perm-group-hdr">{resource}</div>
                      <div className="rm-perm-list">
                        {perms.map((p) => (
                          <label key={p.permissionId} className="rm-perm-item">
                            <input
                              type="checkbox"
                              checked={editingPerms.has(p.permissionId)}
                              onChange={() => togglePerm(p.permissionId)}
                              disabled={busy}
                            />
                            <div className="rm-perm-info">
                              <div className="rm-perm-desc">{p.description}</div>
                              <div className="rm-perm-meta">
                                <code className="mono">{p.permissionId}</code>
                                <span className={`rm-perm-scope rm-scope-${p.scope}`}>{scopeLabel(p.scope)}</span>
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rm-editor-foot">
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    已勾 <b>{editingPerms.size}</b> / {allPerms.length} 項
                    {dirty && <span style={{ color: "var(--warn-600, #D97706)" }}> · 未儲存</span>}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => setEditingPerms(new Set(selectedRole.permissions))} disabled={busy || !dirty}>取消</button>
                    <button className="btn btn-primary" onClick={() => void savePerms()} disabled={busy || !dirty}>儲存變更</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create dialog */}
      <ConfirmDialog
        open={createDialog}
        onClose={() => !busy && setCreateDialog(false)}
        onConfirm={() => void doCreate()}
        busy={busy || !newRoleKey.trim() || !newRoleName.trim()}
        title="新增自訂角色"
        body={
          <>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginBottom: 4 }}>顯示名</label>
              <input type="text" className="tf" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="例：主管副手" style={{ width: "100%" }} autoFocus />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginBottom: 4 }}>代號（英數 · 系統內部識別）</label>
              <input type="text" className="tf" value={newRoleKey} onChange={(e) => setNewRoleKey(e.target.value.toLowerCase())} placeholder="例：deputy_supervisor" style={{ width: "100%" }} />
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>建立後不可改 · 只允 a-z 0-9 _ - · 開頭需字母</div>
            </div>
          </>
        }
        confirmLabel="建立"
        tone="primary"
      />

      {/* Rename dialog */}
      <ConfirmDialog
        open={!!renameDialog}
        onClose={() => !busy && setRenameDialog(null)}
        onConfirm={() => void doRename()}
        busy={busy || !renameValue.trim()}
        title={`改名：${renameDialog?.roleName}`}
        body={
          <input type="text" className="tf" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus style={{ width: "100%" }} />
        }
        confirmLabel="改名"
        tone="primary"
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => !busy && setConfirmDelete(null)}
        onConfirm={() => void doDelete()}
        busy={busy}
        title="刪除自訂角色"
        body={confirmDelete && (
          <>
            即將刪除 <b>{confirmDelete.roleName}</b>（<code className="mono">{confirmDelete.roleKey}</code>）<br /><br />
            若有 user 使用此角色 · 需先 reassign 才能刪除。
          </>
        )}
        confirmLabel="刪除"
        tone="danger"
      />
    </div>
  );
}

function scopeLabel(scope: string): string {
  return scope === "platform" ? "平台" : scope === "tenant" ? "租戶" : scope === "department" ? "部門" : scope;
}
