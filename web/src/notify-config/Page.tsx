import { useCallback, useEffect, useState } from "react";
import { ApiError, ncListConfigs, ncRemove, ncSetEnabled, type NotifyConfigRow } from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import Wizard from "./Wizard";

// notify v2 · 通知設定（aiproot）· 列表 + 新增 wizard
export default function NotifyConfigPage() {
  const toast = useToast();
  const [mode, setMode] = useState<"list" | "wizard">("list");
  const [configs, setConfigs] = useState<NotifyConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [delTarget, setDelTarget] = useState<NotifyConfigRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setConfigs(await ncListConfigs()); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "載入失敗", "danger"); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  async function toggleEnabled(c: NotifyConfigRow) {
    try {
      await ncSetEnabled(c.configId, !c.enabled);
      toast.show(c.enabled ? "已停用" : "已啟用", "ok");
      void load();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "操作失敗", "danger"); }
  }

  async function doDelete() {
    if (!delTarget) return;
    setBusy(true);
    try {
      await ncRemove(delTarget.configId);
      toast.show("已刪除設定", "ok");
      setDelTarget(null);
      void load();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "刪除失敗", "danger"); }
    finally { setBusy(false); }
  }

  if (mode === "wizard") {
    return <Wizard onDone={() => { setMode("list"); void load(); }} onCancel={() => setMode("list")} />;
  }

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>通知設定</h1>
          <div className="sub">Ragic 表單異動 → LINE 通知 · 每筆設定對應一張表單</div>
        </div>
        <div><button className="btn btn-primary" onClick={() => setMode("wizard")}>＋ 新增通知設定</button></div>
      </div>

      {loading ? (
        <div className="dm-empty">載入中…</div>
      ) : configs.length === 0 ? (
        <div className="dm-empty">
          尚無通知設定
          <div className="dm-empty-hint">按右上「＋ 新增通知設定」建立第一筆</div>
        </div>
      ) : (
        <table className="nc-tbl">
          <thead><tr>
            <th style={{ width: "26%" }}>表單</th><th style={{ width: "16%" }}>Ragic 帳號</th><th style={{ width: "12%" }}>通知欄位</th>
            <th style={{ width: "16%" }}>觸發事件</th><th style={{ width: "14%" }}>LINE 群</th><th style={{ width: "8%" }}>狀態</th><th style={{ width: "8%" }}>操作</th>
          </tr></thead>
          <tbody>
            {configs.map((c) => (
              <tr key={c.configId}>
                <td><div className="nc-t-name">{c.sheetName}</div><div className="nc-t-sub nc-t-mono">{c.sheetPath}</div></td>
                <td>{c.accountDisplayName}</td>
                <td>{c.fields.length} 個欄位</td>
                <td>
                  {c.notifyCreate && <span className="nc-pill ev">新增</span>}
                  {c.notifyUpdate && <span className="nc-pill ev">更新</span>}
                  {c.notifyDelete && <span className="nc-pill ev">刪除</span>}
                </td>
                <td className="nc-t-mono" style={{ fontSize: 12 }}>{c.lineGroupId.slice(0, 10)}…</td>
                <td>
                  {c.enabled
                    ? <span className="nc-pill on">啟用</span>
                    : <span className="nc-pill off">停用</span>}
                </td>
                <td>
                  <div className="nc-act">
                    <button className="nc-lnk mut" onClick={() => void toggleEnabled(c)}>{c.enabled ? "停用" : "啟用"}</button>
                    <button className="nc-lnk danger" onClick={() => setDelTarget(c)}>刪除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="login-hint" style={{ marginTop: 12 }}>
        共 {configs.length} 筆 · 僅具「通知設定」權限的 aiproot 員工可見與管理（權限於 AIPROOT 管理 → 權限管理 分配）。
      </div>

      <ConfirmDialog
        open={delTarget !== null}
        onClose={() => setDelTarget(null)}
        onConfirm={() => void doDelete()}
        title="刪除通知設定"
        body={`確定刪除「${delTarget?.sheetName ?? ""}」的通知設定？此表單的 Webhook 將失效。`}
        tone="danger"
        busy={busy}
      />
    </div>
  );
}
