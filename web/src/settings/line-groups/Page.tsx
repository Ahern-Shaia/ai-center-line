import Spinner from "../../shared/Spinner";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getSession,
  listDepartments,
  listTenantLineGroups,
  patchLineGroup,
  type DepartmentDto,
  type LineGroupRow,
} from "../../api";
import { usePermissions } from "../../permission/PermissionContext";
import { useToast } from "../../Toast";
import ConfirmDialog from "../../shared/ConfirmDialog";
import StyledSelect from "../../shared/StyledSelect";
import { GROUP_TYPE_LABEL, GROUP_TYPE_HINT, type LineGroupType } from "../../api";
import { useTenantPicker } from "../../shared/TenantPicker";

// tenant_admin「LINE 群組」頁
// 對照 docs/roles-permissions-matrix.md §3.4 · perm=line-groups:view / assign
// 為了 tenant 自己清楚哪個 LINE 群屬於哪個部門 · 提供分派 UI
export default function LineGroupsPage() {
  const session = getSession();
  const perms = usePermissions();
  const toast = useToast();
  const canView = perms.has("line-groups:view");
  const canAssign = perms.has("line-groups:assign");

  const [groups, setGroups] = useState<LineGroupRow[]>([]);
  const [depts, setDepts] = useState<DepartmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  // 平台角色要先選看哪一家；客戶方只有自己一家，picker 回 null
  const [pickedTenantId, picker, tenantReady] = useTenantPicker();
  // aiproot 的 session.tenantId 是 null —— 原本用它當前提，整頁就永遠是空白，
  // 而且連錯誤都沒有（前端根本沒發請求）。改用 picker 的結果。
  const scopeTenantId = pickedTenantId ?? session?.tenantId ?? null;

  const refresh = useCallback(async () => {
    if (!canView || !tenantReady || !scopeTenantId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [gRes, dRes] = await Promise.all([
        listTenantLineGroups(pickedTenantId),
        listDepartments(scopeTenantId),
      ]);
      setGroups(gRes.groups);
      setDepts(dRes.departments);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [canView, tenantReady, scopeTenantId, pickedTenantId, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleAssign(groupRegistryId: string, departmentId: string | null) {
    setSavingIds((s) => new Set(s).add(groupRegistryId));
    try {
      const res = await patchLineGroup(groupRegistryId, { departmentId });
      setGroups((s) => s.map((g) => g.groupRegistryId === groupRegistryId ? res.group : g));
      toast.show("已分派", "ok");
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "分派失敗", "danger");
    } finally {
      setSavingIds((s) => {
        const next = new Set(s);
        next.delete(groupRegistryId);
        return next;
      });
    }
  }

  /**
   * @param field analyzeEnabled = 要不要跑 AI 分析 · replyEnabled = bot 要不要在群裡回話
   * 兩者刻意分開：客戶可能想要分析照跑，只是不要 bot 在群裡出聲。
   */
  // 0059 · 把已離開的群移出清單（隱藏，非刪除 —— 歷史群組日誌仍靠這列顯示群名）
  const [confirmHide, setConfirmHide] = useState<{ id: string; name: string } | null>(null);
  async function doHide() {
    if (!confirmHide) return;
    const id = confirmHide.id;
    setSavingIds((s) => new Set(s).add(id));
    try {
      await patchLineGroup(id, { hidden: true });
      toast.show("已移除（歷史記錄仍保留群名）", "ok");
      setConfirmHide(null);
      await refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "移除失敗", "danger");
    } finally {
      setSavingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  /**
   * 0068 · 改群組類型（docs/modules/group-type-classification.md）
   *
   * 只有 department 型會決定成員的部門歸屬、健康度分母與部門推導；
   * 其餘類型照常分析、照常出任務 —— 改這個不會讓任何資料消失。
   */
  async function handleGroupType(groupRegistryId: string, groupType: LineGroupType) {
    setSavingIds((s) => new Set(s).add(groupRegistryId));
    try {
      const res = await patchLineGroup(groupRegistryId, { groupType });
      setGroups((s) => s.map((g) => g.groupRegistryId === groupRegistryId ? res.group : g));
      toast.show(`已改為「${GROUP_TYPE_LABEL[groupType]}」`, "ok");
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "更新失敗", "danger");
    } finally {
      setSavingIds((s) => {
        const next = new Set(s);
        next.delete(groupRegistryId);
        return next;
      });
    }
  }

  async function handleToggle(
    groupRegistryId: string, field: "analyzeEnabled" | "replyEnabled", enabled: boolean,
  ) {
    const label = field === "analyzeEnabled" ? "AI 分析" : "群組回話";
    setSavingIds((s) => new Set(s).add(groupRegistryId));
    try {
      const res = await patchLineGroup(groupRegistryId, { [field]: enabled });
      setGroups((s) => s.map((g) => g.groupRegistryId === groupRegistryId ? res.group : g));
      toast.show(`已${enabled ? "啟用" : "停用"}${label}`, "ok");
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "更新失敗", "danger");
    } finally {
      setSavingIds((s) => {
        const next = new Set(s);
        next.delete(groupRegistryId);
        return next;
      });
    }
  }

  const activeGroups = useMemo(() => groups.filter((g) => g.status === "active"), [groups]);
  const leftGroups = useMemo(() => groups.filter((g) => g.status === "left"), [groups]);
  const unassignedCount = useMemo(() => activeGroups.filter((g) => !g.departmentId).length, [activeGroups]);

  if (!canView) {
    return (
      <div className="pane">
        <div className="pane-hdr"><div><h1>LINE 群組</h1></div></div>
        <div className="dm-empty">你的角色無權查看此頁 · 請聯繫管理員</div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>LINE 群組</h1>
          <div className="sub">
            {loading ? "載入中…" : `共 ${activeGroups.length} 個群組（啟用中）${leftGroups.length > 0 ? ` · ${leftGroups.length} 群已離開` : ""}`}
            {unassignedCount > 0 && <span style={{ color: "var(--warn)", marginLeft: 8 }}> · <b>{unassignedCount}</b> 群未分派部門</span>}
          </div>
        </div>
        {picker}
      </div>

      {loading && <Spinner block />}

      {!loading && activeGroups.length === 0 && leftGroups.length === 0 && (
        <div className="dm-empty">尚無群組 · 加 bot 到 LINE 群後 · 首則訊息會自動註冊</div>
      )}

      {!loading && activeGroups.length > 0 && (
        <table className="lg-table">
          <thead>
            <tr>
              <th style={{ minWidth: 180 }}>群組</th>
              <th style={{ minWidth: 160 }}>部門</th>
              <th style={{ minWidth: 150 }}>群組類型</th>
              <th style={{ minWidth: 90 }}>AI 分析</th>
              <th style={{ minWidth: 100 }}>群組回話</th>
              <th style={{ minWidth: 90, textAlign: "right" }}>訊息數</th>
              <th style={{ minWidth: 120 }}>最後活動</th>
            </tr>
          </thead>
          <tbody>
            {activeGroups.map((g) => {
              const saving = savingIds.has(g.groupRegistryId);
              return (
                <tr key={g.groupRegistryId}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{g.displayName ?? "(群名未同步)"}</div>
                    {/* ⚠️ 要能複製**完整**的 ID。原本只顯示 slice(0,16)…，
                        而群組 ID 在 LINE App 裡本來就看不到 —— 這裡截斷就等於沒有人拿得到它，
                        「通知設定」那邊的「手動輸入群組 ID」也跟著變成一條死路。*/}
                    <button
                      type="button"
                      className="lg-gid"
                      title={`點一下複製完整 ID：${g.groupId}`}
                      onClick={() => {
                        void navigator.clipboard?.writeText(g.groupId);
                        toast.show("已複製完整群組 ID", "ok");
                      }}
                    >{g.groupId.slice(0, 16)}… <span className="lg-gid-cp">複製</span></button>
                  </td>
                  <td>
                    {canAssign ? (
                      <StyledSelect
                        items={depts.map((d) => ({ id: d.departmentId, label: d.departmentName }))}
                        value={g.departmentId ?? ""}
                        onChange={(v) => void handleAssign(g.groupRegistryId, v || null)}
                        ariaLabel={`分派「${g.displayName ?? g.groupId}」到部門`}
                        disabled={saving}
                        allowEmpty
                        emptyLabel="(未分派)"
                      />
                    ) : (
                      <span>{g.departmentName ?? "(未分派)"}</span>
                    )}
                  </td>
                  <td>
                    {canAssign ? (
                      <>
                        <StyledSelect
                          items={(Object.keys(GROUP_TYPE_LABEL) as LineGroupType[])
                            .map((t) => ({ id: t, label: GROUP_TYPE_LABEL[t] }))}
                          value={g.groupType}
                          onChange={(v) => void handleGroupType(g.groupRegistryId, v as LineGroupType)}
                          ariaLabel={`「${g.displayName ?? g.groupId}」的群組類型`}
                          disabled={saving}
                        />
                        {/* 少了這句沒人知道該選哪個 —— 四個類型的差別不在字面上 */}
                        <div className="lg-type-hint">{GROUP_TYPE_HINT[g.groupType]}</div>
                      </>
                    ) : (
                      <span>{GROUP_TYPE_LABEL[g.groupType]}</span>
                    )}
                  </td>
                  <ToggleCell
                    on={g.analyzeEnabled} editable={canAssign} saving={saving}
                    label={`「${g.displayName ?? g.groupId}」的 AI 分析`}
                    onChange={(v) => void handleToggle(g.groupRegistryId, "analyzeEnabled", v)}
                  />
                  {/* bot 在群裡回「已收到完成回報」那類訊息。誤判會被整個群看到，
                      所以客戶要能自己關掉（2026-07-29 回報）。關掉不影響分析與訊號落地。 */}
                  <ToggleCell
                    on={g.replyEnabled} editable={canAssign} saving={saving}
                    label={`「${g.displayName ?? g.groupId}」的群組回話`}
                    onChange={(v) => void handleToggle(g.groupRegistryId, "replyEnabled", v)}
                  />
                  <td style={{ textAlign: "right", fontFamily: "var(--mono, ui-monospace, monospace)", fontSize: 12 }}>{g.eventCount}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{formatDateTime(g.lastEventAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!loading && leftGroups.length > 0 && (
        <>
          <h2 style={{ fontSize: 14, marginTop: 24, marginBottom: 4, color: "var(--ink-3)" }}>已離開的群 ({leftGroups.length})</h2>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 8 }}>
            bot 已不在這些群 · 可「移除」讓清單乾淨（歷史記錄仍保留群名；bot 若被重新加入會自動回到上方清單）
          </div>
          <table className="lg-table lg-table-left">
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>群組</th>
                <th style={{ minWidth: 160 }}>原部門</th>
                <th style={{ minWidth: 120 }}>最後活動</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leftGroups.map((g) => (
                <tr key={g.groupRegistryId} style={{ opacity: 0.55 }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{g.displayName ?? "(群名未同步)"}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{g.groupId.slice(0, 16)}…</div>
                  </td>
                  <td>{g.departmentName ?? "(未分派)"}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{formatDateTime(g.lastEventAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    {canAssign && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setConfirmHide({ id: g.groupRegistryId, name: g.displayName ?? g.groupId.slice(0, 16) })}
                        disabled={savingIds.has(g.groupRegistryId)}
                      >移除</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <ConfirmDialog
        open={confirmHide !== null}
        onClose={() => { if (!confirmHide || !savingIds.has(confirmHide.id)) setConfirmHide(null); }}
        onConfirm={() => void doHide()}
        busy={confirmHide ? savingIds.has(confirmHide.id) : false}
        title="移除已離開的群"
        body={
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            將「<b>{confirmHide?.name}</b>」從清單移除。
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-3)" }}>
              這只是隱藏，不會刪除資料 —— 過去的群組日誌、分析記錄仍會顯示這個群名。
              若 bot 之後被重新加入該群，它會自動回到上方的群組清單。
            </div>
          </div>
        }
        confirmLabel="確定移除"
        tone="primary"
      />
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 表格裡的開關格 · 沒有編輯權限時只顯示狀態 */
function ToggleCell({ on, editable, saving, label, onChange }: {
  on: boolean; editable: boolean; saving: boolean; label: string; onChange: (v: boolean) => void;
}) {
  const text = (
    <span style={{ fontSize: 12, color: on ? "var(--ok, #059669)" : "var(--ink-3)" }}>
      {on ? "啟用" : "停用"}
    </span>
  );
  return (
    <td>
      {editable ? (
        <label style={{ cursor: saving ? "not-allowed" : "pointer" }}>
          <input type="checkbox" checked={on} disabled={saving} aria-label={label}
            onChange={(e) => onChange(e.target.checked)} />{" "}
          {text}
        </label>
      ) : text}
    </td>
  );
}
