import { useEffect, useState } from "react";
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
      .catch(() => toast.show("載入資料範圍選項失敗", "danger"));
  }, [toast]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!roleName.trim()) { toast.show("請填角色名稱", "danger"); return; }
    if (!baseline) { toast.show("請選這個角色看得到誰的資料", "danger"); return; }
    setSaving(true);
    try {
      const r = await createCustomRole({ roleName: roleName.trim(), baselineRole: baseline, permissionIds: [] });
      toast.show(`「${roleName.trim()}」已建立 · 接著勾選它可以做哪些事`, "ok");
      onCreated(r.roleKey);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "建立失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title="建立角色">
      <form onSubmit={submit} className="llm-form">
        <div className="field">
          <label>角色名稱 *</label>
          <input
            type="text" value={roleName} disabled={saving} autoFocus
            onChange={(e) => setRoleName(e.target.value)}
            placeholder="例：品保組長"
          />
          <div className="llm-hint">成員清單與這一頁都會顯示這個名字</div>
        </div>

        <div className="field">
          <label>這個角色看得到誰的資料 *</label>
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
            這一項<b>建立後不能改</b> —— 改了會讓已經指派的人資料範圍突然變動，而沒有人會收到通知。
            要換範圍請建一個新角色。
          </div>
        </div>

        <div className="field">
          <label>這個角色可以做哪些事</label>
          <div className="llm-hint">建立後就在權限清單勾選 · 只列得出你自己有的權限</div>
        </div>

        <div className="llm-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "建立中…" : "建立"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>取消</button>
        </div>
      </form>
    </Drawer>
  );
}
