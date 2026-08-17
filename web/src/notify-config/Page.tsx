import Spinner from "../shared/Spinner";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ApiError, ncListRules, ncRemove, ncSetEnabled, notifyWebhookUrl, type NotifyRuleRow } from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import Wizard from "./Wizard";
import LogsTab from "./LogsTab";
import RuleFilters, { matchRule, DEFAULT_PAGE_SIZE, type RuleFilterState, EMPTY_FILTERS } from "./RuleFilters";
import Pager from "./Pager";

const SOURCE_LABEL: Record<string, string> = { ragic_form: "Ragic", internal_event: "系統事件" };
const CHANNEL_LABEL: Record<string, string> = { line_group: "LINE 群組", line_user: "LINE 私訊" };

/**
 * 觸發欄的三格（新／更／刪）· 沒開的變灰而不是消失 —— 位置固定整欄才掃得動。
 * 後端目前只回組好的 `eventsLabel` 字串，所以這裡反推。有了 API 的布林欄位就改讀那個。
 * （「更新」不含「新增」，比對安全）
 */
const TRIGGERS: Array<{ key: string; short: string }> = [
  { key: "新增", short: "新" },
  { key: "更新", short: "更" },
  { key: "刪除", short: "刪" },
];

/**
 * 目標群沒登錄時，後端的 channelLabel 會退回原始 channelTarget（33 碼）。
 * 那串 ID 對人沒有意義，卻會撐爆欄寬 —— 但「指到我方沒有紀錄的群」是要處理的狀態，
 * 所以不是藏起來，是講清楚並留尾碼可對照。
 */
function targetView(r: NotifyRuleRow): { text: string; idSuffix: string | null; unregistered: boolean; title: string } {
  const raw = r.channelTarget ?? "";
  const unregistered = r.channelType === "line_group" && raw !== "" && r.channelLabel === raw;
  return unregistered
    ? { text: "未登錄的群組", idSuffix: `…${raw.slice(-7)}`, unregistered: true, title: raw }
    : { text: r.channelLabel, idSuffix: null, unregistered: false, title: r.channelLabel };
}

// 通知設定（aiproot）· 規則列表 + 新增 wizard · 來源/管道無關
export default function NotifyConfigPage() {
  const toast = useToast();
  const [mode, setMode] = useState<"list" | "wizard">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copyFromId, setCopyFromId] = useState<string | null>(null);
  const [tab, setTab] = useState<"rules" | "logs">("rules");
  const [rules, setRules] = useState<NotifyRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [delTarget, setDelTarget] = useState<NotifyRuleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<RuleFilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // 選單改用 fixed 定位（表格 overflow:hidden 會裁掉 absolute 的選單）· 座標開啟當下算
  const [menu, setMenu] = useState<{ ruleId: string; style: CSSProperties } | null>(null);
  const menuFor = menu?.ruleId ?? null;
  const closeMenu = () => setMenu(null);

  /** 依 ⋯ 按鈕的實際位置決定往下或往上開 —— 最後一列往下開會超出畫面 */
  function openMenu(ruleId: string, btn: HTMLElement) {
    const r = btn.getBoundingClientRect();
    const MENU_MAX_H = 190;                       // 四個項目 + 分隔線的概估高度
    const openUp = window.innerHeight - r.bottom < MENU_MAX_H;
    setMenu({
      ruleId,
      style: openUp
        ? { bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right }
        : { top: r.bottom + 4, right: window.innerWidth - r.right },
    });
  }

  const shown = useMemo(() => rules.filter((r) => matchRule(r, filters)), [rules, filters]);
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  // ⚠️ 篩選一變就回第 1 頁 —— 停在第 2 頁時收窄篩選，結果只剩 1 頁就會是空白畫面
  const changeFilters = (next: RuleFilterState) => { setFilters(next); setPage(1); closeMenu(); };
  // 每頁筆數變大時當前頁可能超出範圍（第 4 頁 × 10 筆 → 改成 100 筆只剩 1 頁）
  const changePageSize = (n: number) => { setPageSize(n); setPage(1); closeMenu(); };
  const pageRows = shown.slice((page - 1) * pageSize, page * pageSize);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRules(await ncListRules()); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "載入失敗", "danger"); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  // fixed 座標是開啟當下算的 · 捲動或改視窗大小後會跟按鈕脫節，直接關掉最誠實
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

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
    // ⚠️ Ragic 沒有叫「同步」的子選單 —— 那是展開選單裡右下角那一區的標題。
    //    舊文案寫「工具 → 同步 → Webhook」會讓人去找一個不存在的下一層（實機確認 2026-07-29）。
    toast.show("已複製 · 貼到 Ragic：工具 → 右下角「同步與通知」→ Webhook", "ok");
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
    const leave = () => { setMode("list"); setEditingId(null); setCopyFromId(null); };
    return (
      <Wizard
        ruleId={editingId ?? undefined}
        copyFrom={copyFromId ?? undefined}
        onDone={() => { leave(); void load(); }}
        onCancel={leave}
      />
    );
  }

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>通知設定</h1>
          {/* 權限說明本來掛在分頁列右側，但那個位置照 mockup 改成「每頁筆數」了 —— 資訊不能因此消失 */}
          <div className="sub">一條規則＝什麼事發生（來源）→ 通知誰（管道）· 支援 Ragic 表單異動與系統內部事件<br />僅具「通知設定」權限的 aiproot 員工可見與管理</div>
        </div>
        <div><button className="btn btn-primary" onClick={() => { setEditingId(null); setCopyFromId(null); setMode("wizard"); }}>＋ 新增通知規則</button></div>
      </div>

      <div className="dm-tabs">
        <button className={`dm-tab${tab === "rules" ? " active" : ""}`} onClick={() => setTab("rules")}>通知規則</button>
        <button className={`dm-tab${tab === "logs" ? " active" : ""}`} onClick={() => setTab("logs")}>通知紀錄</button>
      </div>

      {tab === "logs" ? <LogsTab /> : loading ? (
        <Spinner block />
      ) : rules.length === 0 ? (
        <div className="dm-empty">
          尚無通知規則
          <div className="dm-empty-hint">按右上「＋ 新增通知規則」建立第一筆</div>
        </div>
      ) : (
        <>
          <RuleFilters rules={rules} value={filters} onChange={changeFilters} />
          {shown.length === 0 ? (
            <div className="dm-empty">
              沒有符合條件的規則
              <div className="dm-empty-hint">試著放寬篩選，或按上方「清除全部」。</div>
            </div>
          ) : (
          // 欄寬照 mockup 的 colgroup（23/18/11/7/21/8/12）· 七欄不是八欄：
          // 「來源表單」是一格（Ragic 標籤＋路徑），拆成兩欄會把省下來的寬度又吃回去
          <table className="nc-tbl fixed">
            <colgroup>
              <col style={{ width: "23%" }} /><col style={{ width: "18%" }} /><col style={{ width: "11%" }} />
              <col style={{ width: "7%" }} /><col style={{ width: "21%" }} /><col style={{ width: "8%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead><tr>
              <th>規則</th><th>來源表單</th><th>觸發</th><th className="nc-num">欄位</th>
              <th>通知對象</th><th>狀態</th><th className="nc-num">操作</th>
            </tr></thead>
            <tbody>
              {pageRows.map((r) => {
                const t = targetView(r);
                return (
                <tr key={r.ruleId}>
                  <td>
                    <div className="nc-t-name" title={r.name}>{r.name}</div>
                    {r.accountDisplayName && <div className="nc-t-sub">{r.accountDisplayName}</div>}
                  </td>
                  <td>
                    <span className="nc-pill ev">{SOURCE_LABEL[r.sourceType] ?? r.sourceType}</span>
                    {/* 不加 nc-clip：nowrap 會讓整段路徑被當成一個不可斷的單位、整條掉到第二行。
                        mockup 是讓路徑自己在 `-` 處斷（/order- / operation/4），這裡跟著它 */}
                    <span className="nc-t-mono" style={{ fontSize: 12 }} title={r.sourceLabel}>{r.sourceLabel}</span>
                  </td>
                  <td>
                    <span className="nc-trig" title={r.eventsLabel || "未選擇任何異動"}>
                      {TRIGGERS.map((tr) => (
                        <i key={tr.key} className={r.eventsLabel.includes(tr.key) ? undefined : "no"}>{tr.short}</i>
                      ))}
                    </span>
                  </td>
                  <td className="nc-num" title={r.fieldLabels.join("、")}>{r.fieldCount}</td>
                  <td>
                    <div className="nc-tgt" title={t.title}>
                      <span className={`nc-dot ${t.unregistered ? "warn" : r.enabled ? "ok" : "off"}`} />
                      <span className={t.unregistered ? "unreg" : "nm"}>{t.text}</span>
                      {t.idSuffix && <span className="id">{t.idSuffix}</span>}
                    </div>
                    <div className="nc-t-sub">{CHANNEL_LABEL[r.channelType] ?? r.channelType}</div>
                  </td>
                  <td>{r.enabled ? <span className="nc-pill on">啟用</span> : <span className="nc-pill off">停用</span>}</td>
                  <td>
                    <div className="nc-act">
                      {/* 沒有編輯的話，要調整欄位只能整條刪掉重建 —— 而重建會換 webhook 網址，
                          客戶還得回 Ragic 重貼一次。所以「編輯」留在外面，其餘收進 ⋯。*/}
                      <button className="nc-lnk" onClick={() => { setEditingId(r.ruleId); setMode("wizard"); }}>編輯</button>
                      <button className="nc-kebab" aria-label="更多操作"
                        onClick={(e) => (menuFor === r.ruleId ? closeMenu() : openMenu(r.ruleId, e.currentTarget))}>⋯</button>
                      {menuFor === r.ruleId && (
                        <>
                          <button className="nc-menu-veil" aria-label="關閉選單" onClick={closeMenu} />
                          <div className="nc-menu" style={menu?.style}>
                            {/* Ragic 規則必須把網址貼進 Ragic 才會通；建立當下的成功畫面關掉就找不回來，
                                逼人「刪掉重建」——所以列表要能隨時重新複製。*/}
                            {r.webhookToken && (
                              <button onClick={() => { copyWebhook(r.webhookToken as string); closeMenu(); }}>複製 Webhook 網址</button>
                            )}
                            {/* 同一張表單常要開好幾條只差通知對象的規則 · 從頭走一次精靈要重挑欄位 */}
                            <button onClick={() => { setCopyFromId(r.ruleId); setEditingId(null); closeMenu(); setMode("wizard"); }}>複製規則</button>
                            <button onClick={() => { void toggleEnabled(r); closeMenu(); }}>{r.enabled ? "停用" : "啟用"}</button>
                            <div className="nc-menu-sep" />
                            <button className="danger" onClick={() => { setDelTarget(r); closeMenu(); }}>刪除</button>
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          )}
          {shown.length > 0 && (
            <Pager
              page={page}
              pageCount={pageCount}
              total={shown.length}
              pageSize={pageSize}
              onPage={(p) => { setPage(p); closeMenu(); }}
              onPageSize={changePageSize}
              summarySuffix={shown.length !== rules.length ? `（全部 ${rules.length} 筆）` : undefined}
            />
          )}
        </>
      )}

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
