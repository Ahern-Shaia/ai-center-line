import Spinner from "../../shared/Spinner";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listDepartments,
  listTenantUsers,
  createTenantUser,
  updateTenantUser,
  deleteTenantUser,
  assignUserDepartment,
  assignMemberRole,
  getSession,
  ApiError,
  type DepartmentDto,
  type TenantUserDto,
  type UserRole,
  listMemberGroupActivity,
  type MemberGroupActivity,
} from "../../api";
import { useToast } from "../../Toast";
import { usePermissions } from "../../permission/PermissionContext";
import Drawer from "../../shared/Drawer";
import StyledSelect from "../../shared/StyledSelect";
import { ROLE_LABEL } from "../../shared/roleLabel";

// tenant_admin 能內嵌調整的角色（碰不到 總經理室/助理/aiproot）· 對齊後端 0055 護欄
const MEMBER_EDITABLE_ROLES: UserRole[] = ["employee", "group_owner"];

/**
 * 可指派的角色清單 · 對應 `docs/roles-permissions-matrix.md` §2
 *
 * ⚠️ 這裡刻意**列舉內建角色**，不是去查 `roles` 表。
 * 自訂角色功能已凍結（`docs/modules/custom-roles.md` §4）——
 * 動態查表等於打開「任何人建的任何角色都能指派」，而那條路帶著 4 個 P0。
 * 最主要的一個：**資料可見範圍不是由角色的權限碼決定的**，
 * 一個 UI 上只勾了 2 個權限的角色，在 DB 層可能看得到全租戶。
 *
 * 要加角色就在這裡加一個，同時記得改 `users_role_check`、
 * 後端 DTO 的 `RoleEnum`，以及上面的 `ROLE_LABEL`。
 */
function assignableRolesFor(callerRole: string | undefined): UserRole[] {
  // ⚠️ 「助理」**只有 aiproot 能指派**。
  //
  // 它的兩個權限碼是 notify-config.view / notify-config.manage，那是**平台側**的能力
  // （管全域的通知規則與 Ragic 帳號金鑰）。而那三張表的 RLS 是純角色白名單、
  // **沒有租戶條件** —— 所以租戶管理員只要建一個「助理」，
  // 那個人就會看到 aiproot 全部的通知設定與金鑰。
  //
  // 我在 0049 的第一版把它放進 tenant_admin 的清單裡，那是錯的（同日修正）。
  // 判準：**角色的權限碼指向平台資源時，就只能由平台指派。**
  if (callerRole === "aiproot_admin") return ["tenant_admin", "group_owner", "assistant"];
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
  const perms = usePermissions();
  // MDA · 分配部門與「改角色/刪除」是兩件事，權限不同：
  //   canAssignDept（tenant_admin 有）→ 只能改部門的下拉
  //   canManageFull（aiproot only）  → 才顯示「編輯／刪除」，否則就是 auth-gate 那類「看得到卻 403」
  const canAssignDept = perms.has("users:assign-department");
  const canManageFull = perms.has("users:manage");
  // 0055 · tenant_admin 自治：改角色 / 刪除自家成員（限 員工↔部門主管）· aiproot 走 canManageFull 的抽屜
  const canAssignRole = perms.has("users:assign-role");
  const canDeleteMember = perms.has("users:delete-member");
  // 不能改/刪「自己那一列」（後端 assignRole/assignDepartment/deleteMember 都有 self-guard）·
  // Session 沒帶 userId，用 email 認自己（能登入 web 的帳號都有 email）
  const selfEmail = getSession()?.email ?? null;
  const isSelf = (u: TenantUserDto) => !!selfEmail && u.email === selfEmail;
  const [users, setUsers] = useState<TenantUserDto[]>([]);
  const [depts, setDepts] = useState<DepartmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingDept, setSavingDept] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<null | { kind: "new" } | { kind: "edit"; user: TenantUserDto }>(null);
  const [confirmDelete, setConfirmDelete] = useState<TenantUserDto | null>(null);
  // §4.6 · 每個已綁定成員近 30 天在各群的發言數 · 用來說明部門是怎麼推出來的
  const [activity, setActivity] = useState<Record<string, MemberGroupActivity[]>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // 群組活動只是「部門是怎麼判的」的說明 —— 它掛掉不該讓整份成員名單消失，
      // 所以自己吞掉錯誤（畫面退回沒有依據那行），不進下面的 catch
      const [usersRes, deptsRes, actRes] = await Promise.all([
        listTenantUsers(tenantId),
        listDepartments(tenantId),
        listMemberGroupActivity(tenantId).catch(() => ({ activity: {} })),
      ]);
      setUsers(usersRes.users);
      setDepts(deptsRes.departments);
      setActivity(actRes.activity);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  // MDA · 直接在列上改部門（不進編輯抽屜）· 只有 canAssignDept 的人看得到這個下拉
  async function changeDept(u: TenantUserDto, departmentId: string | null) {
    setSavingDept(u.userId);
    try {
      await assignUserDepartment(u.userId, { tenantId, departmentId });
      toast.show(departmentId ? "已調整所屬部門" : "已移出部門", "ok");
      await refresh();
      onChanged();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "調整失敗", "danger");
    } finally {
      setSavingDept(null);
    }
  }

  // 0055 · 直接在列上改角色（員工↔部門主管）· 只有 canAssignRole 的人看得到下拉
  async function changeRole(u: TenantUserDto, role: "employee" | "group_owner") {
    setSavingRole(u.userId);
    try {
      await assignMemberRole(u.userId, { tenantId, role });
      toast.show("已調整角色", "ok");
      await refresh();
      onChanged();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "調整失敗", "danger");
    } finally {
      setSavingRole(null);
    }
  }

  return (
    <div>
      {canEdit && (
        <div className="dm-actions-bar">
          <button className="btn btn-primary" onClick={() => setDrawer({ kind: "new" })}>+ 新增成員</button>
        </div>
      )}

      {loading ? (
        <Spinner block />
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
                  <td><MemberEmail email={u.email} /></td>
                  <td>
                    <RoleCell
                      user={u}
                      editable={canAssignRole && !canManageFull && !isSelf(u) && MEMBER_EDITABLE_ROLES.includes(u.role)}
                      saving={savingRole === u.userId}
                      onChange={(r) => void changeRole(u, r)}
                    />
                  </td>
                  <td>
                    <DeptCell
                      activity={activity[u.userId] ?? []}
                      user={u}
                      depts={depts}
                      editable={canAssignDept && u.role !== "tenant_admin" && !isSelf(u)}
                      saving={savingDept === u.userId}
                      onChange={(d) => void changeDept(u, d)}
                    />
                  </td>
                  <td>{u.hasPassword ? <span className="dm-tag-set">已設</span> : <span className="dm-tag-unset">未設</span>}</td>
                  <td className="dm-cell-actions">
                    {/* ⚠️ 編輯/刪除走 users:manage（aiproot only）· 只給真的能用的人看，
                        否則就是 auth-gate 那類「看得到卻 403」。tenant_admin 改部門走上面的下拉。*/}
                    {canManageFull ? (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={() => setDrawer({ kind: "edit", user: u })}>編輯</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(u)}>刪除</button>
                      </>
                    ) : (
                      // 0055 · tenant_admin 只能刪自家 員工/部門主管（碰不到高階帳號、不能刪自己）
                      canDeleteMember && !isSelf(u) && MEMBER_EDITABLE_ROLES.includes(u.role) && (
                        <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(u)}>刪除</button>
                      )
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

// LINE 綁定的成員 email 是自動產生的 U…@line.local（登入走 LINE，非真信箱）·
// 那串 hash 對人沒意義、又佔滿整欄 → 收成一個小標籤，畫面立刻清爽。
function MemberEmail({ email }: { email: string | null }) {
  if (!email) return <span className="dm-cell-muted">—</span>;
  if (email.endsWith("@line.local")) return <span className="dm-tag-unset">LINE 綁定</span>;
  return <span className="mono dm-cell-muted">{email}</span>;
}

// 0055 · 一列的「角色」格 · tenant_admin 可內嵌改 員工↔部門主管；其餘（高階/aiproot 視角）顯示靜態標籤
function RoleCell({ user, editable, saving, onChange }: {
  user: TenantUserDto;
  editable: boolean;
  saving: boolean;
  onChange: (role: "employee" | "group_owner") => void;
}) {
  if (!editable) {
    return <span>{ROLE_LABEL[user.role] ?? user.role}</span>;
  }
  return (
    <StyledSelect
      ariaLabel="角色"
      value={user.role}
      disabled={saving}
      width={120}
      items={MEMBER_EDITABLE_ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r] }))}
      onChange={(v) => onChange(v as "employee" | "group_owner")}
    />
  );
}

// MDA · 一列的「所屬部門」格 · 可改的下拉 + 來源標記（系統自動 / 手動 / 未分派）
function DeptCell({ user, depts, editable, saving, onChange, activity }: {
  user: TenantUserDto;
  depts: DepartmentDto[];
  editable: boolean;
  saving: boolean;
  onChange: (departmentId: string | null) => void;
  /** 近 30 天在各群的發言數 · 用來說明部門怎麼推出來的（§4.6）*/
  activity: MemberGroupActivity[];
}) {
  // 總經理室＝全公司，不屬單一部門，不給下拉
  if (user.role === "tenant_admin") {
    return <span className="dm-cell-muted">全公司（不分部門）</span>;
  }
  const unassigned = !user.departmentId;
  const counted = activity.filter((a) => a.countsTowardDepartment);
  const notCounted = activity.filter((a) => !a.countsTowardDepartment);

  // ⭐ §4.6 · 光說「系統自動判定」不夠 —— 要說出依據，否則
  //    「為什麼他在這個部門」「他是不是跨多個群」這兩題畫面上都答不出來。
  const why = (
    <div className="dm-dept-why">
      {unassigned ? (
        <span className="dm-dept-src warn">⚠ 系統推不出，請指派</span>
      ) : user.departmentSource === "manual" ? (
        <>
          <span className="dm-dept-src ok">· 手動指派</span>
          <span className="dm-dept-note">系統的自動判定不會再覆寫</span>
        </>
      ) : (
        <>
          <span className="dm-dept-src">
            · 系統自動判定{counted.length > 0 && ` · 依 ${counted.length} 個部門群中發言最多的`}
          </span>
          {counted.length > 0 && (
            <span className="dm-grp-line">
              {counted.map((a, i) => (
                <span className="dm-grp" key={i}>{a.groupName} <b>{a.messageCount}</b> 則</span>
              ))}
            </span>
          )}
        </>
      )}
      {/* 非部門群也列出來 —— 不列的話，「他明明在那個群為什麼沒算」沒有答案 */}
      {notCounted.length > 0 && (
        <span className="dm-grp-line muted">
          {notCounted.map((a, i) => (
            <span className="dm-grp out" key={i}>{a.groupName} <b>{a.messageCount}</b> 則</span>
          ))}
          <span className="dm-dept-note">不計入部門判定（非部門群）</span>
        </span>
      )}
      {activity.length === 0 && !unassigned && user.departmentSource !== "manual" && (
        <span className="dm-dept-note">近 30 天沒有在任何群發言</span>
      )}
    </div>
  );

  if (!editable) {
    return (
      <div>
        <span className={unassigned ? "dm-dept-unset" : ""}>{user.departmentName ?? "未分派"}</span>
        {why}
      </div>
    );
  }
  return (
    <div className="dm-dept-edit">
      <StyledSelect
        ariaLabel="所屬部門"
        value={user.departmentId ?? ""}
        disabled={saving}
        allowEmpty
        emptyLabel="未分派"
        placeholder="未分派"
        width={140}
        items={depts.map((d) => ({ id: d.departmentId, label: d.departmentName }))}
        onChange={(v) => onChange(v || null)}
      />
      {why}
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
  const isEdit = user != null;
  // 新增：不列「員工」（員工由 LINE 綁定自動生）· 編輯：要能設回「員工」（部門主管降級），故補上
  const assignable = useMemo(() => {
    const base = assignableRolesFor(session?.role);
    return isEdit && !base.includes("employee") ? (["employee", ...base] as UserRole[]) : base;
  }, [session?.role, isEdit]);
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
          {/* ⚠️ 舊文案寫「可新增部門主管與助理」，但 0049 之後租戶就不能建助理了（見
              assignableRolesFor 的註解）。選項只有一個時更要說明另外兩個去哪了 ——
              不然在「權限管理」看到三個角色的人，會以為這裡壞掉。 */}
          <div className="llm-hint">
            {session?.role === "tenant_admin"
              ? "「員工」不必在這裡建 —— 同仁用 LINE 綁定後會自動成為員工。「助理」與「總經理室」請聯繫 AIPROOT 開通。"
              : "此頁可新增「總經理室」「部門主管」「助理」·「員工」由 LINE 綁定自動建立 · 平台管理帳號由 AIPROOT 另行建立"}
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
