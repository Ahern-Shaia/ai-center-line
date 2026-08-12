import Spinner from "../shared/Spinner";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, ncListRules, ncRemove, ncSetEnabled, notifyWebhookUrl, type NotifyRuleRow } from "../api";
import { useToast } from "../Toast";
import ConfirmDialog from "../shared/ConfirmDialog";
import Wizard from "./Wizard";
import LogsTab from "./LogsTab";
import RuleFilters, { matchRule, PAGE_SIZE, type RuleFilterState, EMPTY_FILTERS } from "./RuleFilters";

const SOURCE_LABEL: Record<string, string> = { ragic_form: "Ragic 表單", internal_event: "系統事件" };
const CHANNEL_LABEL: Record<string, string> = { line_group: "LINE 群組", line_user: "LINE 私訊" };

/**
 * 目標群沒登錄時，後端的 channelLabel 會退回原始 channelTarget（33 碼）。
 * 那串 ID 對人沒有意義，卻會撐爆欄寬 —— 但「指到我方沒有紀錄的群」是要處理的狀態，
 * 所以不是藏起來，是講清楚並留尾碼可對照。
 */
function targetView(r: NotifyRuleRow): { text: string; unregistered: boolean; title: string } {
  const raw = r.channelTarget ?? "";
  const unregistered = r.channelType === "line_group" && raw !== "" && r.channelLabel === raw;
  return unregistered
    ? { text: `未登錄的群組 …${raw.slice(-7)}`, unregistered: true, title: raw }
    : { text: r.channelLabel, unregistered: false, title: r.channelLabel };
}

// 通知設定（aiproot）· 規則列表 + 新增 wizard · 來源/管道無關
export default function NotifyConfigPage() {
  const toast = useToast();
  const [mode, setMode] = useState<"list" | "wizard">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tab, setTab] = useState<"rules" | "logs">("rules");
  const [rules, setRules] = useState<NotifyRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [delTarget, setDelTarget] = useState<NotifyRuleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<RuleFilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const shown = useMemo(() => rules.filter((r) => matchRule(r, filters)), [rules, filters]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  // ⚠️ 篩選一變就回第 1 頁 —— 停在第 2 頁時收窄篩選，結果只剩 1 頁就會是空白畫面
  const changeFilters = (next: RuleFilterState) => { setFilters(next); setPage(1); setMenuFor(null); };
  const pageRows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
    return <Wizard ruleId={editingId ?? undefined} onDone={() => { setMode("list"); setEditingId(null); void load(); }} onCancel={() => { setMode("list"); setEditingId(null); }} />;
  }

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>通知設定</h1>
          <div className="sub">一條規則＝什麼事發生（來源）→ 通知誰（管道）· 支援 Ragic 表單異動與系統內部事件</div>
        </div>
        <div><button className="btn btn-primary" onClick={() => { setEditingId(null); setMode("wizard"); }}>＋ 新增通知規則</button></div>
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
          <table className="nc-tbl fixed">
            <thead><tr>
              <th style={{ width: "22%" }}>規則</th><th style={{ width: "11%" }}>來源</th><th style={{ width: "15%" }}>來源對象</th>
              <th style={{ width: "11%" }}>觸發</th><th style={{ width: "7%" }}>欄位</th>
              <th style={{ width: "16%" }}>通知對象</th><th style={{ width: "8%" }}>狀態</th><th style={{ width: "10%" }}>操作</th>
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
                  <td><span className="nc-pill ev">{SOURCE_LABEL[r.sourceType] ?? r.sourceType}</span></td>
                  <td><div className="nc-clip nc-t-mono" title={r.sourceLabel}>{r.sourceLabel}</div></td>
                  <td><div className="nc-clip" title={r.eventsLabel}>{r.eventsLabel}</div></td>
                  <td style={{ whiteSpace: "nowrap" }} title={r.fieldLabels.join("、")}>{r.fieldCount} 欄</td>
                  <td>
                    <div className={`nc-clip${t.unregistered ? " warn" : ""}`} title={t.title}>{t.text}</div>
                    <div className="nc-t-sub">{CHANNEL_LABEL[r.channelType] ?? r.channelType}</div>
                  </td>
                  <td>{r.enabled ? <span className="nc-pill on">啟用</span> : <span className="nc-pill off">停用</span>}</td>
                  <td>
                    <div className="nc-act">
                      {/* 沒有編輯的話，要調整欄位只能整條刪掉重建 —— 而重建會換 webhook 網址，
                          客戶還得回 Ragic 重貼一次。所以「編輯」留在外面，其餘收進 ⋯。*/}
                      <button className="nc-lnk" onClick={() => { setEditingId(r.ruleId); setMode("wizard"); }}>編輯</button>
                      <button className="nc-kebab" aria-label="更多操作"
                        onClick={() => setMenuFor(menuFor === r.ruleId ? null : r.ruleId)}>⋯</button>
                      {menuFor === r.ruleId && (
                        <>
                          <button className="nc-menu-veil" aria-label="關閉選單" onClick={() => setMenuFor(null)} />
                          <div className="nc-menu">
                            {/* Ragic 規則必須把網址貼進 Ragic 才會通；建立當下的成功畫面關掉就找不回來，
                                逼人「刪掉重建」——所以列表要能隨時重新複製。*/}
                            {r.webhookToken && (
                              <button onClick={() => { copyWebhook(r.webhookToken as string); setMenuFor(null); }}>複製 Webhook 網址</button>
                            )}
                            <button onClick={() => { void toggleEnabled(r); setMenuFor(null); }}>{r.enabled ? "停用" : "啟用"}</button>
                            <div className="nc-menu-sep" />
                            <button className="danger" onClick={() => { setDelTarget(r); setMenuFor(null); }}>刪除</button>
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
            <div className="nc-pager">
              <div>
                第 {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, shown.length)} 筆，共 <b>{shown.length}</b> 筆
                {shown.length !== rules.length && `（全部 ${rules.length} 筆）`}
              </div>
              {pageCount > 1 && (
                <div className="nc-pages">
                  <button className="nc-pg" disabled={page <= 1} onClick={() => { setPage(page - 1); setMenuFor(null); }}>‹</button>
                  <span className="nc-pg-at">第 {page} / {pageCount} 頁</span>
                  <button className="nc-pg" disabled={page >= pageCount} onClick={() => { setPage(page + 1); setMenuFor(null); }}>›</button>
                </div>
              )}
              <div>僅具「通知設定」權限的 aiproot 員工可見與管理</div>
            </div>
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
