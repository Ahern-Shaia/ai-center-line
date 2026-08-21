import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError, listTenantPermissions, listTenantRoles,
  updateTenantRolePermissions, resetTenantRole,
  type TenantPermissionDto, type TenantRoleDto,
} from "../../api";
import { useToast } from "../../Toast";
import Spinner from "../../shared/Spinner";
import ConfirmDialog from "../../shared/ConfirmDialog";
import { PERMISSION_GROUPS, PERMISSION_HINT, CRITICAL_PERMISSION_IDS } from "./labels";

// 權限管理（租戶端）· docs/modules/tenant-role-permissions.md v0.2
// 版面沿用 aiproot 側 RolesManagement 的 rm-* class —— 兩邊是同一個東西的兩種可見範圍，
// 長得一樣才對；差別在資料（3 個角色 / 26 項權限），而那是後端決定的。

// 這個角色的人是怎麼來的 —— 回答「這裡有三個角色，新增成員卻只能選一個」。
// 三者各有原因：員工是自動生的、部門主管是這裡手動建的、助理帶平台側權限只能由 AIPROOT 指派。
const ROLE_SOURCE: Record<string, string> = {
  employee: "同仁綁定 LINE 後自動成為員工",
  group_owner: "在「部門/成員」頁新增",
  assistant: "由 AIPROOT 指派",
};

export default function RolePermissionsPage() {
  const [perms, setPerms] = useState<TenantPermissionDto[]>([]);
  const [roles, setRoles] = useState<TenantRoleDto[]>([]);
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
      const [p, r] = await Promise.all([listTenantPermissions(), listTenantRoles()]);
      setPerms(p.permissions);
      setRoles(r.roles);
      setSelected((cur) => cur ?? r.roles[0]?.roleKey ?? null);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "載入權限設定失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const role = roles.find((r) => r.roleKey === selected) ?? null;
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
      ...(rest.length > 0 ? [{ title: "其他", ids: rest }] : []),
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
    if (!role.isCustomized) { setForkNotice(true); return; }
    void save();
  };

  const save = async () => {
    if (!role) return;
    setSaving(true);
    try {
      const res = await updateTenantRolePermissions(role.roleKey, [...draft]);
      toast.show(res.forked
        ? `已儲存 · 「${role.roleName}」現在是貴公司專屬的設定`
        : "已儲存", "ok");
      setForkNotice(false); setCriticalWarn(null);
      await load();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "儲存失敗", "danger");
    } finally {
      setSaving(false);
    }
  };

  const doReset = async () => {
    if (!role) return;
    setSaving(true);
    try {
      await resetTenantRole(role.roleKey);
      toast.show(`「${role.roleName}」已還原成系統預設`, "ok");
      setResetting(false);
      await load();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "還原失敗", "danger");
    } finally {
      setSaving(false);
    }
  };

  if (loading && roles.length === 0) return <Spinner block />;

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>權限管理</h1>
          <p className="sub">調整每個角色可以做哪些事 · 改完立即生效，套用到所有使用該角色的成員</p>
        </div>
      </div>

      <div className="rm-note">
        需要新的角色？請聯繫 AIPROOT 並說明這個角色要做哪些事 —— 我們會幫你建立。
      </div>

      <div className="rm-layout">
        <div className="rm-sidebar">
          <div className="rm-sidebar-hdr">角色（{roles.length}）</div>
          {roles.map((r) => (
            <button
              key={r.roleKey}
              className={`rm-role-item${selected === r.roleKey ? " active" : ""}`}
              onClick={() => setSelected(r.roleKey)}
            >
              <div className="rm-role-name">
                {r.roleName}
                <span className={`rm-role-badge ${r.isCustomized ? "custom" : ""}`}>
                  {r.isCustomized ? "已自行調整" : "系統預設"}
                </span>
              </div>
              <div className="rm-perm-meta">
                {r.permissions.length} 項權限 · {r.memberCount} 位成員
              </div>
              {/* 這頁有三個角色、「新增成員」卻只有一個選項 —— 不說明的話，
                  看起來就像設定沒同步。講清楚「這個角色的人怎麼來的」比較實在。 */}
              <div className="rm-role-source">{ROLE_SOURCE[r.roleKey] ?? ""}</div>
            </button>
          ))}
        </div>

        {role && (
          <div className="rm-editor">
            <div className="rm-editor-hdr">
              <div className="rm-editor-title">
                {role.roleName}
                <span className={`rm-role-badge ${role.isCustomized ? "custom" : ""}`}>
                  {role.isCustomized ? "已自行調整" : "系統預設"}
                </span>
              </div>
              {role.isCustomized && (
                <div className="rm-custom-note">
                  <span>
                    這個角色已由貴公司自行調整過。日後 AIPROOT 為這個角色新增功能時，
                    <b>不會自動套用到貴公司</b>。
                  </span>
                  <button className="btn small" onClick={() => setResetting(true)} disabled={saving}>
                    還原成系統預設
                  </button>
                </div>
              )}
            </div>

            <div className="rm-perms-scroll">
              {groups.map((g) => (
                <div className="rm-perm-group" key={g.title}>
                  <div className="rm-perm-group-hdr">{g.title}</div>
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
                            {p.scope === "department" && <span className="rm-perm-scope">僅限自己部門</span>}
                          </span>
                          {hint && <span className="rm-perm-hint">{hint}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="rm-editor-foot">
              <span className="rm-editor-sub">已勾 <b>{draft.size}</b> / {perms.length} 項</span>
              <div className="rm-foot-acts">
                <button className="btn" disabled={!dirty || saving}
                  onClick={() => setDraft(new Set(role.permissions))}>取消</button>
                <button className="btn btn-primary" disabled={!dirty || saving} onClick={trySave}>
                  {saving ? "儲存中…" : "儲存變更"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={forkNotice} busy={saving}
        onClose={() => setForkNotice(false)} onConfirm={() => void save()}
        title="這是貴公司第一次調整這個角色"
        confirmLabel="了解，繼續調整"
        body={<>
          調整之後，「{role?.roleName}」就變成<b>貴公司專屬</b>的設定。<br />
          日後我們為這個角色新增功能時，<b>不會自動套用到貴公司</b> —— 需要的話再請通知我們。<br />
          隨時可以按「還原成系統預設」改回原本的設定。
        </>}
      />

      <ConfirmDialog
        open={criticalWarn !== null} busy={saving} tone="danger"
        onClose={() => setCriticalWarn(null)}
        onConfirm={() => { setCriticalWarn(null); if (role?.isCustomized) void save(); else setForkNotice(true); }}
        title={`這會讓 ${role?.memberCount ?? 0} 位成員看不到部分頁面`}
        confirmLabel="仍要移除" cancelLabel="先不要"
        body={<>
          你正要移除
          {criticalWarn?.map((id) => `「${byId.get(id)?.description ?? id}」`).join("、")}。<br />
          目前有 <b>{role?.memberCount ?? 0} 位</b>成員使用「{role?.roleName}」這個角色，
          他們儲存後<b>會立刻失去對應的頁面</b>。
        </>}
      />

      <ConfirmDialog
        open={resetting} busy={saving}
        onClose={() => setResetting(false)} onConfirm={() => void doReset()}
        title="還原成系統預設？"
        confirmLabel="還原"
        body={<>
          「{role?.roleName}」會回到 AIPROOT 的預設設定，貴公司目前的調整<b>會被覆蓋</b>。<br />
          之後這個角色會重新跟隨系統更新。
        </>}
      />
    </div>
  );
}
