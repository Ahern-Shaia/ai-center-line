import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError, ncCreateAccount, ncCreateRule, ncEventCatalog, ncFetchFields, ncLineGroups,
  ncListAccounts, ncNotifiableUsers, notifyWebhookUrl,
  type EventDef, type LineGroupOption, type NotifiableUser, type NotifyChannelType,
  type NotifySourceType, type RagicAccountRow,
} from "../api";
import { useToast } from "../Toast";
import StyledSelect from "../shared/StyledSelect";

const SERVERS = ["www", "ap5", "ap15", "ap16", "na3", "eu2"].map((s) => ({ id: s, label: s }));

// 可勾選欄位的統一形狀（Ragic 欄位 / 事件欄位都轉成這個）
interface SelectableField { path: string; label: string; numeric?: boolean }

export default function Wizard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const toast = useToast();

  // 來源型別
  const [sourceType, setSourceType] = useState<NotifySourceType>("ragic_form");

  // --- Ragic 來源 ---
  const [accounts, setAccounts] = useState<RagicAccountRow[]>([]);
  const [accountId, setAccountId] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [naServer, setNaServer] = useState("ap16");
  const [naApname, setNaApname] = useState("");
  const [naName, setNaName] = useState("");
  const [naKey, setNaKey] = useState("");
  const [sheetPath, setSheetPath] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [fetching, setFetching] = useState(false);
  const [evCreate, setEvCreate] = useState(true);
  const [evUpdate, setEvUpdate] = useState(true);
  const [evDelete, setEvDelete] = useState(false);

  // --- 內部事件來源 ---
  const [catalog, setCatalog] = useState<EventDef[]>([]);
  const [eventType, setEventType] = useState("");
  const [threshold, setThreshold] = useState<{ path: string; value: string }>({ path: "", value: "" });

  // --- 共用 ---
  const [fields, setFields] = useState<SelectableField[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [channelType, setChannelType] = useState<NotifyChannelType>("line_group");
  const [lineGroups, setLineGroups] = useState<LineGroupOption[]>([]);
  const [users, setUsers] = useState<NotifiableUser[]>([]);
  const [channelTarget, setChannelTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [savedNoWebhook, setSavedNoWebhook] = useState(false);

  const loadAccounts = useCallback(async () => {
    try { setAccounts(await ncListAccounts()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => { ncEventCatalog().then(setCatalog).catch(() => setCatalog([])); }, []);
  useEffect(() => { ncNotifiableUsers().then(setUsers).catch(() => setUsers([])); }, []);
  useEffect(() => {
    if (!accountId) { setLineGroups([]); return; }
    ncLineGroups(accountId).then(setLineGroups).catch(() => setLineGroups([]));
  }, [accountId]);

  // 切來源 → 清空欄位選擇
  useEffect(() => { setFields([]); setSelected([]); }, [sourceType]);

  const accountItems = useMemo(
    () => accounts.map((a) => ({ id: a.accountId, label: `${a.displayName}（${a.server} · ${a.apname}）` })),
    [accounts],
  );
  const selectedEvent = useMemo(() => catalog.find((e) => e.eventType === eventType), [catalog, eventType]);
  const numericFields = useMemo(() => (selectedEvent?.fields ?? []).filter((f) => f.numeric), [selectedEvent]);

  async function saveAccount() {
    if (!naApname.trim() || !naName.trim()) { toast.show("帳號名與顯示名必填", "danger"); return; }
    try {
      const { accountId: id } = await ncCreateAccount({
        server: naServer, apname: naApname.trim(), displayName: naName.trim(), apiKey: naKey.trim() || undefined,
      });
      toast.show("已新增 Ragic 帳號", "ok");
      await loadAccounts();
      setAccountId(id); setAddingAccount(false);
      setNaApname(""); setNaName(""); setNaKey("");
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "新增失敗", "danger"); }
  }

  async function fetchRagicFields() {
    if (!accountId) { toast.show("請先選 Ragic 帳號", "danger"); return; }
    if (!sheetPath.trim()) { toast.show("請輸入表單路徑", "danger"); return; }
    setFetching(true);
    try {
      const res = await ncFetchFields(accountId, sheetPath.trim());
      setFields(res.fields.map((f) => ({ path: String(f.fieldId), label: f.fieldName })));
      setSheetName(res.sheetName || sheetPath.trim());
      setSelected([]);
      toast.show(`已讀取「${res.sheetName || sheetPath.trim()}」· ${res.fields.length} 個欄位`, "ok");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "抓取欄位失敗", "danger");
    } finally { setFetching(false); }
  }

  function pickEvent(t: string) {
    setEventType(t);
    const ev = catalog.find((e) => e.eventType === t);
    setFields((ev?.fields ?? []).map((f) => ({ path: f.path, label: f.label, numeric: f.numeric })));
    setSelected(ev ? ev.fields.map((f) => f.path) : []);   // 內部事件欄位少 · 預設全選
    setThreshold({ path: "", value: "" });
  }

  function toggleField(path: string) {
    setSelected((s) => (s.includes(path) ? s.filter((x) => x !== path) : [...s, path]));
  }

  async function save() {
    if (selected.length === 0) { toast.show("請至少勾選一個欄位", "danger"); return; }
    if (!channelTarget) { toast.show("請選擇通知對象", "danger"); return; }
    setSaving(true);
    try {
      const payloadFields = selected.map((p, i) => ({
        path: p, label: fields.find((f) => f.path === p)?.label ?? p, order: i,
      }));
      const filters = threshold.path && threshold.value !== ""
        ? [{ path: threshold.path, op: "gte" as const, value: Number(threshold.value) }]
        : [];
      const res = await ncCreateRule({
        name: sourceType === "ragic_form" ? sheetName : (selectedEvent?.label ?? ""),
        sourceType,
        ragicAccountId: sourceType === "ragic_form" ? accountId : undefined,
        sheetPath: sourceType === "ragic_form" ? sheetPath.trim() : undefined,
        sheetName: sourceType === "ragic_form" ? sheetName : undefined,
        notifyCreate: evCreate, notifyUpdate: evUpdate, notifyDelete: evDelete,
        eventType: sourceType === "internal_event" ? eventType : undefined,
        filters: sourceType === "internal_event" ? filters : undefined,
        title: title.trim() || null,
        fields: payloadFields,
        channelType, channelTarget,
      });
      if (res.webhookToken) setSavedToken(res.webhookToken);
      else setSavedNoWebhook(true);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "儲存失敗", "danger");
    } finally { setSaving(false); }
  }

  // ===== 完成畫面 =====
  if (savedToken || savedNoWebhook) {
    const url = savedToken ? notifyWebhookUrl(savedToken) : "";
    return (
      <div className="pane">
        <div className="pane-hdr"><div>
          <h1>規則已建立</h1>
          <div className="sub">{savedToken ? "最後一步：把下面網址貼進 Ragic 該表單的 Webhook 設定" : "內部事件規則已生效 · 無需額外設定"}</div>
        </div></div>
        <div className="nc-card">
          {savedToken ? (
            <>
              <div className="nc-card-h"><span className="nc-step-n">✓</span>接上 Ragic Webhook</div>
              <div className="nc-card-sub">該表單 → 工具 → Webhook → 貼上此網址 → 儲存（一次即可）</div>
              <div className="nc-url-box">
                <code>{url}</code>
                <button className="nc-url-copy" onClick={() => { void navigator.clipboard?.writeText(url); toast.show("已複製", "ok"); }}>複製</button>
              </div>
              <div className="nc-callout">貼上後，之後每次符合條件的異動就會自動通知，<b>不用再貼任何程式碼</b>。</div>
            </>
          ) : (
            <>
              <div className="nc-card-h"><span className="nc-step-n">✓</span>已啟用</div>
              <div className="nc-card-sub">系統偵測到該事件時會自動依此規則通知，無需在其他系統設定。</div>
            </>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-primary" onClick={onDone}>完成</button>
        </div>
      </div>
    );
  }

  const ragicReady = sourceType === "ragic_form" && fields.length > 0;
  const eventReady = sourceType === "internal_event" && !!eventType;
  const showRest = ragicReady || eventReady;

  return (
    <div className="pane">
      <div className="pane-hdr"><div>
        <h1>新增通知規則</h1>
        <div className="sub">選觸發來源 → 勾要通知的欄位 → 選通知對象 · 免寫程式</div>
      </div>
      <div><button className="btn" onClick={onCancel}>取消</button></div>
      </div>

      {/* Step 1 · 來源型別 */}
      <div className="nc-card">
        <div className="nc-card-h"><span className="nc-step-n">1</span>選擇觸發來源</div>
        <div className="nc-card-sub">什麼事情發生時要通知</div>
        <div className="nc-evs">
          <button className={`nc-ev${sourceType === "ragic_form" ? " on" : ""}`} onClick={() => setSourceType("ragic_form")}>
            <span className="nc-sw" />Ragic 表單異動
          </button>
          <button className={`nc-ev${sourceType === "internal_event" ? " on" : ""}`} onClick={() => setSourceType("internal_event")}>
            <span className="nc-sw" />系統內部事件
          </button>
        </div>
      </div>

      {/* Step 2 · 來源細節 */}
      {sourceType === "ragic_form" ? (
        <>
          <div className="nc-card">
            <div className="nc-card-h"><span className="nc-step-n">2</span>選擇 Ragic 帳號與表單</div>
            <div className="nc-card-sub">系統會自動讀出該表單的欄位</div>
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
            <div className="nc-row" style={{ marginTop: 14 }}>
              <div className="field" style={{ margin: 0, flex: 1 }}><label>表單路徑</label>
                <input className="tf" value={sheetPath} onChange={(e) => setSheetPath(e.target.value)} placeholder="例：/service-tickets/10" /></div>
              <button className="btn btn-primary" onClick={() => void fetchRagicFields()} disabled={fetching}>{fetching ? "抓取中…" : "抓取欄位"}</button>
            </div>
            {fields.length > 0 && <div className="nc-ok">✓ 已讀取「{sheetName}」· {fields.length} 個欄位</div>}
            <div className="field" style={{ marginTop: 14, marginBottom: 0 }}><label>要通知哪些異動</label>
              <div className="nc-evs">
                <button className={`nc-ev${evCreate ? " on" : ""}`} onClick={() => setEvCreate((v) => !v)}><span className="nc-sw" />新增資料</button>
                <button className={`nc-ev${evUpdate ? " on" : ""}`} onClick={() => setEvUpdate((v) => !v)}><span className="nc-sw" />更新資料</button>
                <button className={`nc-ev${evDelete ? " on" : ""}`} onClick={() => setEvDelete((v) => !v)}><span className="nc-sw" />刪除資料</button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="nc-card">
          <div className="nc-card-h"><span className="nc-step-n">2</span>選擇系統事件</div>
          <div className="nc-card-sub">系統偵測到這些狀況時自動通知（無需在其他系統設定）</div>
          <div className="field" style={{ margin: 0 }}><label>事件</label>
            <StyledSelect ariaLabel="系統事件" value={eventType} onChange={pickEvent} placeholder="選擇事件"
              items={catalog.map((e) => ({ id: e.eventType, label: e.label }))} />
          </div>
          {selectedEvent && <div className="hint" style={{ marginTop: 8, fontSize: 12, color: "var(--ink-3)" }}>{selectedEvent.description}</div>}
          {numericFields.length > 0 && (
            <div className="nc-row" style={{ marginTop: 14 }}>
              <div className="field" style={{ margin: 0, flex: 1 }}><label>只在超過門檻時通知（選填）</label>
                <StyledSelect ariaLabel="門檻欄位" value={threshold.path} onChange={(p) => setThreshold((t) => ({ ...t, path: p }))}
                  placeholder="不設門檻" allowEmpty emptyLabel="不設門檻"
                  items={numericFields.map((f) => ({ id: f.path, label: f.label }))} /></div>
              <div className="field" style={{ margin: 0, flex: "0 0 140px" }}><label>大於等於</label>
                <input className="tf" type="number" value={threshold.value} disabled={!threshold.path}
                  onChange={(e) => setThreshold((t) => ({ ...t, value: e.target.value }))} placeholder="例：150" /></div>
            </div>
          )}
        </div>
      )}

      {/* Step 3 · 欄位 */}
      {showRest && fields.length > 0 && (
        <div className="nc-card">
          <div className="nc-card-h"><span className="nc-step-n">3</span>選擇要通知的欄位</div>
          <div className="nc-card-sub">勾選 · 依勾選順序逐行列在訊息裡（已選 {selected.length} 個）</div>
          <div className="nc-flds">
            {fields.map((f) => {
              const on = selected.includes(f.path);
              return (
                <button key={f.path} className={`nc-fld${on ? " on" : ""}`} onClick={() => toggleField(f.path)}>
                  <span className="nc-cb">{on && <svg viewBox="0 0 24 24"><path d="M4 12l6 6L20 6" /></svg>}</span>
                  <span className="nc-fld-name">{f.label}</span>
                  <span className="nc-fld-id">{f.path}</span>
                  <span className="nc-fld-ord">{on ? selected.indexOf(f.path) + 1 : "–"}</span>
                </button>
              );
            })}
          </div>
          <div className="field" style={{ margin: "16px 0 0" }}><label>自訂訊息標題（選填）</label>
            <input className="tf" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={sourceType === "ragic_form" ? (sheetName || "例：維修保養通知") : (selectedEvent?.label ?? "")} /></div>
        </div>
      )}

      {/* Step 4 · 管道 */}
      {showRest && fields.length > 0 && (
        <div className="nc-card">
          <div className="nc-card-h"><span className="nc-step-n">4</span>通知對象</div>
          <div className="nc-card-sub">要發到哪裡</div>
          <div className="field" style={{ marginBottom: 14 }}><label>管道</label>
            <div className="nc-evs">
              <button className={`nc-ev${channelType === "line_group" ? " on" : ""}`}
                onClick={() => { setChannelType("line_group"); setChannelTarget(""); }}><span className="nc-sw" />LINE 群組</button>
              <button className={`nc-ev${channelType === "line_user" ? " on" : ""}`}
                onClick={() => { setChannelType("line_user"); setChannelTarget(""); }}><span className="nc-sw" />LINE 私訊</button>
            </div>
          </div>
          {channelType === "line_group" ? (
            <div className="field" style={{ margin: 0 }}><label>LINE 目標群</label>
              {lineGroups.length > 0 ? (
                <StyledSelect ariaLabel="LINE 目標群" value={channelTarget} onChange={setChannelTarget} placeholder="選擇 LINE 群"
                  items={lineGroups.map((g) => ({ id: g.groupId, label: g.displayName || g.groupId }))} />
              ) : (
                <input className="tf" value={channelTarget} onChange={(e) => setChannelTarget(e.target.value)}
                  placeholder={sourceType === "ragic_form" ? "先選 Ragic 帳號 · 或直接貼 LINE group id" : "貼上 LINE group id"} />
              )}
            </div>
          ) : (
            <div className="field" style={{ margin: 0 }}><label>私訊對象（需已綁定 LINE）</label>
              <StyledSelect ariaLabel="私訊對象" value={channelTarget} onChange={setChannelTarget} placeholder="選擇成員"
                items={users.map((u) => ({ id: u.userId, label: u.name }))} />
              {users.length === 0 && <div className="hint" style={{ fontSize: 12, color: "var(--warn)" }}>此租戶尚無已綁定 LINE 的成員</div>}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !showRest || fields.length === 0}>
          {saving ? "儲存中…" : "儲存規則"}
        </button>
      </div>
    </div>
  );
}
