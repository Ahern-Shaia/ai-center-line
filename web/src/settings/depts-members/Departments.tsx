import Spinner from "../../shared/Spinner";
import { t } from "../../i18n";
import { useT } from "../../i18n/useT";
import { useCallback, useEffect, useState } from "react";
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  ApiError,
  type DepartmentDto,
} from "../../api";
import { useToast } from "../../Toast";
import Drawer from "../../shared/Drawer";

/**
 * 刪不掉的原因 · 兩道條件都要列。
 * 只講第一道的話，使用者解完那道回來會再撞第二道 —— 兩次都以為快好了。
 */
function deleteBlockedReason(d: DepartmentDto): string {
  const parts: string[] = [];
  if (d.memberCount > 0) parts.push(t("dp.blockMembers", { n: d.memberCount }));
  if (d.groupBindingCount > 0) {
    const names = d.boundGroupNames?.length ? `：${d.boundGroupNames.join("、")}` : "";
    parts.push(t("dp.blockGroups", { n: d.groupBindingCount, names }));
  }
  return parts.length === 0 ? "" : t("dp.blocked", { why: parts.join("；") });
}

export function Departments({
  tenantId, canEdit, onChanged,
}: {
  tenantId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const tr = useT();
  const toast = useToast();
  const [rows, setRows] = useState<DepartmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<null | { kind: "new" } | { kind: "edit"; dept: DepartmentDto }>(null);
  const [confirmDelete, setConfirmDelete] = useState<DepartmentDto | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDepartments(tenantId);
      setRows(res.departments);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("common.loadFailed"), "danger");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      {canEdit && (
        <div className="dm-actions-bar">
          <button className="btn btn-primary" onClick={() => setDrawer({ kind: "new" })}>+ {tr("dp.new")}</button>
        </div>
      )}

      {loading ? (
        <Spinner block />
      ) : rows.length === 0 ? (
        <div className="dm-empty">
          <div>{tr("dp.emptyTitle")}</div>
          {/* 只說「點右上新增」沒回答「為什麼要建」—— 部門是整套系統的切分依據，
              不先建，後面分派群組／看板／權限全都卡住 */}
          <div className="dm-empty-hint">
            {tr("dp.emptyHint")}
            {canEdit && <>{tr("dp.emptyStart")}</>}
          </div>
        </div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th>{tr("dp.colName")}</th>
                <th>{tr("dp.colDisplay")}</th>
                <th className="num">{tr("dm.tabMembers")}</th>
                <th className="num">{tr("dp.colGroups")}</th>
                <th>{tr("dp.colForm")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.departmentId}>
                  <td>{d.departmentName}</td>
                  <td className="dm-cell-muted">{d.displayName ?? "—"}</td>
                  <td className="num mono">{d.memberCount}</td>
                  <td className="num mono">{d.groupBindingCount}</td>
                  <td className="mono dm-cell-muted">{d.ragicTable ?? "—"}</td>
                  <td className="dm-cell-actions">
                    {canEdit && (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={() => setDrawer({ kind: "edit", dept: d })}>{tr("common.edit")}</button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setConfirmDelete(d)}
                          disabled={d.memberCount > 0 || d.groupBindingCount > 0}
                          title={deleteBlockedReason(d)}
                        >
                          {tr("common.delete")}
                        </button>
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
        <DeptDrawer
          tenantId={tenantId}
          onClose={() => setDrawer(null)}
          onSaved={() => { setDrawer(null); refresh(); onChanged(); }}
        />
      )}
      {drawer?.kind === "edit" && (
        <DeptDrawer
          tenantId={tenantId}
          dept={drawer.dept}
          onClose={() => setDrawer(null)}
          onSaved={() => { setDrawer(null); refresh(); onChanged(); }}
        />
      )}
      {confirmDelete && (
        <Drawer open onClose={() => setConfirmDelete(null)} title={tr("dp.deleteTitle")} width={480}>
          <div className="lbot-confirm">
            <p>{tr("dp.deleteBody", { name: confirmDelete.departmentName })}</p>
            <div className="llm-form-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  try {
                    await deleteDepartment(confirmDelete.departmentId, tenantId);
                    toast.show(tr("dp.deleted"), "ok");
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

function DeptDrawer({
  tenantId, dept, onClose, onSaved,
}: {
  tenantId: string;
  dept?: DepartmentDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tr = useT();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(dept?.departmentName ?? "");
  const [displayName, setDisplayName] = useState(dept?.displayName ?? "");
  const isEdit = dept != null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.show(tr("dp.nameRequired"), "danger"); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await updateDepartment(dept.departmentId, {
          tenantId,
          departmentName: name.trim() !== dept.departmentName ? name.trim() : undefined,
          displayName: displayName.trim() !== (dept.displayName ?? "") ? (displayName.trim() || null) : undefined,
        });
      } else {
        await createDepartment({ tenantId, departmentName: name.trim(), displayName: displayName.trim() || undefined });
      }
      toast.show(tr(isEdit ? "dp.updated" : "dp.created"), "ok");
      onSaved();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("common.saveFailed"), "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={tr(isEdit ? "dp.edit" : "dp.new")} subtitle={isEdit ? dept.departmentName : undefined}>
      <form onSubmit={handleSubmit} className="llm-form">
        <div className="field">
          <label>{tr("dp.colName")} *</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} placeholder={tr("dp.namePlaceholder")} required />
          <div className="llm-hint">{tr("dp.nameHint")}</div>
        </div>
        <div className="field">
          <label>{tr("dp.displayName")}</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={saving} placeholder={tr("dp.displayPlaceholder")} />
          <div className="llm-hint">{tr("dp.displayHint")}</div>
        </div>
        {isEdit && (
          <div className="dm-info-note">
            <div className="dm-info-note-lbl">{tr("dp.current")}</div>
            <div>{tr("dp.currentInfo", { m: dept.memberCount, g: dept.groupBindingCount })}</div>
            {/* 兩道刪除條件一次講完、而且要寫出「去哪、按什麼」。
                原本只提群綁定 → 使用者解完綁定回來，再撞一次成員那道。
                而且「解除綁定」在 LINE 機器人管理頁不是這個字，那裡叫「分派部門」選「未分派」。*/}
            {(dept.memberCount > 0 || dept.groupBindingCount > 0) && (
              <div className="dm-info-note-hint">
                {tr("dp.cannotDelete")}
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {dept.memberCount > 0 && (
                    <li>{tr("dp.blockMembers", { n: dept.memberCount })}</li>
                  )}
                  {dept.groupBindingCount > 0 && (
                    <li>
                      {tr("dp.blockGroupsLi", { n: dept.groupBindingCount })}
                      {dept.boundGroupNames?.length ? `：${dept.boundGroupNames.join("、")}` : ""}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? tr("common.saving") : tr(isEdit ? "common.save" : "dp.new")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>{tr("common.cancel")}</button>
        </div>
      </form>
    </Drawer>
  );
}
