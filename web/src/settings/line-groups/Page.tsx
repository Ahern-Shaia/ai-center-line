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
import StyledSelect from "../../shared/StyledSelect";

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

  const refresh = useCallback(async () => {
    if (!canView || !session?.tenantId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [gRes, dRes] = await Promise.all([
        listTenantLineGroups(),
        listDepartments(session.tenantId),
      ]);
      setGroups(gRes.groups);
      setDepts(dRes.departments);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [canView, session?.tenantId, toast]);

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

  async function handleToggleAnalyze(groupRegistryId: string, enabled: boolean) {
    setSavingIds((s) => new Set(s).add(groupRegistryId));
    try {
      const res = await patchLineGroup(groupRegistryId, { analyzeEnabled: enabled });
      setGroups((s) => s.map((g) => g.groupRegistryId === groupRegistryId ? res.group : g));
      toast.show(enabled ? "已啟用 AI 分析" : "已停用 AI 分析", "ok");
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
            {loading ? "載入中…" : `本 tenant 共 ${activeGroups.length} 群 (啟用中)${leftGroups.length > 0 ? ` · ${leftGroups.length} 群已離開` : ""}`}
            {unassignedCount > 0 && <span style={{ color: "var(--warn)", marginLeft: 8 }}> · <b>{unassignedCount}</b> 群未分派部門</span>}
          </div>
        </div>
      </div>

      {loading && <div className="dm-empty">載入中…</div>}

      {!loading && activeGroups.length === 0 && leftGroups.length === 0 && (
        <div className="dm-empty">尚無群組 · 加 bot 到 LINE 群後 · 首則訊息會自動註冊</div>
      )}

      {!loading && activeGroups.length > 0 && (
        <table className="lg-table">
          <thead>
            <tr>
              <th style={{ minWidth: 180 }}>群組</th>
              <th style={{ minWidth: 160 }}>部門</th>
              <th style={{ minWidth: 90 }}>AI 分析</th>
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
                    <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono, ui-monospace, monospace)" }}>{g.groupId.slice(0, 16)}…</div>
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
                      <label style={{ cursor: saving ? "not-allowed" : "pointer" }}>
                        <input
                          type="checkbox"
                          checked={g.analyzeEnabled}
                          disabled={saving}
                          onChange={(e) => void handleToggleAnalyze(g.groupRegistryId, e.target.checked)}
                        />{" "}
                        <span style={{ fontSize: 12, color: g.analyzeEnabled ? "var(--ok, #059669)" : "var(--ink-3)" }}>
                          {g.analyzeEnabled ? "啟用" : "停用"}
                        </span>
                      </label>
                    ) : (
                      <span style={{ fontSize: 12, color: g.analyzeEnabled ? "var(--ok, #059669)" : "var(--ink-3)" }}>
                        {g.analyzeEnabled ? "啟用" : "停用"}
                      </span>
                    )}
                  </td>
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
          <h2 style={{ fontSize: 14, marginTop: 24, marginBottom: 8, color: "var(--ink-3)" }}>已離開的群 ({leftGroups.length})</h2>
          <table className="lg-table lg-table-left">
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>群組</th>
                <th style={{ minWidth: 160 }}>原部門</th>
                <th style={{ minWidth: 120 }}>最後活動</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
