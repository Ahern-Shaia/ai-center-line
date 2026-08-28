import Spinner from "../shared/Spinner";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError, getMasterDataSource, getSession, listAiprootTenants, ncFetchFields, ncUpdateKey,
  saveMasterDataSource, syncMasterData,
  type AiprootTenantOption, type MasterDataState,
} from "../api";
import StyledSelect from "../shared/StyledSelect";
import { useToast } from "../Toast";
import { useT } from "../i18n/useT";

// 資料來源 · 客戶名冊 · docs/modules/master-data-sync.md
//
// 為什麼不塞進「通知設定」：兩者回答不同問題 ——
// 通知＝「哪張表變更要通知誰」、主檔＝「哪張表是你的客戶名冊」。
// 混在一頁，設定的人得先判斷自己在設哪一種。多一次點擊可以，多一次判斷不行。
//
// 但 Ragic 帳號共用、不問第二次 —— 產生 API key 需要 Ragic 帳號管理者權限，
// 那是整個流程裡最難的一步。

function fmtTime(iso: string | null, never: string): string {
  if (!iso) return never;
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return never;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function MasterData() {
  const toast = useToast();
  const tr = useT();
  const [state, setState] = useState<MasterDataState | null>(null);
  // 平台級帳號（我方）JWT 沒有 tenant_id，要先選在設哪一家
  const isPlatform = !getSession()?.tenantId;
  const [tenants, setTenants] = useState<AiprootTenantOption[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [loading, setLoading] = useState(true);
  // ⚠️ 403 要跟「查到 0 筆」分開存。合在一起的話畫面會渲染出「0 筆客戶 /
  //    尚未連線 Ragic」—— 那兩個數字是假的，我們是被拒絕、不是查到 0。
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  const [accountId, setAccountId] = useState("");
  const [sheetPath, setSheetPath] = useState("");
  const [fields, setFields] = useState<Array<{ fieldId: number; fieldName: string }>>([]);
  const [nameField, setNameField] = useState("");
  const [codeField, setCodeField] = useState("");
  // 金鑰補填 —— 後端端點一直都有，只是沒有任何前端入口，
  // 所以帳號建立後就補不了金鑰（prod 的帳號正是 hasKey=false）
  const [editingKey, setEditingKey] = useState(false);
  const [newKey, setNewKey] = useState("");

  useEffect(() => {
    if (!isPlatform) return;
    void listAiprootTenants().then((r) => setTenants(r.tenants)).catch(() => setTenants([]));
  }, [isPlatform]);

  const load = useCallback(async () => {
    if (isPlatform && !tenantId) { setState(null); setLoading(false); return; }
    setLoading(true); setDenied(false);
    try {
      const s = await getMasterDataSource(tenantId || undefined);
      setState(s);
      if (s.source) {
        setAccountId(s.source.accountId ?? "");
        setSheetPath(s.source.sheetPath ?? "");
        setNameField(s.source.nameField ?? "");
        setCodeField(s.source.codeField ?? "");
      } else if (s.ragicAccounts.length === 1) {
        setAccountId(s.ragicAccounts[0].accountId);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) { setDenied(true); return; }
      toast.show(e instanceof ApiError ? e.message : tr("common.loadFailed"), "danger");
    } finally { setLoading(false); }
  }, [toast, isPlatform, tenantId]);
  useEffect(() => { void load(); }, [load]);

  async function saveKey() {
    if (!accountId) { toast.show(tr("md.pickAccountFirst"), "danger"); return; }
    if (!newKey.trim()) { toast.show(tr("md.pasteKeyFirst"), "danger"); return; }
    setBusy(true);
    try {
      await ncUpdateKey(accountId, newKey.trim());
      setNewKey(""); setEditingKey(false);
      toast.show(tr("md.keySaved"), "ok");
      await load();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : tr("common.saveFailed"), "danger");
    } finally { setBusy(false); }
  }

  async function readFields() {
    if (!accountId) { toast.show(tr("md.pickAccountFirst"), "danger"); return; }
    if (!sheetPath.trim()) { toast.show(tr("md.fillSheetPath"), "danger"); return; }
    setBusy(true);
    try {
      const r = await ncFetchFields(accountId, sheetPath.trim());
      setFields(r.fields);
      toast.show(tr("md.fieldsRead", { name: r.sheetName || sheetPath, n: r.fields.length }), "ok");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : tr("md.readFailed"), "danger");
    } finally { setBusy(false); }
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.show(ok, "ok"); await load(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : tr("common.actionFailed"), "danger"); }
    finally { setBusy(false); }
  }

  // 隱私承諾 —— 兩條路徑（未選客戶／已選客戶）都要看得到。
  // 只放在其中一條，就會變成「要先做某個動作才看得到最該先講的話」。
  const privacyNote = (
    <div className="login-hint" style={{ marginBottom: 16 }}>
      {tr("md.privacyPre")}<b>{tr("md.privacyBold")}</b>{tr("md.privacyPost")}
    </div>
  );

  const tenantPicker = isPlatform && (
    <div className="nc-card">
      <div className="nc-card-h"><span className="nc-step-n">0</span>{tr("md.step0")}</div>
      <div className="nc-card-b">
        <StyledSelect
          items={tenants.map((t) => ({ id: t.tenantId, label: t.tenantName }))}
          value={tenantId} onChange={setTenantId} ariaLabel={tr("md.customer")} className="llm-select"
          allowEmpty emptyLabel={tr("md.pickPlease")}
        />
      </div>
    </div>
  );

  if (isPlatform && !tenantId) {
    return (
      <div className="pane">
        <div className="pane-hdr"><div><h1>{tr("nav.masterData")}</h1>
          <div className="sub">{tr("md.sub")}</div></div></div>
        {privacyNote}
        {tenantPicker}
      </div>
    );
  }
  if (loading && !state) return <div className="pane"><Spinner block /></div>;

  // ⚠️ 被拒絕**不可以**掉到下面的正常渲染。
  // 那樣會畫出「0 筆客戶 / 尚未連線 Ragic」，而那兩件事我們根本不知道 ——
  // 使用者會以為系統是空的，然後去查「為什麼沒同步」，但真正的原因是他沒有權限。
  // （0051 之後側邊欄已經不會給沒權限的人看到這頁，這裡擋的是直接輸入網址那條路。）
  if (denied) {
    return (
      <div className="pane">
        <div className="pane-hdr"><div><h1>{tr("nav.masterData")}</h1></div></div>
        <div className="dm-empty">
          {tr("md.denied")}
          <div className="dm-empty-hint">{tr("md.deniedHint")}</div>
        </div>
      </div>
    );
  }

  const src = state?.source ?? null;
  const acc = state?.ragicAccounts ?? [];

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>{tr("nav.masterData")}</h1>
          <div className="sub">{tr("md.subLong")}</div>
        </div>
        {src && (
          <div className="hdr-toolbar">
            <button className="btn btn-primary" disabled={busy}
              onClick={() => void run(() => syncMasterData(tenantId || undefined), tr("md.syncDone"))}>{tr("md.syncNow")}</button>
          </div>
        )}
      </div>

      {tenantPicker}

      {/* 目前狀態 —— 同步壞了要看得出來，否則主檔停更沒有人會發現 */}
      <div className="md-status">
        <div className="md-stat"><b>{state?.customerCount ?? 0}</b><span>{tr("md.customerUnit")}</span></div>
        <div className="md-stat-txt">
          <div>{tr("md.lastSync", { time: fmtTime(src?.lastSyncAt ?? null, tr("md.neverSynced")) })}</div>
          {src?.lastSyncError
            ? <div className="md-err">{tr("md.lastSyncFailed", { err: src.lastSyncError })}</div>
            : src?.lastSyncCount != null && <div className="muted-hint">{tr("md.lastCount", { n: src.lastSyncCount })}</div>}
        </div>
      </div>

      {privacyNote}

      <div className="nc-card">
        <div className="nc-card-h"><span className="nc-step-n">1</span>{tr("md.step1")}</div>
        <div className="nc-card-b">
          {acc.length === 0 ? (
            <div className="dm-empty">
              {tr("md.noRagic")}
              <div className="dm-empty-hint">{tr("md.noRagicHint")}</div>
            </div>
          ) : (
            <>
              <div className="field">
                <label>{tr("md.ragicAccount")}</label>
                <StyledSelect
                  items={acc.map((a) => ({ id: a.accountId, label: `${a.displayName}（${a.apname}）` }))}
                  value={accountId} onChange={setAccountId} ariaLabel={tr("md.ragicAccount")} className="llm-select"
                />
                <div className="dm-empty-hint">{tr("md.ragicAccountHint")}</div>
              </div>

              {/* 金鑰狀態要先講。原本沒有任何地方顯示，使用者得試到「讀取欄位」
                  失敗才知道金鑰沒設 —— 先講比後救好。 */}
              {(() => {
                const cur = acc.find((a) => a.accountId === accountId);
                if (!cur) return null;
                return (
                  <div className="md-key">
                    <span className={cur.hasKey ? "md-key-ok" : "md-key-warn"}>
                      {cur.hasKey ? tr("md.keyOk") : tr("md.keyMissing")}
                    </span>
                    <button className="btn" disabled={busy}
                      onClick={() => { setEditingKey(!editingKey); setNewKey(""); }}>
                      {editingKey ? tr("common.cancel") : cur.hasKey ? tr("md.changeKey") : tr("md.setKey")}
                    </button>
                  </div>
                );
              })()}

              {editingKey && (
                <div className="md-key-form">
                  <div className="field" style={{ margin: 0 }}>
                    <label>{tr("md.apiKey")}</label>
                    <input className="tf" type="password" value={newKey} autoComplete="off"
                      onChange={(e) => setNewKey(e.target.value)} placeholder={tr("md.apiKeyPh")} />
                    <div className="dm-empty-hint">{tr("md.apiKeyHint")}</div>
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: 10 }}
                    disabled={busy || !newKey.trim()} onClick={() => void saveKey()}>{tr("md.saveKey")}</button>
                </div>
              )}
              <div className="field">
                <label>{tr("md.sheetPath")}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="tf" style={{ flex: 1 }} value={sheetPath}
                    onChange={(e) => setSheetPath(e.target.value)} placeholder={tr("md.sheetPathPh")} />
                  <button className="btn" onClick={() => void readFields()} disabled={busy}>{tr("md.readFields")}</button>
                </div>
                <div className="dm-empty-hint">{tr("md.sheetPathHint")}</div>
              </div>
            </>
          )}
        </div>
      </div>

      {fields.length > 0 && (
        <div className="nc-card">
          <div className="nc-card-h"><span className="nc-step-n">2</span>{tr("md.step2")}</div>
          <div className="nc-card-b">
            <div className="field">
              <label>{tr("md.custName")}</label>
              <StyledSelect
                items={fields.map((f) => ({ id: String(f.fieldId), label: f.fieldName }))}
                value={nameField} onChange={setNameField} ariaLabel={tr("md.custNameField")} className="llm-select"
              />
            </div>
            <div className="field">
              <label>{tr("md.custCode")}</label>
              <StyledSelect
                items={fields.map((f) => ({ id: String(f.fieldId), label: f.fieldName }))}
                value={codeField} onChange={setCodeField} ariaLabel={tr("md.custCodeField")}
                className="llm-select" allowEmpty emptyLabel={tr("md.notUsed")}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary" disabled={busy || !nameField}
                onClick={() => void run(() => saveMasterDataSource({
                  tenantId: tenantId || undefined,
                  provider: "ragic", accountId, sheetPath: sheetPath.trim(),
                  nameField, codeField: codeField || null,
                }), tr("md.saved"))}>{tr("md.save")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="login-hint" style={{ marginTop: 16 }}>
        {tr("md.readonlyPre")}<b>{tr("md.readonlyBold")}</b>{tr("md.readonlyPost")}
      </div>
    </div>
  );
}
