import { useState } from "react";
import { changePassword, clearMustChange, logout, ApiError } from "../api";
import { useToast } from "../Toast";

interface Props {
  email: string;
  onDone: () => void;
}

// 首次登入強制改密碼 · 全螢幕 · 沒改前無法進 shell
export default function FirstLoginChangePassword({ email, onDone }: Props) {
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
      toast.show("新密碼與確認不符", "danger");
      return;
    }
    if (!oldPassword.trim() || !newPassword.trim()) {
      toast.show("欄位不可為空", "danger");
      return;
    }
    setSaving(true);
    try {
      await changePassword(oldPassword, newPassword);
      clearMustChange();
      toast.show("密碼已更新 · 歡迎使用", "ok");
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        // 嘗試撈 failures list
        const raw = (err as unknown as { message: string }).message;
        toast.show(raw || "更新失敗", "danger");
        if (raw?.includes("密碼不符合安全政策")) {
          setFailures(["長度需 ≥ 12 字元", "需包含大寫、小寫、數字、符號 四選三"]);
        }
      } else {
        toast.show("更新失敗", "danger");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="firstlogin-wrap">
      <div className="firstlogin-card">
        <div className="firstlogin-hdr">
          <h1>首次登入 · 請設定新密碼</h1>
          <p>為確保帳號安全 · 首次登入必須更改密碼。</p>
          <p className="firstlogin-email">{email}</p>
        </div>
        <form onSubmit={handleSubmit} className="llm-form">
          <div className="field">
            <label>目前密碼</label>
            <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} disabled={saving} autoComplete="current-password" required />
          </div>
          <div className="field">
            <label>新密碼</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={saving} autoComplete="new-password" required />
            <div className="llm-hint">
              需 ≥ 12 字 · 大寫、小寫、數字、符號 四選三 · 不可含 email 或姓名 · 不可為常見弱密碼
            </div>
          </div>
          <div className="field">
            <label>確認新密碼</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={saving} autoComplete="new-password" required />
          </div>
          {failures.length > 0 && (
            <div className="llm-tip" style={{ marginTop: 0 }}>
              <strong>密碼不符合政策</strong>
              <ul>{failures.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
          <div className="llm-form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "儲存中…" : "設定新密碼並進入系統"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { logout(); location.reload(); }} disabled={saving}>
              登出
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
