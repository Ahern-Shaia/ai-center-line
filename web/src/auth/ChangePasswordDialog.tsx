import { useState } from "react";
import Drawer from "../shared/Drawer";
import { changePassword, ApiError } from "../api";
import { useToast } from "../Toast";
import { useT } from "../i18n/useT";

// 使用者自服務改密碼 · Topbar user menu 觸發
export default function ChangePasswordDialog({ open, onClose }: {
  open: boolean;
  onClose: () => void;
}) {
  const tr = useT();
  const toast = useToast();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      toast.show(tr("cpw.mismatch"), "danger");
      return;
    }
    setSaving(true);
    try {
      await changePassword(oldPassword, newPassword);
      toast.show(tr("cpw.updated"), "ok");
      setOldPassword(""); setNewPassword(""); setConfirm("");
      onClose();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("common.updateFailed"), "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={tr("cpw.title")} subtitle={tr("cpw.sub")}>
      <form onSubmit={handleSubmit} className="llm-form">
        <div className="field">
          <label>{tr("cpw.current")}</label>
          <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} disabled={saving} autoComplete="current-password" required />
        </div>
        <div className="field">
          <label>{tr("cpw.new")}</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={saving} autoComplete="new-password" required />
          <div className="llm-hint">{tr("cpw.rule")}</div>
        </div>
        <div className="field">
          <label>{tr("cpw.confirm")}</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={saving} autoComplete="new-password" required />
        </div>
        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? tr("common.saving") : tr("cpw.title")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>{tr("common.cancel")}</button>
        </div>
      </form>
    </Drawer>
  );
}
