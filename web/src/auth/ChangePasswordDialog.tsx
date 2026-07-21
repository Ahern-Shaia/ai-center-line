import { useState } from "react";
import Drawer from "../shared/Drawer";
import { changePassword, ApiError } from "../api";
import { useToast } from "../Toast";

// 使用者自服務改密碼 · Topbar user menu 觸發
export default function ChangePasswordDialog({ open, onClose }: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      toast.show("新密碼與確認不符", "danger");
      return;
    }
    setSaving(true);
    try {
      await changePassword(oldPassword, newPassword);
      toast.show("密碼已更新", "ok");
      setOldPassword(""); setNewPassword(""); setConfirm("");
      onClose();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "更新失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="變更密碼" subtitle="為安全起見 · 建議定期更換">
      <form onSubmit={handleSubmit} className="llm-form">
        <div className="field">
          <label>目前密碼</label>
          <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} disabled={saving} autoComplete="current-password" required />
        </div>
        <div className="field">
          <label>新密碼</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={saving} autoComplete="new-password" required />
          <div className="llm-hint">≥ 12 字 · 大小寫、數字、符號四選三 · 不可含 email 前綴或顯示名</div>
        </div>
        <div className="field">
          <label>確認新密碼</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={saving} autoComplete="new-password" required />
        </div>
        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "儲存中…" : "變更密碼"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>取消</button>
        </div>
      </form>
    </Drawer>
  );
}
