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
        // 嘗試撈 failures list
        const raw = (err as unknown as { message: string }).message;
        toast.show(raw || tr("common.updateFailed"), "danger");
        if (raw?.includes("密碼不符合安全政策")) {
          setFailures([tr("flc.f1"), tr("flc.f2")]);
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
