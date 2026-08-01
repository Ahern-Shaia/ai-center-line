import { useState } from "react";
import Drawer from "../shared/Drawer";
import { updateMyDisplayName, ApiError } from "../api";
import { useToast } from "../Toast";

// 使用者自服務改顯示名稱 · Topbar user menu 觸發 · LINE 登入用戶把佔位名改成真名
export default function ChangeDisplayNameDialog({ open, current, onClose }: {
  open: boolean;
  current: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.show("名稱不可空白", "danger"); return; }
    setSaving(true);
    try {
      await updateMyDisplayName(name.trim());
      toast.show("顯示名稱已更新", "ok");
      onClose();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "更新失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="變更顯示名稱" subtitle="這個名字會顯示在日報、成員、組織圖與任務指派上">
      <form onSubmit={handleSubmit} className="llm-form">
        <div className="field">
          <label>顯示名稱</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} maxLength={50} placeholder="例：王小明" required />
          <div className="llm-hint">只改自己的顯示名稱 · 不影響登入帳號</div>
        </div>
        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "儲存中…" : "儲存"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>取消</button>
        </div>
      </form>
    </Drawer>
  );
}
