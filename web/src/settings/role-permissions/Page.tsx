import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n/useT";
import {
  ApiError, listTenantPermissions, listTenantRoles,
  updateTenantRolePermissions, resetTenantRole,
  listCustomRoles, updateCustomRolePermissions, deleteCustomRole,
  type TenantPermissionDto, type TenantRoleDto, type CustomRoleDto,
} from "../../api";
import { useToast } from "../../Toast";
import Spinner from "../../shared/Spinner";
import ConfirmDialog from "../../shared/ConfirmDialog";
import { PERMISSION_GROUPS, PERMISSION_HINT, CRITICAL_PERMISSION_IDS } from "./labels";
import RoleList from "./RoleList";
import CreateRoleDrawer from "./CreateRoleDrawer";
import type { ViewRole } from "./types";
import { hasKey } from "../../i18n";

// 權限管理（租戶端）· docs/modules/tenant-role-permissions.md v0.2
// 版面沿用 aiproot 側 RolesManagement 的 rm-* class —— 兩邊是同一個東西的兩種可見範圍，
// 長得一樣才對；差別在資料（3 個角色 / 26 項權限），而那是後端決定的。

// 這個角色的人是怎麼來的 —— 回答「這裡有兩個角色，新增成員卻只能選一個」。
// 差的那個是「員工」，而員工是自動生的，不用手建。
//
// ⚠️ 這裡刻意沒有 assistant —— 「助理」是 AIPROOT 內部角色，2026-08-21 已從
//    TENANT_EDITABLE_ROLE_KEYS 移除（它的權限都是 platform scope，而那些表的
//    policy 沒有租戶條件）。後端不會再回傳它，前端也不留殘影。
// 自建角色清單第三行用 · 跟後端 GET /baselines 的 label 一致
const BASELINE_LABEL: Record<string, string> = {
  employee: "baseline.self", group_owner: "baseline.dept", tenant_admin: "baseline.company",
};

const ROLE_SOURCE: Record<string, string> = {
  employee: "baselineHint.employee",
  group_owner: "baselineHint.group_owner",
};

export default function RolePermissionsPage() {
  const tr = useT();
  const [perms, setPerms] = useState<TenantPermissionDto[]>([]);
  const [roles, setRoles] = useState<TenantRoleDto[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRoleDto[]>([]);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ViewRole | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 兩個必要的確認 · mockup §3
  const [forkNotice, setForkNotice] = useState(false);
  const [criticalWarn, setCriticalWarn] = useState<string[] | null>(null);
  const [resetting, setResetting] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, r, c] = await Promise.all([listTenantPermissions(), listTenantRoles(), listCustomRoles()]);
      setPerms(p.permissions);
      setRoles(r.roles);
      setCustomRoles(c.roles);
      setSelected((cur) => cur ?? (r.roles[0] ? `b:${r.roles[0].roleKey}` : null));
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : tr("rm.loadFailed"), "danger");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  // 內建與自建走兩支不同的 API，但畫面上是同一份清單、同一個編輯器 ——
  // 先攤平成統一視圖，下面的編輯器就不必到處分岔。
  const builtinView = useMemo<ViewRole[]>(() => roles.map((r) => ({
    // ⚠️ 系統角色的名字走 i18n（roleKey 是穩定識別字）· DB 的 roleName 只當 fallback。
    //    自訂角色（下面那組）是租戶自己打的字，**不翻** —— 翻了等於改客戶取的名字。
    sel: `b:${r.roleKey}`, name: hasKey(`role.${r.roleKey}`) ? tr(`role.${r.roleKey}`) : r.roleName, permissions: r.permissions,
    memberCount: r.memberCount, isCustom: false, isCustomized: r.isCustomized,
    roleKey: r.roleKey,
    // ⚠️ ROLE_SOURCE 的值是 i18n key，不是文字 —— 直接放會在畫面上印出
    //    `baselineHint.employee`（2026-08-27 M5 截圖抓到，自動掃描的正則沒收這個前綴）。
    sourceHint: ROLE_SOURCE[r.roleKey] ? tr(ROLE_SOURCE[r.roleKey]!) : "",
  })), [roles]);

  const customView = useMemo<ViewRole[]>(() => customRoles.map((r) => ({
    sel: `c:${r.roleId}`, name: r.roleName, permissions: r.permissions,
    memberCount: r.memberCount, isCustom: true, isCustomized: false,
    roleKey: r.roleKey, roleId: r.roleId,
    sourceHint: tr("rm.sees", { what: tr(BASELINE_LABEL[r.baselineRole] ?? "baseline.self") }),
  })), [customRoles]);

  const role = useMemo(
    () => [...builtinView, ...customView].find((r) => r.sel === selected) ?? null,
    [builtinView, customView, selected],
  );
  useEffect(() => { setDraft(new Set(role?.permissions ?? [])); }, [role]);

  const byId = useMemo(() => new Map(perms.map((p) => [p.permissionId, p])), [perms]);

  // 沒被分組列到的權限落到「其他」—— 看到它就代表 labels.ts 該補了，
  // 悄悄漏掉比多一個分組更糟（使用者會以為那個權限不存在）
  const groups = useMemo(() => {
    const listed = new Set(PERMISSION_GROUPS.flatMap((g) => g.ids));
    const rest = perms.filter((p) => !listed.has(p.permissionId)).map((p) => p.permissionId);
    return [
      ...PERMISSION_GROUPS.map((g) => ({ title: g.title, ids: g.ids.filter((id) => byId.has(id)) }))
        .filter((g) => g.ids.length > 0),
      ...(rest.length > 0 ? [{ title: "permGroup.other", ids: rest }] : []),
    ];
  }, [perms, byId]);

  const dirty = useMemo(() => {
    if (!role) return false;
    const cur = new Set(role.permissions);
    return cur.size !== draft.size || [...draft].some((id) => !cur.has(id));
  }, [role, draft]);

  const toggle = (id: string) => setDraft((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  /** 存檔前的兩道確認：① 第一次改要說明分岔 ② 拿掉關鍵權限要說影響幾個人 */
  const trySave = () => {
    if (!role) return;
    const removedCritical = role.permissions
      .filter((id) => !draft.has(id) && CRITICAL_PERMISSION_IDS.has(id));
    if (removedCritical.length > 0) { setCriticalWarn(removedCritical); return; }
    // 自建角色本來就是這家公司的，沒有「分岔成專屬設定」這件事要說明
    if (!role.isCustom && !role.isCustomized) { setForkNotice(true); return; }
    void save();
  };

  const save = async () => {
    if (!role) return;
    setSaving(true);
    try {
      if (role.isCustom) {
        await updateCustomRolePermissions(role.roleId!, [...draft]);
        toast.show(tr("common.saved"), "ok");
      } else {
        const res = await updateTenantRolePermissions(role.roleKey, [...draft]);
        toast.show(res.forked
          ? tr("rm.savedCustom", { name: role.name })
          : tr("common.saved"), "ok");
      }
      setForkNotice(false); setCriticalWarn(null);
      await load();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : tr("common.saveFailed"), "danger");
    } finally {
      setSaving(false);
    }
  };

  const doReset = async () => {
    if (!role) return;
    setSaving(true);
    try {
      await resetTenantRole(role.roleKey);
      toast.show(tr("rm.reverted", { name: role.name }), "ok");
      setResetting(false);
      await load();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : tr("rm.revertFailed"), "danger");
    } finally {
      setSaving(false);
    }
  };

  if (loading && roles.length === 0) return <Spinner block />;

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>{tr("nav.rolePermissions")}</h1>
          <p className="sub">{tr("rm.sub")}</p>
        </div>
      </div>

      <div className="rm-layout">
        <RoleList
          builtin={builtinView} custom={customView}
          selected={selected} onSelect={setSelected}
          onCreate={() => setCreating(true)}
        />

        {role && (
          <div className="rm-editor">
            <div className="rm-editor-hdr">
              <div className="rm-editor-title">
                {role.name}
                <span className={`rm-role-badge ${role.isCustom || role.isCustomized ? "custom" : ""}`}>
                  {tr(role.isCustom ? "rm.custom" : role.isCustomized ? "rm.adjusted" : "rm.builtin")}
                </span>
              </div>
              {role.isCustom && (
                <div className="rm-custom-note">
                  <span>{tr("rm.dataScope")}<b>{tr(BASELINE_LABEL[
                    customRoles.find((c) => c.roleId === role.roleId)?.baselineRole ?? ""
                  ] ?? "baseline.self")}</b> · {tr("rm.scopeLocked")}</span>
                  <button className="btn small" onClick={() => setConfirmDelete(role)} disabled={saving}>
                    {tr("rm.deleteRole")}
                  </button>
                </div>
              )}
              {!role.isCustom && role.isCustomized && (
                <div className="rm-custom-note">
                  <span>
                    {tr("rm.adjustedNote")}
                  </span>
                  <button className="btn small" onClick={() => setResetting(true)} disabled={saving}>
                    {tr("rm.revert")}
                  </button>
                </div>
              )}
            </div>

            <div className="rm-perms-scroll">
              {groups.map((g) => (
                <div className="rm-perm-group" key={g.title}>
                  <div className="rm-perm-group-hdr">{tr(g.title)}</div>
                  {g.ids.map((id) => {
                    const p = byId.get(id)!;
                    const hint = PERMISSION_HINT[id];
                    return (
                      <label className="rm-perm-item" key={id}>
                        <input type="checkbox" checked={draft.has(id)} onChange={() => toggle(id)} />
                        <span className="rm-perm-info">
                          <span className="rm-perm-desc">
                            {p.description}
                            {/* 內部分類（tenant/department）不外露 · 只標對使用者有意義的範圍 */}
                            {p.scope === "department" && <span className="rm-perm-scope">{tr("rm.deptOnly")}</span>}
                          </span>
                          {hint && <span className="rm-perm-hint">{tr(hint)}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="rm-editor-foot">
              <span className="rm-editor-sub">{tr("rm.checked", { n: draft.size, total: perms.length })}</span>
              <div className="rm-foot-acts">
                <button className="btn" disabled={!dirty || saving}
                  onClick={() => setDraft(new Set(role.permissions))}>{tr("common.cancel")}</button>
                <button className="btn btn-primary" disabled={!dirty || saving} onClick={trySave}>
                  {saving ? tr("common.saving") : tr("common.save")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={forkNotice} busy={saving}
        onClose={() => setForkNotice(false)} onConfirm={() => void save()}
        title={tr("rm.firstAdjustTitle")}
        confirmLabel={tr("rm.firstAdjustOk")}
        body={<>
          {tr("rm.firstAdjustBody", { name: role?.name ?? "" })}
        </>}
      />

      <ConfirmDialog
        open={criticalWarn !== null} busy={saving} tone="danger"
        onClose={() => setCriticalWarn(null)}
        onConfirm={() => { setCriticalWarn(null); if (role?.isCustomized) void save(); else setForkNotice(true); }}
        title={tr("rm.removeWarnTitle", { n: role?.memberCount ?? 0 })}
        confirmLabel={tr("rm.removeAnyway")} cancelLabel={tr("common.notNow")}
        body={<>
          {tr("rm.aboutToRemove")}
          {criticalWarn?.map((id) => `「${byId.get(id)?.description ?? id}」`).join("、")}。<br />
          {tr("rm.removeWarnBody", { n: role?.memberCount ?? 0, name: role?.name ?? "" })}
        </>}
      />

      <ConfirmDialog
        open={resetting} busy={saving}
        onClose={() => setResetting(false)} onConfirm={() => void doReset()}
        title={tr("rm.revertTitle")}
        confirmLabel={tr("common.undo")}
        body={<>
          {tr("rm.revertBody", { name: role?.name ?? "" })}
        </>}
      />

      {creating && (
        <CreateRoleDrawer
          onClose={() => setCreating(false)}
          onCreated={async (roleKey) => {
            setCreating(false);
            await load();
            // 建完直接切到那個角色 —— 下一步就是勾它可以做哪些事，
            // 不切的話使用者得自己在清單裡找剛剛建的那一個
            const created = (await listCustomRoles()).roles.find((r) => r.roleKey === roleKey);
            if (created) setSelected(`c:${created.roleId}`);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null} busy={saving} tone="danger"
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete?.roleId) return;
          setSaving(true);
          try {
            await deleteCustomRole(confirmDelete.roleId);
            toast.show(tr("rm.deleted", { name: confirmDelete.name }), "ok");
            setConfirmDelete(null);
            setSelected(null);
            await load();
          } catch (e) {
            toast.show(e instanceof ApiError ? e.message : tr("rm.deleteFailed"), "danger");
          } finally {
            setSaving(false);
          }
        }}
        title={tr("rm.deleteTitle", { name: confirmDelete?.name ?? "" })}
        confirmLabel={tr("common.delete")} cancelLabel={tr("common.notNow")}
        body={<>
          {tr("rm.deleteBody")}
          {(confirmDelete?.memberCount ?? 0) > 0
            ? tr("rm.deleteInUse", { n: confirmDelete?.memberCount ?? 0 }) : tr("rm.deleteUnused")}
        </>}
      />
    </div>
  );
}