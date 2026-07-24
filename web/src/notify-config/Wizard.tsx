import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError, ncCreateAccount, ncCreateConfig, ncFetchFields, ncLineGroups, ncListAccounts,
  notifyWebhookUrl, type LineGroupOption, type RagicAccountRow, type RagicSchemaField,
} from "../api";
import { useToast } from "../Toast";
import StyledSelect from "../shared/StyledSelect";

const SERVERS = ["www", "ap5", "ap15", "ap16", "na3", "eu2"].map((s) => ({ id: s, label: s }));

export default function Wizard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [accounts, setAccounts] = useState<RagicAccountRow[]>([]);
  const [accountId, setAccountId] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);

  // 新增帳號表單
  const [naServer, setNaServer] = useState("ap16");
  const [naApname, setNaApname] = useState("");
  const [naName, setNaName] = useState("");
  const [naKey, setNaKey] = useState("");

  const [sheetPath, setSheetPath] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [fields, setFields] = useState<RagicSchemaField[]>([]);
  const [fetching, setFetching] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [title, setTitle] = useState("");

  const [evCreate, setEvCreate] = useState(true);
  const [evUpdate, setEvUpdate] = useState(true);
  const [evDelete, setEvDelete] = useState(false);

  const [lineGroups, setLineGroups] = useState<LineGroupOption[]>([]);
  const [lineGroupId, setLineGroupId] = useState("");

  const [saving, setSaving] = useState(false);
  const [savedToken, setSavedToken] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try { setAccounts(await ncListAccounts()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  // 選帳號 → 載 LINE 群
  useEffect(() => {
    if (!accountId) { setLineGroups([]); return; }
    ncLineGroups(accountId).then(setLineGroups).catch(() => setLineGroups([]));
  }, [accountId]);

  const accountItems = useMemo(
    () => accounts.map((a) => ({ id: a.accountId, label: `${a.displayName}（${a.server} · ${a.apname}）` })),
    [accounts],
  );

  async function saveAccount() {
    if (!naApname.trim() || !naName.trim()) { toast.show("帳號名與顯示名必填", "danger"); return; }
    try {
      const { accountId: id } = await ncCreateAccount({ server: naServer, apname: naApname.trim(), displayName: naName.trim(), apiKey: naKey.trim() || undefined });
      toast.show("已新增 Ragic 帳號", "ok");
      await loadAccounts();
      setAccountId(id);
      setAddingAccount(false);
      setNaApname(""); setNaName(""); setNaKey("");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "新增失敗", "danger");
    }
  }

  async function fetchFields() {
    if (!accountId) { toast.show("請先選 Ragic 帳號", "danger"); return; }
    if (!sheetPath.trim()) { toast.show("請輸入表單路徑", "danger"); return; }
    setFetching(true);
    try {
      const res = await ncFetchFields(accountId, sheetPath.trim());
      setFields(res.fields);
      setSheetName(res.sheetName || sheetPath.trim());
      setSelected([]);
      toast.show(`已讀取「${res.sheetName || sheetPath.trim()}」· ${res.fields.length} 個欄位`, "ok");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "抓取欄位失敗", "danger");
    } finally {
      setFetching(false);
    }
  }

  function toggleField(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function save() {
    if (!accountId || !sheetName || selected.length === 0 || !lineGroupId) {
      toast.show("請完成：帳號、表單欄位、LINE 群", "danger"); return;
    }
    setSaving(true);
    try {
      const payloadFields = selected.map((id, i) => {
        const f = fields.find((x) => x.fieldId === id);
        return { fieldId: id, label: f?.fieldName ?? String(id), order: i };
      });
      const { webhookToken } = await ncCreateConfig({
        ragicAccountId: accountId, sheetPath: sheetPath.trim(), sheetName, title: title.trim() || null,
        fields: payloadFields, notifyCreate: evCreate, notifyUpdate: evUpdate, notifyDelete: evDelete, lineGroupId,
      });
      setSavedToken(webhookToken);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "儲存失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  // ===== 完成畫面：webhook URL =====
  if (savedToken) {
    const url = notifyWebhookUrl(savedToken);
    return (
      <div className="pane">
        <div className="pane-hdr"><div>
          <h1>設定已建立</h1>
          <div className="sub">最後一步：把下面網址貼進 Ragic 該表單的 Webhook 設定</div>
        </div></div>
        <div className="nc-card">
          <div className="nc-card-h"><span className="nc-step-n">✓</span>接上 Ragic Webhook</div>
          <div className="nc-card-sub">該表單 → 工具 → Webhook → 貼上此網址 → 儲存（一次即可）</div>
          <div className="nc-url-box">
            <code>{url}</code>
            <button className="nc-url-copy" onClick={() => { void navigator.clipboard?.writeText(url); toast.show("已複製", "ok"); }}>複製</button>
          </div>
          <div className="nc-callout">貼上後，之後每次符合條件的異動就會自動通知，<b>不用再貼任何程式碼</b>。</div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-primary" onClick={onDone}>完成</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="pane-hdr"><div>
        <h1>新增通知設定</h1>
        <div className="sub">設定「Ragic 表單異動 → LINE 通知」· 免找欄位編號、免寫程式</div>
      </div>
      <div><button className="btn" onClick={onCancel}>取消</button></div>
      </div>

      {/* Step 1 · Ragic 帳號 */}
      <div className="nc-card">
        <div className="nc-card-h"><span className="nc-step-n">1</span>選擇 Ragic 帳號</div>
        <div className="nc-card-sub">要監看哪家公司的 Ragic 表單</div>
        <div className="nc-row">
          <div className="field" style={{ margin: 0, flex: 1 }}>
            <label>Ragic 帳號</label>
            <StyledSelect ariaLabel="Ragic 帳號" items={accountItems} value={accountId} onChange={setAccountId} placeholder="選擇帳號" />
          </div>
          <button className="btn" onClick={() => setAddingAccount((v) => !v)}>{addingAccount ? "收合" : "＋ 新增帳號"}</button>
        </div>
        {addingAccount && (
          <div style={{ marginTop: 14, padding: 14, background: "var(--well)", borderRadius: 6 }}>
            <div className="nc-row" style={{ marginBottom: 12 }}>
              <div className="field" style={{ margin: 0, flex: "0 0 120px" }}><label>伺服器</label>
                <StyledSelect ariaLabel="伺服器" items={SERVERS} value={naServer} onChange={setNaServer} /></div>
              <div className="field" style={{ margin: 0, flex: 1 }}><label>帳號名（apname）</label>
                <input className="tf" value={naApname} onChange={(e) => setNaApname(e.target.value)} placeholder="例：aitode" /></div>
              <div className="field" style={{ margin: 0, flex: 1 }}><label>顯示名</label>
                <input className="tf" value={naName} onChange={(e) => setNaName(e.target.value)} placeholder="例：台灣福祉" /></div>
            </div>
            <div className="field" style={{ margin: 0 }}><label>API 金鑰（加密儲存 · 需帳號管理者權限）</label>
              <input className="tf" type="password" value={naKey} onChange={(e) => setNaKey(e.target.value)} placeholder="貼上 Ragic API key" autoComplete="off" /></div>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => void saveAccount()}>儲存帳號</button>
          </div>
        )}
        <div className="login-hint" style={{ marginTop: 8 }}>金鑰加密儲存、不回明碼；用來自動讀取表單欄位。僅具「通知設定」權限的 aiproot 員工可設。</div>
      </div>

      {/* Step 2 · 表單 */}
      <div className="nc-card">
        <div className="nc-card-h"><span className="nc-step-n">2</span>選擇表單</div>
        <div className="nc-card-sub">輸入 Ragic 表單路徑，系統自動抓出欄位</div>
        <div className="nc-row">
          <div className="field" style={{ margin: 0, flex: 1 }}><label>表單路徑</label>
            <input className="tf" value={sheetPath} onChange={(e) => setSheetPath(e.target.value)} placeholder="例：/service-tickets/10" /></div>
          <button className="btn btn-primary" onClick={() => void fetchFields()} disabled={fetching}>{fetching ? "抓取中…" : "抓取欄位"}</button>
        </div>
        {fields.length > 0 && <div className="nc-ok">✓ 已讀取「{sheetName}」· {fields.length} 個欄位</div>}
      </div>

      {/* Step 3 · 欄位 */}
      {fields.length > 0 && (
        <div className="nc-card">
          <div className="nc-card-h"><span className="nc-step-n">3</span>選擇要通知的欄位</div>
          <div className="nc-card-sub">勾選 · 依勾選順序逐行列在訊息裡（已選 {selected.length} 個）</div>
          <div className="nc-flds">
            {fields.map((f) => {
              const on = selected.includes(f.fieldId);
              return (
                <button key={f.fieldId} className={`nc-fld${on ? " on" : ""}`} onClick={() => toggleField(f.fieldId)}>
                  <span className="nc-cb">{on && <svg viewBox="0 0 24 24"><path d="M4 12l6 6L20 6" /></svg>}</span>
                  <span className="nc-fld-name">{f.fieldName}</span>
                  <span className="nc-fld-id">#{f.fieldId}</span>
                  <span className="nc-fld-ord">{on ? selected.indexOf(f.fieldId) + 1 : "–"}</span>
                </button>
              );
            })}
          </div>
          <div className="field" style={{ margin: "16px 0 0" }}><label>自訂訊息標題（選填 · 留空用表單名）</label>
            <input className="tf" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={sheetName || "例：維修保養通知"} /></div>
        </div>
      )}

      {/* Step 4 · 事件 + LINE 群 */}
      {fields.length > 0 && (
        <div className="nc-card">
          <div className="nc-card-h"><span className="nc-step-n">4</span>觸發時機與通知對象</div>
          <div className="nc-card-sub">哪些異動要通知、發到哪個 LINE 群</div>
          <div className="field" style={{ marginBottom: 14 }}><label>觸發事件</label>
            <div className="nc-evs">
              <button className={`nc-ev${evCreate ? " on" : ""}`} onClick={() => setEvCreate((v) => !v)}><span className="nc-sw" />新增資料</button>
              <button className={`nc-ev${evUpdate ? " on" : ""}`} onClick={() => setEvUpdate((v) => !v)}><span className="nc-sw" />更新資料</button>
              <button className={`nc-ev${evDelete ? " on" : ""}`} onClick={() => setEvDelete((v) => !v)}><span className="nc-sw" />刪除資料</button>
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}><label>LINE 目標群</label>
            {lineGroups.length > 0 ? (
              <StyledSelect ariaLabel="LINE 目標群" value={lineGroupId} onChange={setLineGroupId}
                items={lineGroups.map((g) => ({ id: g.groupId, label: g.displayName || g.groupId }))} placeholder="選擇 LINE 群" />
            ) : (
              <input className="tf" value={lineGroupId} onChange={(e) => setLineGroupId(e.target.value)} placeholder="此租戶尚無登錄群組 · 可直接貼 LINE group id" />
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving || fields.length === 0}>{saving ? "儲存中…" : "儲存設定"}</button>
      </div>
    </div>
  );
}
