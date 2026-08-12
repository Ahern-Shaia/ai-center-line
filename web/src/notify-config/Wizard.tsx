import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError, ncCreateAccount, ncCreateRule, ncEventCatalog, ncFetchFields, ncGetRule, ncAllLineGroups,
  ncSendableTargets, type NcSendableTarget,
  ncListAccounts, ncNotifiableUsers, ncRenameAccount, ncUpdateRule, notifyWebhookUrl,
  type EventDef, type NcLineGroup, type NotifiableUser, type NotifyChannelType,
  type NotifySourceType, type RagicAccountRow,
} from "../api";
import { useToast } from "../Toast";
import StyledSelect from "../shared/StyledSelect";

const SERVERS = ["www", "ap5", "ap15", "ap16", "na3", "eu2"].map((s) => ({ id: s, label: s }));

// 可勾選欄位的統一形狀（Ragic 欄位 / 事件欄位都轉成這個）
interface SelectableField { path: string; label: string; numeric?: boolean }

/**
 * 新增／編輯通知規則。
 *
 * 編輯時，**來源、Ragic 表單路徑、webhook 網址一律唯讀** ——
 * 網址已經貼在客戶的 Ragic 那一側，改了通知會悄悄停掉，而客戶不會知道。
 * 要換表單請新增一條規則。
 */
export default function Wizard({ ruleId, onDone, onCancel }: {
  ruleId?: string; onDone: () => void; onCancel: () => void;
}) {
  const toast = useToast();
  const editing = !!ruleId;

  // 來源型別
  const [sourceType, setSourceType] = useState<NotifySourceType>("ragic_form");

  // --- Ragic 來源 ---
  const [accounts, setAccounts] = useState<RagicAccountRow[]>([]);
  const [accountId, setAccountId] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
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
  const [lineGroups, setLineGroups] = useState<NcLineGroup[]>([]);
  // 目標群改用手動輸入 · 下拉表達不了不在登錄表裡的群（webhook 沒收過訊息就不會有列）
  const [manualTarget, setManualTarget] = useState(false);
  const [users, setUsers] = useState<NotifiableUser[]>([]);
  const [channelTarget, setChannelTarget] = useState("");
  // 0061 · 先選「用哪支機器人發」，群組清單再依它過濾。
  // LINE 的群組 ID 是各機器人各自一套，挑到別支的群就是 400 而且畫面看不出原因
  // （2026-08-12 鮮湧事故）。把錯誤消滅在選項裡，不是靠使用者填對。
  const [sendable, setSendable] = useState<NcSendableTarget[]>([]);
  const [botId, setBotId] = useState("");
  const [saving, setSaving] = useState(false);
  // 編輯時抓不到 Ragic 的完整欄位 —— 此時可勾選的只有規則已存的那幾個，
  // 取消勾選再存檔就永久拿不回來。必須明講，不能讓人在不知情下弄丟欄位。
  const [fieldsIncomplete, setFieldsIncomplete] = useState(false);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [savedNoWebhook, setSavedNoWebhook] = useState(false);

  const loadAccounts = useCallback(async () => {
    try { setAccounts(await ncListAccounts()); } catch { /* ignore */ }
  }, []);

  // 編輯模式 · 把既有設定填回畫面
  useEffect(() => {
    if (!ruleId) return;
    void (async () => {
      try {
        const r = await ncGetRule(ruleId);
        setSourceType(r.sourceType);
        setAccountId(r.ragicAccountId ?? "");
        setSheetPath(r.sheetPath ?? "");
        setSheetName(r.sheetName ?? "");
        setEventType(r.eventType ?? "");
        setEvCreate(r.notifyCreate); setEvUpdate(r.notifyUpdate); setEvDelete(r.notifyDelete);
        setTitle(r.title ?? "");
        setChannelType(r.channelType);
        setChannelTarget(r.channelTarget ?? "");
        // 舊規則沒有 botId —— 留空會強迫使用者重選，那正是我們要的：
        // 沒選過 bot 的規則本來就處於「靠猜」的狀態，存檔時順便修正
        setBotId(r.botId ?? "");
        // 先用規則裡存的欄位讓畫面立刻有東西
        setFields(r.fields.map((f) => ({ path: f.path, label: f.label })));
        setSelected(r.fields.slice().sort((a, b) => a.order - b.order).map((f) => f.path));

        // 再去 Ragic 拿「整張表的欄位」當可勾選全集。
        // 只放規則存的那幾個是不夠的 —— 取消勾選再存檔之後，那個欄位就從清單消失，
        // 使用者再也加不回來。抓不到就維持上面那份（至少還能調順序、取消勾選）。
        if (r.sourceType === "ragic_form" && r.ragicAccountId && r.sheetPath) {
          try {
            const full = await ncFetchFields(r.ragicAccountId, r.sheetPath);
            if (full.fields.length > 0) {
              setFields(full.fields.map((f) => ({ path: String(f.fieldId), label: f.fieldName })));
            } else {
              setFieldsIncomplete(true);
            }
          } catch {
            // 連不上 Ragic 不擋住編輯，但一定要講 —— 否則使用者會以為看到的就是全部
            setFieldsIncomplete(true);
          }
        }
      } catch (e) {
        toast.show(e instanceof ApiError ? e.message : "載入規則失敗", "danger");
      }
    })();
  }, [ruleId, toast]);
  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => { ncEventCatalog().then(setCatalog).catch(() => setCatalog([])); }, []);
  useEffect(() => { ncNotifiableUsers().then(setUsers).catch(() => setUsers([])); }, []);
  // ⚠️ 刻意不綁 accountId。舊版是 ncLineGroups(accountId)，但那支從 ragic 帳號
  //    join 到租戶，而 prod 上帳號的 tenant_id 全是 NULL → 永遠回空陣列 →
  //    下拉永遠不出現、使用者永遠得手貼 group id。而且系統事件那條路沒有帳號。
  useEffect(() => { ncAllLineGroups().then(setLineGroups).catch(() => setLineGroups([])); }, []);
  useEffect(() => { ncSendableTargets().then(setSendable).catch(() => setSendable([])); }, []);

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

  function startRename() {
    const cur = accounts.find((a) => a.accountId === accountId);
    if (!cur) { toast.show("請先選一個 Ragic 帳號", "danger"); return; }
    setRenameName(cur.displayName);
    setAddingAccount(false);
    setRenaming(true);
  }

  async function saveRename() {
    try {
      await ncRenameAccount(accountId, renameName);
      toast.show("已更新名稱", "ok");
      await loadAccounts();
      setRenaming(false);
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "更新失敗", "danger"); }
  }

  async function fetchRagicFields() {
    if (!accountId) { toast.show("請先選 Ragic 帳號", "danger"); return; }
    if (!sheetPath.trim()) { toast.show("請輸入表單路徑", "danger"); return; }
    setFetching(true);
    try {
      const res = await ncFetchFields(accountId, sheetPath.trim());
      setFields(res.fields.map((f) => ({ path: String(f.fieldId), label: f.fieldName })));
      setSheetName(res.sheetName || sheetPath.trim());
      setFieldsIncomplete(false);
      // 編輯時重讀不要清掉已選的 —— 那等於逼人重新勾一次
      if (!editing) setSelected([]);
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

  /**
   * 全選 / 全部取消。
   *
   * ⚠️ 全選要照**欄位在表單裡的原始順序**填，不是把已選的接在後面 ——
   * 勾選順序決定訊息裡的行序，全選後如果順序是亂的，使用者得一個一個取消再重點。
   */
  function toggleAllFields() {
    setSelected((s) => (s.length === fields.length ? [] : fields.map((f) => f.path)));
  }

  async function save() {
    if (selected.length === 0) { toast.show("請至少勾選一個欄位", "danger"); return; }
    if (!channelTarget) { toast.show("請選擇通知對象", "danger"); return; }
    if (channelType === "line_group" && !botId) { toast.show("請先選擇要用哪支機器人發送", "danger"); return; }
    setSaving(true);
    try {
      const payloadFields = selected.map((p, i) => ({
        path: p, label: fields.find((f) => f.path === p)?.label ?? p, order: i,
      }));
      const filters = threshold.path && threshold.value !== ""
        ? [{ path: threshold.path, op: "gte" as const, value: Number(threshold.value) }]
        : [];
      if (editing) {
        await ncUpdateRule(ruleId!, {
          name: sourceType === "ragic_form" ? sheetName : (selectedEvent?.label ?? ""),
          title: title.trim() || null,
          notifyCreate: evCreate, notifyUpdate: evUpdate, notifyDelete: evDelete,
          fields: payloadFields,
          channelType, channelTarget, botId: channelType === "line_group" ? botId : undefined,
        });
        toast.show("已更新", "ok");
        onDone();
        return;
      }
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
        channelType, channelTarget, botId: channelType === "line_group" ? botId : undefined,
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
              {/* Ragic 實際路徑多一層「同步」· 少寫這層使用者常找不到 */}
              {/* ⚠️ Ragic 沒有叫「同步」的子選單 —— 那是展開選單裡右下角那一區的標題。
                  舊文案寫「工具 → 同步 → Webhook」會讓人去找不存在的下一層（實機確認 2026-07-29）。*/}
              <div className="nc-card-sub">該表單 → 上方「工具」→ 展開後<b>右下角「同步與通知」區 → Webhook</b> → 貼上此網址 → 儲存（一次即可）</div>
              <div className="nc-url-box">
                <code>{url}</code>
                <button className="nc-url-copy" onClick={() => { void navigator.clipboard?.writeText(url); toast.show("已複製", "ok"); }}>複製</button>
              </div>
              <div className="nc-callout">貼上後，之後每次符合條件的異動就會自動通知，<b>不用再貼任何程式碼</b>。<br />
                這個網址之後可在規則列表按「複製網址」重新取得，不必刪掉重建。</div>
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
        <h1>{editing ? "編輯通知規則" : "新增通知規則"}</h1>
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
              {accountId && (
                <button className="btn" onClick={() => (renaming ? setRenaming(false) : startRename())}>
                  {renaming ? "收合" : "重新命名"}
                </button>
              )}
              <button className="btn" onClick={() => { setRenaming(false); setAddingAccount((v) => !v); }}>
                {addingAccount ? "收合" : "＋ 新增帳號"}
              </button>
            </div>
            {renaming && (
              <div style={{ marginTop: 14, padding: 14, background: "var(--well)", borderRadius: 6 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>顯示名稱</label>
                  <input className="tf" value={renameName} autoFocus
                    onChange={(e) => setRenameName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveRename(); }}
                    placeholder="例：台灣福祉" />
                </div>
                <div className="nc-card-sub" style={{ marginTop: 8 }}>
                  只改這裡顯示的名稱。伺服器與帳號名（{accounts.find((a) => a.accountId === accountId)?.server} ·{" "}
                  {accounts.find((a) => a.accountId === accountId)?.apname}）是連線用的識別，不能改。
                </div>
                <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => void saveRename()}>儲存名稱</button>
              </div>
            )}
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
              <div className="field" style={{ margin: 0, flex: 1 }}><label>表單路徑{editing && "（不可修改）"}</label>
                <input className="tf" value={sheetPath} disabled={editing}
                  onChange={(e) => setSheetPath(e.target.value)} placeholder="例：/service-tickets/10" /></div>
              <button className="btn btn-primary" onClick={() => void fetchRagicFields()} disabled={fetching}>
                {fetching ? "抓取中…" : editing ? "重新讀取欄位" : "抓取欄位"}
              </button>
            </div>
            {editing && (
              <div className="login-hint" style={{ marginTop: 8 }}>
                表單路徑與 webhook 網址不能修改 —— 網址已經貼在 Ragic 那一側，
                改了通知會停掉而對方不會知道。<b>要換表單請新增一條規則。</b>
              </div>
            )}
            {fields.length > 0 && (fieldsIncomplete
              ? <div className="nc-warn">
                  ⚠️ 目前<b>連不上 Ragic</b>，下方只列得出這條規則已經在用的 {fields.length} 個欄位，
                  不是整張表的欄位。<b>現在取消勾選的欄位，存檔後就加不回來了</b>（除非之後連線恢復再重讀）。
                  想調整欄位請先確認 Ragic 帳號與金鑰可用，再按「重新讀取欄位」。
                </div>
              : <div className="nc-ok">✓ 已讀取「{sheetName}」· {fields.length} 個欄位</div>)}
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
          <div className="nc-card-h">
            <span className="nc-step-n">3</span>選擇要通知的欄位
            {/* 表單常有數十個欄位，一個一個點很痛。全選／全不選都用同一顆按鈕，
                因為「已經全選了」的時候唯一想做的事就是清掉重來。 */}
            <button className="nc-selall" onClick={toggleAllFields}>
              {selected.length === fields.length ? "全部取消" : `全選 ${fields.length} 個`}
            </button>
          </div>
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
          {/* 已存的對象若不在可選清單裡（群改名、bot 被移出、跨帳號），下面會把它補成一個選項 ——
              否則下拉只顯示空的 placeholder，看起來像從沒設定過。*/}
          {channelType === "line_group" ? (
            <>
              <div className="field" style={{ marginBottom: 14 }}><label>用哪支機器人發送</label>
                <StyledSelect ariaLabel="發送機器人" value={botId}
                  onChange={(v) => { setBotId(v); setChannelTarget(""); }}
                  placeholder="選擇機器人"
                  items={sendable.map((b) => ({
                    id: b.botId,
                    // 帶租戶名：aiproot 一個人管多家，只看 bot 名分不出是哪家的
                    label: [b.tenantName, b.botName].filter(Boolean).join(" · "),
                  }))} />
                <div className="hint" style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>
                  選好之後，下面只會列出<b>這支機器人所在的群組</b>。
                  LINE 的群組編號是各機器人各自一套，不能互用。
                </div>
              </div>
              <div className="field" style={{ margin: 0 }}><label>LINE 目標群</label>
                <StyledSelect ariaLabel="LINE 目標群" value={channelTarget} onChange={setChannelTarget}
                  placeholder={botId ? "選擇 LINE 群" : "請先選機器人"}
                  disabled={!botId}
                  items={[
                    ...(sendable.find((b) => b.botId === botId)?.groups ?? []).map((g) => ({
                      id: g.groupId, label: g.displayName || g.groupId,
                    })),
                    // 編輯既有規則時，原本的群可能不在清單裡（群名未同步、或該群從沒收過訊息）。
                    // 不補這一項的話下拉會空白，看起來像從沒設定過。
                    ...(channelTarget && !(sendable.find((b) => b.botId === botId)?.groups ?? [])
                      .some((g) => g.groupId === channelTarget)
                      ? [{ id: channelTarget, label: `${channelTarget}（目前設定）` }]
                      : []),
                  ]} />
                <div className="hint" style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>
                  {botId && (sendable.find((b) => b.botId === botId)?.groups.length ?? 0) === 0
                    ? "這支機器人目前沒有任何群組 · 把它拉進群、並在群裡發一則訊息後就會出現"
                    : "找不到群組？把機器人拉進該群，然後在群裡隨便發一則訊息，這裡就會出現。"}
                </div>
              </div>
            </>
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
