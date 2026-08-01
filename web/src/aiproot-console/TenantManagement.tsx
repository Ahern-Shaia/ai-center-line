import Spinner from "../shared/Spinner";
import { useCallback, useEffect, useState } from "react";
import { usePermissions } from "../permission/PermissionContext";
import OnboardWizard from "./OnboardWizard";
import {
  ApiError, listAiprootTenants, listExtractionTemplates, listTenantLoginAccounts,
  resetUserPassword, setExtractionTemplate, unlockUser,
  type AiprootTenantOption, type ExtractionTemplateOption, type TenantUserRow,
} from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";

// 租戶管理（aiproot）· 開通後的救援窗口
// 開通當下的一次性密碼只顯示一次；忘記帳號或密碼時，在這裡查得到「帳號是誰」、重設得了密碼。
// 密碼本身一律不回（連雜湊都不回）——只能產新的。
const ROLE_LABEL: Record<string, string> = {
  aiproot_admin: "AIPROOT 管理員", consultant: "顧問",
  tenant_admin: "總經理室", group_owner: "部門主管", employee: "一般員工",
};

export default function TenantManagement() {
  const perms = usePermissions();
  const [onboarding, setOnboarding] = useState(false);
  const toast = useToast();
  const [tenants, setTenants] = useState<AiprootTenantOption[]>([]);
  const [selected, setSelected] = useState<AiprootTenantOption | null>(null);
  const [users, setUsers] = useState<TenantUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [resetTarget, setResetTarget] = useState<TenantUserRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState<{ email: string | null; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [templates, setTemplates] = useState<ExtractionTemplateOption[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => { listExtractionTemplates().then((r) => setTemplates(r.templates)).catch(() => setTemplates([])); }, []);

  async function changeTemplate(template: string) {
    if (!selected || savingTemplate) return;
    setSavingTemplate(true);
    try {
      await setExtractionTemplate(selected.tenantId, template);
      setSelected({ ...selected, extractionTemplate: template });
      setTenants((s) => s.map((x) => x.tenantId === selected.tenantId ? { ...x, extractionTemplate: template } : x));
      toast.show("已更新業種模板 · 之後的分析才會套用", "ok");
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "更新失敗", "danger"); }
    finally { setSavingTemplate(false); }
  }

  useEffect(() => {
    listAiprootTenants()
      .then((r) => { setTenants(r.tenants); setSelected((s) => s ?? r.tenants[0] ?? null); })
      .catch((e) => toast.show(e instanceof ApiError ? e.message : "載入租戶失敗", "danger"))
      .finally(() => setLoading(false));
  }, [toast]);

  const loadUsers = useCallback(async (tenantId: string) => {
    setUsersLoading(true);
    try { setUsers((await listTenantLoginAccounts(tenantId)).users); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "載入帳號失敗", "danger"); setUsers([]); }
    finally { setUsersLoading(false); }
  }, [toast]);
  useEffect(() => { if (selected) void loadUsers(selected.tenantId); }, [selected, loadUsers]);

  async function doReset() {
    if (!resetTarget || !selected) return;
    setBusy(true);
    try {
      const r = await resetUserPassword(resetTarget.userId, selected.tenantId);
      setNewPassword({ email: r.email, password: r.newPassword });
      setCopied(false);
      setResetTarget(null);
      void loadUsers(selected.tenantId);
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "重設失敗", "danger"); }
    finally { setBusy(false); }
  }

  async function doUnlock(u: TenantUserRow) {
    if (!selected) return;
    try {
      await unlockUser(u.userId, selected.tenantId);
      toast.show("已解鎖", "ok");
      void loadUsers(selected.tenantId);
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "解鎖失敗", "danger"); }
  }

  if (newPassword) {
    return (
      <div className="pane">
        <div className="pane-hdr"><div>
          <h1>密碼已重設</h1>
          <div className="sub">立刻複製並透過帶外通道交給對方 · 離開此頁就看不到了</div>
        </div></div>
        <div className="onboard-success">
          <div className="onboard-success-row">
            <div className="lbl">登入帳號</div>
            <div className="val mono">{newPassword.email ?? "（無 email）"}</div>
          </div>
          <div className="onboard-success-password">
            <div className="lbl">新密碼</div>
            <div className="val mono onboard-pw">{newPassword.password}</div>
            <button className="btn btn-primary"
              onClick={() => { void navigator.clipboard?.writeText(newPassword.password); setCopied(true); }}>
              {copied ? "已複製 ✓" : "複製密碼"}
            </button>
          </div>
          <div className="onboard-warn">
            <strong>⚠️ 密碼只在此頁顯示一次</strong>
            <p>請透過電話／當面等帶外通道交付，不要用 LINE 或 email 傳。對方首次登入時系統會強制改密碼。</p>
          </div>
        </div>
        <div className="llm-form-actions">
          <button className="btn btn-primary" onClick={() => setNewPassword(null)} disabled={!copied}>
            {copied ? "完成 · 回租戶管理" : "請先複製密碼"}
          </button>
        </div>
      </div>
    );
  }

  if (onboarding) {
    return (
      <div className="pane">
        <div className="pane-hdr">
          <div><h1>新增租戶</h1></div>
          <button className="btn btn-ghost" onClick={() => setOnboarding(false)}>返回租戶管理</button>
        </div>
        <OnboardWizard />
      </div>
    );
  }

  return (
    <div className="pane">
      {/* 「開通新租戶」原本是獨立的側欄項目 —— 但它是租戶管理的一個動作，
          不是一個要常駐在導覽上的地方（M4 合併）。 */}
      <div className="pane-hdr">
        <div>
          <h1>租戶管理</h1>
          <div className="sub">查已開通的租戶與其登入帳號 · 忘記密碼可在此重設（產新密碼，無法查看舊的）</div>
        </div>
        {perms.has("tenants:onboard") && (
          <button className="btn btn-primary" onClick={() => setOnboarding(true)}>新增租戶</button>
        )}
      </div>

      {loading ? (
        <Spinner block />
      ) : tenants.length === 0 ? (
        <div className="dm-empty">
          尚未開通任何租戶
          <div className="dm-empty-hint">到「開通新租戶」建立第一家</div>
        </div>
      ) : (
        <div className="tm-split">
          <div className="tm-list">
            {tenants.map((t) => (
              <button key={t.tenantId}
                className={`tm-item${selected?.tenantId === t.tenantId ? " active" : ""}`}
                onClick={() => setSelected(t)}>
                <span className="tm-item-name">{t.tenantName}</span>
                <span className="tm-item-sub">{t.batchEnabled ? "對話分析啟用" : "對話分析停用"}</span>
              </button>
            ))}
          </div>

          <div className="tm-detail">
            {selected && templates.length > 0 && (
              <div className="tm-template">
                <div className="tm-template-hd">
                  業種模板
                  <span className="tm-template-hint">
                    決定 AI 除了通用欄位外，還要多抽哪些業種專屬欄位。改了只影響<b>之後</b>的分析，
                    已經抽過的結果不會變動。選完可到「抽取健康度」看套得準不準。
                  </span>
                </div>
                <div className="tm-template-opts">
                  {templates.map((t) => {
                    const active = (selected.extractionTemplate ?? "factory_report") === t.key;
                    return (
                      <button key={t.key} className={`tm-template-opt${active ? " active" : ""}`}
                        onClick={() => void changeTemplate(t.key)} disabled={savingTemplate || active}>
                        <span className="tm-template-label">{t.label}</span>
                        <span className="tm-template-desc">{t.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {!selected ? null : usersLoading ? (
              <Spinner block />
            ) : users.length === 0 ? (
              <div className="dm-empty">
                這個租戶還沒有任何帳號
                <div className="dm-empty-hint">開通流程應該會建立一個總經理室帳號 · 若為空請確認開通是否完成</div>
              </div>
            ) : (
              <>
                <table className="nc-tbl">
                  <thead><tr>
                    <th style={{ width: "28%" }}>登入帳號</th><th style={{ width: "16%" }}>姓名</th>
                    <th style={{ width: "14%" }}>角色</th><th style={{ width: "18%" }}>狀態</th>
                    <th style={{ width: "14%" }}>最後登入</th><th style={{ width: "10%" }}>操作</th>
                  </tr></thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.userId}>
                        <td className="nc-t-mono" style={{ fontSize: 12 }}>{u.email ?? "（未設 email）"}</td>
                        <td>{u.displayName ?? "—"}{u.departmentName && <div className="nc-t-sub">{u.departmentName}</div>}</td>
                        <td style={{ fontSize: 12.5 }}>{ROLE_LABEL[u.role] ?? u.role}</td>
                        <td>
                          {u.locked ? <span className="nc-pill danger">已鎖定</span>
                            : u.mustChangePassword ? <span className="nc-pill warn">待改密碼</span>
                            : <span className="nc-pill ok">正常</span>}
                          {u.failedLoginCount > 0 && <div className="nc-t-sub">連續失敗 {u.failedLoginCount} 次</div>}
                        </td>
                        <td className="nc-t-mono" style={{ fontSize: 12 }}>
                          {u.lastLoginAt ? formatDate(u.lastLoginAt) : "從未登入"}
                        </td>
                        <td>
                          <div className="nc-act">
                            <button className="nc-lnk" onClick={() => setResetTarget(u)}>重設密碼</button>
                            {u.locked && <button className="nc-lnk mut" onClick={() => void doUnlock(u)}>解鎖</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="login-hint" style={{ marginTop: 12 }}>
                  共 {users.length} 個帳號 · 系統不保存明碼密碼，忘記只能重設產生新的。
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={resetTarget != null}
        title="重設密碼"
        body={`將為「${resetTarget?.email ?? resetTarget?.displayName ?? ""}」產生一組新密碼，舊密碼立即失效。對方下次登入會被要求改密碼。`}
        confirmLabel="產生新密碼"
        busy={busy}
        onConfirm={() => void doReset()}
        onClose={() => setResetTarget(null)}
      />
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
