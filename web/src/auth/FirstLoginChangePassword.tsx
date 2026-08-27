import { useState } from "react";
import { changePassword, clearMustChange, logout, ApiError } from "../api";
import { useToast } from "../Toast";
import { useT } from "../i18n/useT";

interface Props {
  email: string;
  onDone: () => void;
}

// 首次登入強制改密碼 · 全螢幕 · 沒改前無法進 shell
export default function FirstLoginChangePassword({ email, onDone }: Props) {
  const tr = useT();
  const toast = useToast();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFailures([]);
    if (newPassword !== confirm) {
      toast.show(tr("cpw.mismatch"), "danger");
      return;
    }
    if (!oldPassword.trim() || !newPassword.trim()) {
      toast.show(tr("flc.blank"), "danger");
      return;
    }
    setSaving(true);
    try {
      await changePassword(oldPassword, newPassword);
      clearMustChange();
      toast.show(tr("flc.done"), "ok");
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.show(err.message || tr("common.updateFailed"), "danger");
        // ⚠️ 比**機器碼**不比訊息文字 —— 原本比對「密碼不符合安全政策」這句中文，
        //    server 改吃 Accept-Language 之後（i18n.md M4b）英文使用者就永遠不會命中，
        //    而且不會報錯，只是那張「哪裡不合格」的清單靜靜消失。
        const body = err.body as { status?: string; failures?: unknown } | undefined;
        if (body?.status === "password_policy_violation") {
          // 用 server 回的實際違規項（已依語言翻好），不是寫死那兩條 ——
          // 寫死的版本連「密碼含你的 email」這種真正的原因都講不出來。
          const list = Array.isArray(body.failures) ? body.failures.filter((x): x is string => typeof x === "string") : [];
          setFailures(list.length > 0 ? list : [tr("flc.f1"), tr("flc.f2")]);
        }
      } else {
        toast.show(tr("common.updateFailed"), "danger");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="firstlogin-wrap">
      <div className="firstlogin-card">
        <div className="firstlogin-hdr">
          <h1>{tr("flc.title")}</h1>
          <p>{tr("flc.sub")}</p>
          <p className="firstlogin-email">{email}</p>
        </div>
        <form onSubmit={handleSubmit} className="llm-form">
          <div className="field">
            <label>{tr("cpw.current")}</label>
            <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} disabled={saving} autoComplete="current-password" required />
          </div>
          <div className="field">
            <label>{tr("cpw.new")}</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={saving} autoComplete="new-password" required />
            <div className="llm-hint">
              {tr("flc.rule")}
            </div>
          </div>
          <div className="field">
            <label>{tr("cpw.confirm")}</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={saving} autoComplete="new-password" required />
          </div>
          {failures.length > 0 && (
            <div className="llm-tip" style={{ marginTop: 0 }}>
              <strong>{tr("flc.policyFail")}</strong>
              <ul>{failures.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
          <div className="llm-form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? tr("common.saving") : tr("flc.submit")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { logout(); location.reload(); }} disabled={saving}>
              {tr("menu.logout")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
