import { useEffect, useState } from "react";
import { useT } from "../../i18n/useT";
import { ApiError, createCustomRole, listBaselines, type BaselineDto } from "../../api";
import { useToast } from "../../Toast";
import Drawer from "../../shared/Drawer";

// 建立角色 · docs/modules/custom-roles.md v0.3 M6
// 獨立成一個檔而不是塞進 Page.tsx：後者已 264 行，加進去會過 300 行紅線。
//
// ⚠️ **只問兩件事**：角色叫什麼、看得到誰的資料。
//    刻意沒有「角色代號」欄位 —— 那是程式用的識別字（`custom_xxxxxxxx`），
//    使用者從頭到尾看不到它，由後端自動產生。要一位總經理發明一個小寫英文代號，
//    是多一次沒有必要的判斷。
//
// 權限不在這裡勾：建立後就停在那個角色上，直接用頁面既有的權限清單勾 ——
// 少一個「一次要填完所有東西」的長表單。

export default function CreateRoleDrawer({ onClose, onCreated }: {
  onClose: () => void;
  /** 建好之後把畫面切到那個新角色，讓人接著勾權限 */
  onCreated: (roleKey: string) => void;
}) {
  const tr = useT();
  const toast = useToast();
  const [baselines, setBaselines] = useState<BaselineDto[]>([]);
  const [roleName, setRoleName] = useState("");
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // 三個範圍的文案由後端給 —— 前端自己編一套的話兩邊會漂移
    listBaselines()
      .then((r) => {
        setBaselines(r.baselines);
        setBaseline((cur) => cur || r.baselines[1]?.id || r.baselines[0]?.id || "");
      })
      .catch(() => toast.show(tr("cr.loadScopeFailed"), "danger"));
  }, [toast]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!roleName.trim()) { toast.show(tr("cr.needName"), "danger"); return; }
    if (!baseline) { toast.show(tr("cr.needScope"), "danger"); return; }
    setSaving(true);
    try {
      const r = await createCustomRole({ roleName: roleName.trim(), baselineRole: baseline, permissionIds: [] });
      toast.show(tr("cr.created", { name: roleName.trim() }), "ok");
      onCreated(r.roleKey);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : tr("cr.createFailed"), "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={tr("cr.title")}>
      <form onSubmit={submit} className="llm-form">
        <div className="field">
          <label>{tr("cr.name")} *</label>
          <input
            type="text" value={roleName} disabled={saving} autoFocus
            onChange={(e) => setRoleName(e.target.value)}
            placeholder={tr("cr.namePlaceholder")}
          />
          <div className="llm-hint">{tr("cr.nameHint")}</div>
        </div>

        <div className="field">
          <label>{tr("cr.scope")} *</label>
          {baselines.map((b) => (
            <label className={`cr-scope${baseline === b.id ? " on" : ""}`} key={b.id}>
              <input
                type="radio" name="baseline" value={b.id}
                checked={baseline === b.id} disabled={saving}
                onChange={() => setBaseline(b.id)}
              />
              <span>
                <span className="cr-scope-lb">{b.label}</span>
                <span className="cr-scope-hi">{b.hint}</span>
              </span>
            </label>
          ))}
          <div className="llm-hint">
            {tr("cr.scopeLockedNote")}
          </div>
        </div>

        <div className="field">
          <label>{tr("cr.perms")}</label>
          <div className="llm-hint">{tr("cr.permsHint")}</div>
        </div>

        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? tr("cr.creating") : tr("common.create")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>{tr("common.cancel")}</button>
        </div>
      </form>
    </Drawer>
  );
}
