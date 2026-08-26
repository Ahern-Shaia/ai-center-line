import { useState } from "react";
import Drawer from "../shared/Drawer";
import { updateMyDisplayName, ApiError } from "../api";
import { useToast } from "../Toast";
import { useT } from "../i18n/useT";

// 使用者自服務改顯示名稱 · Topbar user menu 觸發 · LINE 登入用戶把佔位名改成真名
export default function ChangeDisplayNameDialog({ open, current, onClose }: {
  open: boolean;
  current: string;
  onClose: () => void;
}) {
  const tr = useT();
  const toast = useToast();
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.show(tr("cdn.blank"), "danger"); return; }
    setSaving(true);
    try {
      await updateMyDisplayName(name.trim());
      toast.show(tr("cdn.updated"), "ok");
      onClose();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("common.updateFailed"), "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={tr("cdn.title")} subtitle={tr("cdn.sub")}>
      <form onSubmit={handleSubmit} className="llm-form">
        <div className="field">
          <label>{tr("cdn.label")}</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} maxLength={50} placeholder={tr("cdn.ph")} required />
          <div className="llm-hint">{tr("cdn.hint")}</div>
        </div>
        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? tr("common.saving") : tr("cdn.save")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>{tr("common.cancel")}</button>
        </div>
      </form>
    </Drawer>
  );
}
