import Spinner from "../../shared/Spinner";
import { t } from "../../i18n";
import { useT } from "../../i18n/useT";
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
  listCustomRoles,
  assignCustomRole,
  type CustomRoleDto,
} from "../../api";
import { useToast } from "../../Toast";
import { usePermissions } from "../../permission/PermissionContext";
import Drawer from "../../shared/Drawer";
import StyledSelect from "../../shared/StyledSelect";
import { InfoTip } from "../../shared/InfoTip";
import { roleLabel } from "../../shared/roleLabel";

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
 * 後端 DTO 的 `RoleEnum`，以及 i18n 的 `role.*`。
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
  const tr = useT();
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
  // custom-roles M6 · 角色下拉要列出本公司自建的角色
  const [customRoles, setCustomRoles] = useState<CustomRoleDto[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // 群組活動只是「部門是怎麼判的」的說明 —— 它掛掉不該讓整份成員名單消失，
      // 所以自己吞掉錯誤（畫面退回沒有依據那行），不進下面的 catch
      const [usersRes, deptsRes, actRes, crRes] = await Promise.all([
        listTenantUsers(tenantId),
        listDepartments(tenantId),
        listMemberGroupActivity(tenantId).catch(() => ({ activity: {} })),
        // 同樣自己吞掉：沒有自建角色不該讓整份名單消失
        listCustomRoles().catch(() => ({ roles: [] as CustomRoleDto[] })),
      ]);
      setUsers(usersRes.users);
      setDepts(deptsRes.departments);
      setActivity(actRes.activity);
      setCustomRoles(crRes.roles);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("common.loadFailed"), "danger");
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
      toast.show(tr(departmentId ? "mb.deptChanged" : "mb.deptRemoved"), "ok");
      await refresh();
      onChanged();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("mb.changeFailed"), "danger");
    } finally {
      setSavingDept(null);
    }
  }

  // 0055 · 直接在列上改角色 · 只有 canAssignRole 的人看得到下拉
  // custom-roles M6：`c:<roleId>` ＝ 自建角色，走另一支端點；其餘是內建角色
  async function changeRole(u: TenantUserDto, sel: string) {
    setSavingRole(u.userId);
    try {
      if (sel.startsWith("c:")) {
        await assignCustomRole(u.userId, sel.slice(2));
      } else {
        // 從自建角色換回內建角色時，要先把 role_id 清掉，否則權限還停在舊的自建角色
        if (u.roleId) await assignCustomRole(u.userId, null);
        await assignMemberRole(u.userId, { tenantId, role: sel as "employee" | "group_owner" });
      }
      toast.show(tr("mb.roleChanged"), "ok");
      await refresh();
      onChanged();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("mb.changeFailed"), "danger");
    } finally {
      setSavingRole(null);
    }
  }

  return (
    <div>
      {canEdit && (
        <div className="dm-actions-bar">
          <button className="btn btn-primary" onClick={() => setDrawer({ kind: "new" })}>+ {tr("mb.new")}</button>
        </div>
      )}

      {loading ? (
        <Spinner block />
      ) : users.length === 0 ? (
        <div className="dm-empty">
          <div>{tr("mb.emptyTitle")}</div>
          {/* ⚠️ 原本寫「點右上『新增成員』建立」是**會把人導進死路的**：
              員工不是手建的（LINE 綁定後自動產生），而「新增成員」的角色下拉裡
              根本沒有「員工」這個選項 —— 照著做會點進去然後困惑。 */}
          <div className="dm-empty-hint">
            {tr("mb.emptyHint")}
            {canEdit && <>{tr("mb.emptyManagerHint")}</>}
          </div>
        </div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th>{tr("dp.colDisplay")}</th>
                <th>Email</th>
                <th>{tr("mb.colRole")}</th>
                <th>{tr("mb.colDept")}</th>
                <th>{tr("mb.colPassword")}</th>
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
                      customRoles={customRoles}
                      editable={canAssignRole && !canManageFull && !isSelf(u) && MEMBER_EDITABLE_ROLES.includes(u.role)}
                      saving={savingRole === u.userId}
                      onChange={(sel) => void changeRole(u, sel)}
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
                  <td>{u.hasPassword ? <span className="dm-tag-set">{tr("mb.pwSet")}</span> : <span className="dm-tag-unset">{tr("mb.pwUnset")}</span>}</td>
                  <td className="dm-cell-actions">
                    {/* ⚠️ 編輯/刪除走 users:manage（aiproot only）· 只給真的能用的人看，
                        否則就是 auth-gate 那類「看得到卻 403」。tenant_admin 改部門走上面的下拉。*/}
                    {canManageFull ? (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={() => setDrawer({ kind: "edit", user: u })}>{tr("common.edit")}</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(u)}>{tr("common.delete")}</button>
                      </>
                    ) : (
                      // 0055 · tenant_admin 只能刪自家 員工/部門主管（碰不到高階帳號、不能刪自己）
                      canDeleteMember && !isSelf(u) && MEMBER_EDITABLE_ROLES.includes(u.role) && (
                        <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(u)}>{tr("common.delete")}</button>
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
        <Drawer open onClose={() => setConfirmDelete(null)} title={tr("mb.deleteTitle")} width={480}>
          <div className="lbot-confirm">
            <p>{tr("mb.deleteBody", { name: confirmDelete.displayName ?? confirmDelete.email ?? "" })}</p>
            <div className="llm-form-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  try {
                    await deleteTenantUser(confirmDelete.userId, tenantId);
                    toast.show(tr("mb.deleted"), "ok");
                    setConfirmDelete(null);
                    refresh();
                    onChanged();
                  } catch (err) {
                    toast.show(err instanceof ApiError ? err.message : tr("rm.deleteFailed"), "danger");
                  }
                }}
              >
                {tr("dp.deleteConfirm")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>{tr("common.cancel")}</button>
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
  const tr = useT();
  if (!email) return <span className="dm-cell-muted">—</span>;
  if (email.endsWith("@line.local")) return <span className="dm-tag-unset">{tr("mb.lineLinked")}</span>;
  return <span className="mono dm-cell-muted">{email}</span>;
}

// 0055 · 一列的「角色」格 · tenant_admin 可內嵌改 員工↔部門主管；其餘（高階/aiproot 視角）顯示靜態標籤
//
// custom-roles v0.3 M6：清單多一段本公司自建的角色。
// ⚠️ 兩種角色走**不同的端點**（內建 assignMemberRole／自建 assignCustomRole），
//    所以 onChange 要能分辨。用 `c:<roleId>` 前綴區分 —— 兩邊的 id 空間不同，不能混用。
function RoleCell({ user, editable, saving, customRoles, onChange }: {
  user: TenantUserDto;
  editable: boolean;
  saving: boolean;
  customRoles: CustomRoleDto[];
  onChange: (sel: string) => void;
}) {
  const tr = useT();
  const mine = user.roleId ? customRoles.find((c) => c.roleId === user.roleId) : undefined;

  if (!editable) {
    // 有自訂角色就顯示它的名字 —— 顯示基準角色的話畫面會說「部門主管」而實際是「品保組長」
    return <span>{mine?.roleName ?? roleLabel(user.role)}</span>;
  }
  return (
    <StyledSelect
      ariaLabel={tr("mb.colRole")}
      value={mine ? `c:${mine.roleId}` : user.role}
      disabled={saving}
      width={130}
      items={[
        ...MEMBER_EDITABLE_ROLES.map((r) => ({ id: r, label: roleLabel(r) })),
        // StyledSelect 沒有分組，用 hint（右側灰字）標出來源 ——
        // 不標的話「品保組長」混在內建角色裡，沒人知道那是自己公司建的
        ...customRoles.map((c) => ({ id: `c:${c.roleId}`, label: c.roleName, hint: tr("rm.custom") })),
      ]}
      onChange={onChange}
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
  const tr = useT();
  // 總經理室＝全公司，不屬單一部門，不給下拉
  if (user.role === "tenant_admin") {
    return <span className="dm-cell-muted">{tr("mb.wholeCompany")}</span>;
  }
  const unassigned = !user.departmentId;
  const counted = activity.filter((a) => a.countsTowardDepartment);
  const notCounted = activity.filter((a) => !a.countsTowardDepartment);

  // ⭐ §4.6 · 光說「系統自動判定」不夠 —— 要說出依據，否則
  //    「為什麼他在這個部門」「他是不是跨多個群」這兩題畫面上都答不出來。
  //
  // ⚠️⚠️ 但**依據不可以長在表格列裡**。前兩版都栽在這：
  //    v1 把所有群攤開 → 有人待在 9 個群，列高衝到 ~200px；
  //    v2 收進 <details> → 展開後一樣爆，而且 details 的開闔狀態沒人管，
  //       預設就是開的；更糟的是「所屬部門」欄被撐寬，把右邊三欄推到天邊，
  //       中間留一大片空白 —— 使用者的說法是「雜亂、擁擠」。
  //    v3（本版）：**列裡只留一行結論，完整依據進 tooltip**（沿用 shared/InfoTip，
  //    warroom 已經在用同一個元件）。列高從此固定兩行，跟其他欄對得齊。
  const detail = (
    <div className="dm-why-tip">
      <div className="dm-why-tip-h">
        {tr(user.departmentSource === "manual" ? "mb.manualNote" : "mb.autoNote")}
      </div>
      {activity.map((a, i) => (
        <div className={`dm-why-tip-row${a.countsTowardDepartment ? "" : " out"}`} key={i}>
          <span>{a.groupName}</span>
          <b>{tr("mb.nMsgs", { n: a.messageCount })}</b>
        </div>
      ))}
      {notCounted.length > 0 && (
        <div className="dm-why-tip-f">{tr("mb.whyFoot")}</div>
      )}
    </div>
  );

  // 一行結論 —— **要短**。細節全在 tooltip 裡。
  // 摘要寫長了（例如「依 8 個部門群中發言最多的（另有 1 個非部門群不計入）」）
  // 會把整個「所屬部門」欄撐寬，右邊的密碼／刪除被推到天邊、中間一大片空白。
  const summary = unassigned ? (
    <span className="dm-dept-src warn">⚠ {tr("mb.pleaseAssign")}</span>
  ) : user.departmentSource === "manual" ? (
    <span className="dm-dept-src ok">· {tr("mb.manual")}</span>
  ) : counted.length > 0 ? (
    <span className="dm-dept-src">· {tr("mb.auto", { n: counted.length })}</span>
  ) : (
    <span className="dm-dept-src">· {tr("mb.noMsgs30")}</span>
  );

  const why = (
    <div className="dm-dept-why">
      {activity.length > 0 ? (
        <InfoTip content={detail}><span className="dm-why-hint">{summary}</span></InfoTip>
      ) : summary}
    </div>
  );

  if (!editable) {
    return (
      <div>
        <span className={unassigned ? "dm-dept-unset" : ""}>{user.departmentName ?? tr("mb.unassigned")}</span>
        {why}
      </div>
    );
  }
  return (
    <div className="dm-dept-edit">
      <StyledSelect
        ariaLabel={tr("mb.colDept")}
        value={user.departmentId ?? ""}
        disabled={saving}
        allowEmpty
        emptyLabel={tr("mb.unassigned")}
        placeholder={tr("mb.unassigned")}
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
  const tr = useT();
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
      toast.show(tr("mb.emailPwRequired"), "danger");
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
      toast.show(tr(isEdit ? "mb.updated" : "mb.created"), "ok");
      onSaved();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("common.saveFailed"), "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={tr(isEdit ? "mb.edit" : "mb.new")} subtitle={isEdit ? (user.email ?? undefined) : undefined}>
      <form onSubmit={handleSubmit} className="llm-form">
        <div className="field">
          <label>Email *</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving || isEdit} placeholder="user@example.com" required />
          <div className="llm-hint">{tr(isEdit ? "mb.emailLocked" : "mb.emailHint")}</div>
        </div>

        <div className="field">
          <label>{tr("dp.colDisplay")}</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={saving} placeholder={tr("mb.namePlaceholder")} />
        </div>

        <div className="field">
          <label>{tr("mb.colRole")} *</label>
          <StyledSelect
            items={assignable.map((r) => ({ id: r, label: roleLabel(r) }))}
            value={role}
            onChange={(v) => setRole(v as UserRole)}
            disabled={saving}
            ariaLabel={tr("mb.colRole")}
          />
          {/* ⚠️ 舊文案寫「可新增部門主管與助理」，但 0049 之後租戶就不能建助理了（見
              assignableRolesFor 的註解）。選項只有一個時更要說明另外一個去哪了 ——
              不然在「權限管理」看到角色數量對不上的人，會以為這裡壞掉。

              ⚠️⚠️ 2026-08-29：租戶版的提示**不可以提到「助理」**。
              那是 aiproot 的內部角色（兩個權限都是 platform scope，
              通知設定只發給 aiproot_admin / assistant / consultant）——
              客戶端沒有任何人打得開那一頁，講了只會讓他們以為自己該指派一個人。
              平台版（mb.roleHintPlatform）照舊列出它，那是我們自己在看的。 */}
          <div className="llm-hint">
            {session?.role === "tenant_admin"
              ? tr("mb.roleHintTenant")
              : tr("mb.roleHintPlatform")}
          </div>
        </div>

        <div className="field">
          <label>{tr("mb.colDept")}</label>
          <StyledSelect
            items={depts.map((d) => ({ id: d.departmentId, label: d.departmentName }))}
            value={departmentId}
            onChange={setDepartmentId}
            disabled={saving}
            ariaLabel={tr("mb.colDept")}
            allowEmpty
            emptyLabel={tr("mb.unassigned")}
          />
        </div>

        {!isEdit && (
          <div className="field">
            <label>{tr("mb.initialPw")} *</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={saving} placeholder={tr("mb.pwPlaceholder")} required autoComplete="new-password" />
            <div className="llm-hint">{tr("mb.pwHint")}</div>
          </div>
        )}

        {isEdit && (
          <div className="lbot-rotate">
            <label className="lbot-rotate-hdr">
              <input type="checkbox" checked={rotatePassword} onChange={(e) => setRotatePassword(e.target.checked)} disabled={saving} />
              <span>{tr("mb.resetPw")}</span>
            </label>
            {rotatePassword && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={saving}
                placeholder={tr("mb.newPwPlaceholder")}
                required
                autoComplete="new-password"
                className="lbot-rotate-input"
              />
            )}
          </div>
        )}

        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? tr("common.saving") : tr(isEdit ? "common.save" : "mb.new")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>{tr("common.cancel")}</button>
        </div>
      </form>
    </Drawer>
  );
}
