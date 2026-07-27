import { useCallback, useEffect, useState } from "react";
import { ApiError, ncListRules, ncRemove, ncSetEnabled, notifyWebhookUrl, type NotifyRuleRow } from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import Wizard from "./Wizard";

const SOURCE_LABEL: Record<string, string> = { ragic_form: "Ragic 表單", internal_event: "系統事件" };
const CHANNEL_LABEL: Record<string, string> = { line_group: "LINE 群組", line_user: "LINE 私訊" };

// 通知設定（aiproot）· 規則列表 + 新增 wizard · 來源/管道無關
export default function NotifyConfigPage() {
  const toast = useToast();
  const [mode, setMode] = useState<"list" | "wizard">("list");
  const [rules, setRules] = useState<NotifyRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [delTarget, setDelTarget] = useState<NotifyRuleRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRules(await ncListRules()); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "載入失敗", "danger"); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  async function toggleEnabled(r: NotifyRuleRow) {
    try {
      await ncSetEnabled(r.ruleId, !r.enabled);
      toast.show(r.enabled ? "已停用" : "已啟用", "ok");
      void load();
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "操作失敗", "danger"); }
  }

  function copyWebhook(token: string) {
    const url = notifyWebhookUrl(token);
    void navigator.clipboard?.writeText(url);
    toast.show("已複製 · 貼到 Ragic 該表單「工具 → 同步 → Webhook」", "ok");
  }

  async function doDelete() {
    if (!delTarget) return;
    setBusy(true);
    try {
      await ncRemove(delTarget.ruleId);
      toast.show("已刪除規則", "ok");
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
          <div className="sub">一條規則＝什麼事發生（來源）→ 通知誰（管道）· 支援 Ragic 表單異動與系統內部事件</div>
        </div>
        <div><button className="btn btn-primary" onClick={() => setMode("wizard")}>＋ 新增通知規則</button></div>
      </div>

      {loading ? (
        <div className="dm-empty">載入中…</div>
      ) : rules.length === 0 ? (
        <div className="dm-empty">
          尚無通知規則
          <div className="dm-empty-hint">按右上「＋ 新增通知規則」建立第一筆</div>
        </div>
      ) : (
        <table className="nc-tbl">
          <thead><tr>
            <th style={{ width: "24%" }}>規則</th><th style={{ width: "14%" }}>來源</th><th style={{ width: "16%" }}>來源對象</th>
            <th style={{ width: "12%" }}>觸發</th><th style={{ width: "10%" }}>欄位</th>
            <th style={{ width: "16%" }}>通知對象</th><th style={{ width: "8%" }}>狀態</th><th style={{ width: "8%" }}>操作</th>
          </tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.ruleId}>
                <td>
                  <div className="nc-t-name">{r.name}</div>
                  {r.accountDisplayName && <div className="nc-t-sub">{r.accountDisplayName}</div>}
                </td>
                <td><span className="nc-pill ev">{SOURCE_LABEL[r.sourceType] ?? r.sourceType}</span></td>
                <td className="nc-t-mono" style={{ fontSize: 12 }}>{r.sourceLabel}</td>
                <td style={{ fontSize: 12 }}>{r.eventsLabel}</td>
                <td>{r.fieldCount} 個欄位</td>
                <td>
                  <div style={{ fontSize: 12.5 }}>{r.channelLabel}</div>
                  <div className="nc-t-sub">{CHANNEL_LABEL[r.channelType] ?? r.channelType}</div>
                </td>
                <td>{r.enabled ? <span className="nc-pill on">啟用</span> : <span className="nc-pill off">停用</span>}</td>
                <td>
                  <div className="nc-act">
                    {/* Ragic 規則必須把網址貼進 Ragic 才會通；建立當下的成功畫面關掉就找不回來，
                        逼人「刪掉重建」——所以列表要能隨時重新複製。*/}
                    {r.webhookToken && (
                      <button className="nc-lnk" onClick={() => copyWebhook(r.webhookToken as string)}>複製網址</button>
                    )}
                    <button className="nc-lnk mut" onClick={() => void toggleEnabled(r)}>{r.enabled ? "停用" : "啟用"}</button>
                    <button className="nc-lnk danger" onClick={() => setDelTarget(r)}>刪除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="login-hint" style={{ marginTop: 12 }}>
        共 {rules.length} 筆 · 僅具「通知設定」權限的 aiproot 員工可見與管理（權限於 AIPROOT 管理 → 權限管理 分配）。
      </div>

      <ConfirmDialog
        open={delTarget !== null}
        onClose={() => setDelTarget(null)}
        onConfirm={() => void doDelete()}
        title="刪除通知規則"
        body={`確定刪除「${delTarget?.name ?? ""}」？${delTarget?.webhookToken ? "此表單的 Webhook 將失效。" : ""}`}
        tone="danger"
        busy={busy}
      />
    </div>
  );
}
