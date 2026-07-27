import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listDepartments,
  listTenantUsers,
  createTenantUser,
  updateTenantUser,
  deleteTenantUser,
  getSession,
  ApiError,
  type DepartmentDto,
  type TenantUserDto,
  type UserRole,
} from "../../api";
import { useToast } from "../../Toast";
import Drawer from "../../shared/Drawer";
import StyledSelect from "../../shared/StyledSelect";

const ROLE_LABEL: Record<UserRole, string> = {
  aiproot_admin: "AIPROOT 管理員",
  consultant: "顧問",
  tenant_admin: "總經理室",
  group_owner: "群組負責人",
};

// caller role → 可指派的 role 清單 · 對應 docs/roles-permissions-matrix.md §2
// aiproot_admin 全能 · tenant_admin 限 group_owner
function assignableRolesFor(callerRole: string | undefined): UserRole[] {
  if (callerRole === "aiproot_admin") return ["tenant_admin", "group_owner"];
  if (callerRole === "tenant_admin") return ["group_owner"];
  return [];
}

export function Members({
  tenantId, canEdit, onChanged,
}: {
  tenantId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [users, setUsers] = useState<TenantUserDto[]>([]);
  const [depts, setDepts] = useState<DepartmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<null | { kind: "new" } | { kind: "edit"; user: TenantUserDto }>(null);
  const [confirmDelete, setConfirmDelete] = useState<TenantUserDto | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, deptsRes] = await Promise.all([listTenantUsers(tenantId), listDepartments(tenantId)]);
      setUsers(usersRes.users);
      setDepts(deptsRes.departments);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      {canEdit && (
        <div className="dm-actions-bar">
          <button className="btn btn-primary" onClick={() => setDrawer({ kind: "new" })}>+ 新增成員</button>
        </div>
      )}

      {loading ? (
        <div className="dm-empty">載入中…</div>
      ) : users.length === 0 ? (
        <div className="dm-empty">
          <div>此租戶尚無成員</div>
          {canEdit && <div className="dm-empty-hint">點右上「新增成員」建立</div>}
        </div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th>顯示名稱</th>
                <th>Email</th>
                <th>角色</th>
                <th>所屬部門</th>
                <th>密碼</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId}>
                  <td>{u.displayName ?? <span className="dm-cell-muted">—</span>}</td>
                  <td className="mono dm-cell-muted">{u.email ?? "—"}</td>
                  <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="dm-cell-muted">{u.departmentName ?? "—"}</td>
                  <td>{u.hasPassword ? <span className="dm-tag-set">已設</span> : <span className="dm-tag-unset">未設</span>}</td>
                  <td className="dm-cell-actions">
                    {canEdit && (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={() => setDrawer({ kind: "edit", user: u })}>編輯</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(u)}>刪除</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drawer?.kind === "new" && (
        <MemberDrawer
          tenantId={tenantId}
          depts={depts}
          onClose={() => setDrawer(null)}
          onSaved={() => { setDrawer(null); refresh(); onChanged(); }}
        />
      )}
      {drawer?.kind === "edit" && (
        <MemberDrawer
          tenantId={tenantId}
          depts={depts}
          user={drawer.user}
          onClose={() => setDrawer(null)}
          onSaved={() => { setDrawer(null); refresh(); onChanged(); }}
        />
      )}
      {confirmDelete && (
        <Drawer open onClose={() => setConfirmDelete(null)} title="確認刪除成員" width={480}>
          <div className="lbot-confirm">
            <p>即將刪除 <b>{confirmDelete.displayName ?? confirmDelete.email}</b> · 此操作無法還原。</p>
            <div className="llm-form-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  try {
                    await deleteTenantUser(confirmDelete.userId, tenantId);
                    toast.show("成員已刪除", "ok");
                    setConfirmDelete(null);
                    refresh();
                    onChanged();
                  } catch (err) {
                    toast.show(err instanceof ApiError ? err.message : "刪除失敗", "danger");
                  }
                }}
              >
                確認刪除
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>取消</button>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}

function MemberDrawer({
  tenantId, depts, user, onClose, onSaved,
}: {
  tenantId: string;
  depts: DepartmentDto[];
  user?: TenantUserDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const session = getSession();
  const assignable = useMemo(() => assignableRolesFor(session?.role), [session?.role]);
  const isEdit = user != null;
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState(user?.email ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [role, setRole] = useState<UserRole>(user?.role ?? assignable[0] ?? "group_owner");
  const [departmentId, setDepartmentId] = useState(user?.departmentId ?? "");
  const [password, setPassword] = useState("");
  const [rotatePassword, setRotatePassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isEdit && (!email.trim() || !password.trim())) {
      toast.show("email 與密碼為必填", "danger");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await updateTenantUser(user.userId, {
          tenantId,
          role: role !== user.role ? role : undefined,
          displayName: displayName.trim() !== (user.displayName ?? "") ? (displayName.trim() || null) : undefined,
          departmentId: departmentId !== (user.departmentId ?? "") ? (departmentId || null) : undefined,
          password: rotatePassword && password.trim() ? password.trim() : undefined,
        });
      } else {
        await createTenantUser({
          tenantId,
          email: email.trim(),
          role,
          displayName: displayName.trim() || undefined,
          departmentId: departmentId || undefined,
          password: password.trim(),
        });
      }
      toast.show(isEdit ? "成員已更新" : "成員已新增", "ok");
      onSaved();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "儲存失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={isEdit ? "編輯成員" : "新增成員"} subtitle={isEdit ? (user.email ?? undefined) : undefined}>
      <form onSubmit={handleSubmit} className="llm-form">
        <div className="field">
          <label>Email *</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving || isEdit} placeholder="user@example.com" required />
          <div className="llm-hint">{isEdit ? "email 為登入識別 · 不可修改" : "登入用 · 需唯一"}</div>
        </div>

        <div className="field">
          <label>顯示名稱</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={saving} placeholder="例：王總 / 阿豪" />
        </div>

        <div className="field">
          <label>角色 *</label>
          <StyledSelect
            items={assignable.map((r) => ({ id: r, label: ROLE_LABEL[r] }))}
            value={role}
            onChange={(v) => setRole(v as UserRole)}
            disabled={saving}
            ariaLabel="角色"
          />
          <div className="llm-hint">
            {session?.role === "tenant_admin"
              ? "只可新增部門主管 (group_owner) · 總經理室級請聯繫 aiproot"
              : "此頁可新增「總經理室」與「群組負責人」帳號 · 平台管理帳號由 AIPROOT 另行建立"}
          </div>
        </div>

        <div className="field">
          <label>所屬部門</label>
          <StyledSelect
            items={depts.map((d) => ({ id: d.departmentId, label: d.departmentName }))}
            value={departmentId}
            onChange={setDepartmentId}
            disabled={saving}
            ariaLabel="所屬部門"
            allowEmpty
            emptyLabel="未分派"
          />
        </div>

        {!isEdit && (
          <div className="field">
            <label>初始密碼 *</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={saving} placeholder="至少 6 字元" required autoComplete="new-password" />
            <div className="llm-hint">bcrypt(10) 加密存 · 建議首次登入請成員自行改密碼</div>
          </div>
        )}

        {isEdit && (
          <div className="lbot-rotate">
            <label className="lbot-rotate-hdr">
              <input type="checkbox" checked={rotatePassword} onChange={(e) => setRotatePassword(e.target.checked)} disabled={saving} />
              <span>重設密碼</span>
            </label>
            {rotatePassword && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={saving}
                placeholder="新密碼（至少 6 字元）"
                required
                autoComplete="new-password"
                className="lbot-rotate-input"
              />
            )}
          </div>
        )}

        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "儲存中…" : isEdit ? "儲存變更" : "新增成員"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>取消</button>
        </div>
      </form>
    </Drawer>
  );
}
