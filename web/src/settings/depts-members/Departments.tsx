import Spinner from "../../shared/Spinner";
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
  if (d.memberCount > 0) parts.push(`尚有 ${d.memberCount} 名成員（到「成員」分頁改分派或移除）`);
  if (d.groupBindingCount > 0) {
    const names = d.boundGroupNames?.length ? `：${d.boundGroupNames.join("、")}` : "";
    parts.push(`尚綁 ${d.groupBindingCount} 群${names}（到「LINE 機器人管理」把該群的「分派部門」改成「未分派」）`);
  }
  return parts.length === 0 ? "" : `不可刪除 —— ${parts.join("；")}`;
}

export function Departments({
  tenantId, canEdit, onChanged,
}: {
  tenantId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
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
          <button className="btn btn-primary" onClick={() => setDrawer({ kind: "new" })}>+ 新增部門</button>
        </div>
      )}

      {loading ? (
        <Spinner block />
      ) : rows.length === 0 ? (
        <div className="dm-empty">
          <div>還沒有建立部門</div>
          {/* 只說「點右上新增」沒回答「為什麼要建」—— 部門是整套系統的切分依據，
              不先建，後面分派群組／看板／權限全都卡住 */}
          <div className="dm-empty-hint">
            <b>部門是整套系統的切分依據</b> —— 任務、日報、看得到什麼，都是照部門分的。<br />
            建議跟 LINE 群名對應（群「○○—品保部」→ 部門「品保部」），
            之後在「LINE 群組」把各群分派進來。<br />
            {canEdit && <>從右上的「新增部門」開始。</>}
          </div>
        </div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th>部門名</th>
                <th>顯示名稱</th>
                <th className="num">成員</th>
                <th className="num">綁定群</th>
                <th>對應表單</th>
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
                        <button className="btn btn-sm btn-ghost" onClick={() => setDrawer({ kind: "edit", dept: d })}>編輯</button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setConfirmDelete(d)}
                          disabled={d.memberCount > 0 || d.groupBindingCount > 0}
                          title={deleteBlockedReason(d)}
                        >
                          刪除
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
        <Drawer open onClose={() => setConfirmDelete(null)} title="確認刪除部門" width={480}>
          <div className="lbot-confirm">
            <p>即將刪除部門 <b>{confirmDelete.departmentName}</b> · 此操作無法還原。</p>
            <div className="llm-form-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  try {
                    await deleteDepartment(confirmDelete.departmentId, tenantId);
                    toast.show("部門已刪除", "ok");
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

function DeptDrawer({
  tenantId, dept, onClose, onSaved,
}: {
  tenantId: string;
  dept?: DepartmentDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(dept?.departmentName ?? "");
  const [displayName, setDisplayName] = useState(dept?.displayName ?? "");
  const isEdit = dept != null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.show("部門名不可為空", "danger"); return; }
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
      toast.show(isEdit ? "部門已更新" : "部門已新增", "ok");
      onSaved();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "儲存失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={isEdit ? "編輯部門" : "新增部門"} subtitle={isEdit ? dept.departmentName : undefined}>
      <form onSubmit={handleSubmit} className="llm-form">
        <div className="field">
          <label>部門名 *</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} placeholder="例：業務二部" required />
          <div className="llm-hint">正式名稱 · 對外顯示與內部搜尋皆用此欄</div>
        </div>
        <div className="field">
          <label>顯示名稱（選填）</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={saving} placeholder="縮寫或別稱 · 空則沿用部門名" />
          <div className="llm-hint">戰情室卡片標題可用此欄縮短顯示</div>
        </div>
        {isEdit && (
          <div className="dm-info-note">
            <div className="dm-info-note-lbl">現況資訊</div>
            <div>成員 {dept.memberCount} 人 · 綁定 LINE 群 {dept.groupBindingCount} 個</div>
            {/* 兩道刪除條件一次講完、而且要寫出「去哪、按什麼」。
                原本只提群綁定 → 使用者解完綁定回來，再撞一次成員那道。
                而且「解除綁定」在 LINE 機器人管理頁不是這個字，那裡叫「分派部門」選「未分派」。*/}
            {(dept.memberCount > 0 || dept.groupBindingCount > 0) && (
              <div className="dm-info-note-hint">
                此部門目前<b>不可刪除</b>，需先處理：
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {dept.memberCount > 0 && (
                    <li>成員 {dept.memberCount} 人 —— 到上方「成員」分頁改分派或移除</li>
                  )}
                  {dept.groupBindingCount > 0 && (
                    <li>
                      綁定 LINE 群 {dept.groupBindingCount} 個
                      {dept.boundGroupNames?.length ? `：${dept.boundGroupNames.join("、")}` : ""}
                      {" "}—— 到「LINE 機器人管理」找到該群，把「分派部門」改成<b>「未分派」</b>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "儲存中…" : isEdit ? "儲存變更" : "新增部門"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>取消</button>
        </div>
      </form>
    </Drawer>
  );
}
