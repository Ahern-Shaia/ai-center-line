import Spinner from "../shared/Spinner";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, ncListLogs, ncListRules, type NotifyLogPage, type NotifyLogRow, type NotifyRuleRow } from "../api";
import StyledSelect from "../shared/StyledSelect";
import Pager from "./Pager";
import { useToast } from "../Toast";

// 通知紀錄 · 回答「Ragic 改了為什麼沒通知」
// 關鍵不是把 status 字串印出來，而是每一種狀態都要能直接讀成「所以我現在該做什麼」。
const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "mut"; why: string }> = {
  sent:              { label: "已送出",       tone: "ok",     why: "訊息已推送到 LINE" },
  line_failed:       { label: "推送失敗",     tone: "danger", why: "我們收到了，但 LINE 拒絕——多半是機器人金鑰失效，或機器人已離開該群組" },
  skipped_dedup:     { label: "重複略過",     tone: "mut",    why: "30 秒內同一筆重複觸發，只送第一次" },
  skipped_event:     { label: "未訂閱此異動", tone: "warn",   why: "事件有進來，但這條規則沒勾選這種異動（新增／更新／刪除）" },
  skipped_filter:    { label: "未達門檻",     tone: "mut",    why: "內部事件被規則的數值門檻過濾掉" },
  // 兩種情況共用：webhook 內容解析不了，或欄位一個都取不到（那種訊息全是「（未填）」，
  // 現在改成不送 —— 送出去對收件的人是純噪音）。實際原因寫在 line_message，這裡只是 fallback。
  invalid_body:      { label: "內容不符",     tone: "warn",   why: "內容無法解析，或設定的欄位在這筆資料裡一個都取不到（未送出）" },
  invalid_secret:    { label: "驗證失敗",     tone: "danger", why: "網址中的驗證碼不正確" },
  sheet_not_allowed: { label: "表單未授權",   tone: "warn",   why: "該表單不在此規則允許範圍" },
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "全部" },
  { key: "sent", label: "已送出" },
  { key: "line_failed", label: "推送失敗" },
  { key: "skipped_event", label: "未訂閱此異動" },
  { key: "skipped_dedup", label: "重複略過" },
  { key: "invalid_body", label: "內容不符" },
];

// 時間範圍 · 人是用時間找事情的（「上週三那筆」），不是用序號
const RANGES = [
  { id: "today", label: "今天", days: 0 },
  { id: "7d", label: "近 7 天", days: 6 },
  { id: "30d", label: "近 30 天", days: 29 },
  { id: "all", label: "全部", days: null },
] as const;

const PAGE_SIZE = 25;

/** 使用者講的日期是台北的 · DB 跑 UTC，後端會把邊界轉回台北 00:00 */
function taipeiDateBefore(days: number): string {
  const now = new Date();
  const shifted = new Date(now.getTime() - days * 86_400_000);
  return shifted.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

export default function LogsTab() {
  const toast = useToast();
  const [data, setData] = useState<NotifyLogPage>({ rows: [], total: 0, statusCounts: {} });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [range, setRange] = useState<string>("7d");
  const [ruleId, setRuleId] = useState("");
  const [page, setPage] = useState(1);
  const [rules, setRules] = useState<NotifyRuleRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  const from = useMemo(() => {
    const r = RANGES.find((x) => x.id === range);
    return r?.days == null ? undefined : taipeiDateBefore(r.days);
  }, [range]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await ncListLogs({
        page, pageSize: PAGE_SIZE, status: status || undefined, ruleId: ruleId || undefined, from,
      }));
    } catch (e) { toast.show(e instanceof ApiError ? e.message : "載入失敗", "danger"); }
    finally { setLoading(false); }
  }, [page, status, ruleId, from, toast]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { ncListRules().then(setRules).catch(() => undefined); }, []);

  // ⚠️ 篩選一變就回第 1 頁。停在第 3 頁時改篩選 → 結果只剩 1 頁 → 空白畫面，
  //    看起來像沒資料。這是分頁最典型的 bug。
  const changeFilter = (fn: () => void) => { fn(); setPage(1); setOpen(null); };

  const { rows, total, statusCounts } = data;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeLabel = RANGES.find((x) => x.id === range)?.label ?? "";
  const filtered = status !== "" || ruleId !== "" || range !== "all";

  return (
    <>
      <div className="nc-log-bar">
        <div className="nc-log-filters">
          {FILTERS.map((f) => {
            const n = f.key === "" ? Object.values(statusCounts).reduce((a, b) => a + b, 0) : statusCounts[f.key] ?? 0;
            return (
              <button key={f.key} className={`nc-lnk${status === f.key ? " active" : ""}`}
                onClick={() => changeFilter(() => setStatus(f.key))}>
                {f.label}
                <span className={`nc-log-n${f.key === "line_failed" && n > 0 ? " bad" : ""}`}>{n}</span>
              </button>
            );
          })}
        </div>
        <div className="nc-log-right">
          <StyledSelect ariaLabel="時間範圍" value={range} onChange={(v) => changeFilter(() => setRange(v))}
            items={RANGES.map((r) => ({ id: r.id, label: r.label }))} />
          <StyledSelect ariaLabel="規則" value={ruleId} onChange={(v) => changeFilter(() => setRuleId(v))}
            allowEmpty emptyLabel="全部規則" placeholder="全部規則"
            items={rules.map((r) => ({ id: r.ruleId, label: r.name }))} />
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>重新整理</button>
        </div>
      </div>

      {loading ? (
        <Spinner block />
      ) : rows.length === 0 ? (
        <div className="dm-empty">
          {filtered ? `${rangeLabel}內沒有符合的紀錄` : "還沒有任何通知紀錄"}
          {/* 預設只看近 7 天 · 找不到時要明說可以放寬，否則看起來像紀錄不見了 */}
          {filtered && (
            <div className="dm-empty-hint">
              找的是更早以前的事？把時間範圍改成<b>近 30 天</b>或<b>全部</b>再看一次。
            </div>
          )}
          {!filtered && (
            <div className="dm-empty-hint">
              一筆都沒有＝<b>事件從來沒有進到我們這裡</b>。若是 Ragic 規則，代表 Webhook 網址沒貼進該表單：
              到規則列表按「複製網址」→ Ragic 該表單 → 上方「工具」→ 展開後<b>右下角「同步與通知」區 → Webhook</b> → 貼上儲存 →
              仍沒反應就<b>登出 Ragic 再登入</b>（設定有 session 快取）。
            </div>
          )}
        </div>
      ) : (
        // 欄寬照 mockup 的 colgroup（15/23/13/19/22/8）
        <table className="nc-tbl fixed">
          <colgroup>
            <col style={{ width: "15%" }} /><col style={{ width: "23%" }} /><col style={{ width: "13%" }} />
            <col style={{ width: "19%" }} /><col style={{ width: "22%" }} /><col style={{ width: "8%" }} />
          </colgroup>
          <thead><tr>
            <th>時間</th><th>規則</th><th>結果</th><th>來源對象</th><th>說明</th><th className="nc-num">耗時</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const s = STATUS[r.status] ?? { label: r.status, tone: "mut" as const, why: "" };
              const expanded = open === i;
              return [
                <tr key={`r${i}`} onClick={() => setOpen(expanded ? null : i)} style={{ cursor: "pointer" }}>
                  <td className="nc-t-mono" style={{ fontSize: 12 }}>{formatTime(r.receivedAt)}</td>
                  <td><div className="nc-t-name">{ruleLabel(r.ruleId, r.ruleName)}</div></td>
                  <td><span className={`nc-pill ${s.tone}`}>{s.label}</span></td>
                  {/* 截斷一律配 title —— 截斷但沒有提示等於資訊消失 */}
                  <td><div className="nc-clip nc-t-mono" title={sourceLabel(r)}>{sourceLabel(r)}</div></td>
                  <td><div className="nc-clip" title={whyText(r, s.why)}>{whyText(r, s.why)}</div></td>
                  <td className="nc-num mono">{r.latencyMs != null ? `${r.latencyMs} ms` : "—"}</td>
                </tr>,
                // 展開內容自己一列橫跨表格 · 塞在「規則」儲存格裡會被 23% 欄寬夾扁
                expanded && (r.messageText || r.audit) ? (
                  <tr key={`x${i}`} className="nc-exp">
                    <td />
                    <td colSpan={5}>
                      <div className="nc-exp-in">
                        {r.messageText && (
                          <>
                            <div className="nc-exp-h">實際送出的訊息</div>
                            <div className="nc-log-msg">{r.messageText}</div>
                          </>
                        )}
                        <Diagnostics audit={r.audit} />
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      )}

      {!loading && rows.length > 0 && (
        <Pager
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={PAGE_SIZE}
          onPage={(p) => { setPage(p); setOpen(null); }}
          summarySuffix={`（${rangeLabel}）`}
          note="點任一列可展開實際送出的訊息與診斷"
        />
      )}
    </>
  );
}

const sourceLabel = (r: NotifyLogRow): string =>
  `${r.sourceRef || "—"}${r.recordId ? ` · #${r.recordId}` : ""}`;

const whyText = (r: NotifyLogRow, fallback: string): string =>
  r.lineMessage ? `${r.lineStatus ?? ""} ${r.lineMessage}`.trim() : fallback;

// 「欄位全是（未填）」的診斷：分辨是抓不到 record、key 對不上、還是資料本來就空
function Diagnostics({ audit }: { audit: Record<string, unknown> | null }) {
  if (!audit) return null;
  const a = audit as {
    recordFetched?: boolean; fetchError?: string; fetchSkipped?: string;
    payloadKeys?: string[]; payloadKeyCount?: number; templatePaths?: string[]; matchedPaths?: number;
    parsedRecordId?: number | null; webhookBody?: string;
  };
  if (a.recordFetched === undefined && !a.fetchSkipped && !a.fetchError) return null;

  const total = a.templatePaths?.length ?? 0;
  const matched = a.matchedPaths ?? 0;
  const verdict =
    a.fetchError ? `抓取 Ragic 完整資料失敗：${a.fetchError}`
    : a.fetchSkipped === "webhook 未帶 record id"
      ? "Ragic 送來的內容裡沒有可辨識的記錄編號——多半是 Webhook 設成「精簡」模式，看下方原始內容確認"
    : a.fetchSkipped ? `未抓取完整資料：${a.fetchSkipped}`
    : total > 0 && matched === 0 ? "已抓到資料，但勾選的欄位在資料裡一個都對不上——欄位設定與這張表單不符（表單改過或路徑不同）"
    : total > 0 && matched < total ? `已抓到資料，${total} 個欄位中有 ${total - matched} 個對不上`
    : "欄位都對得上——顯示（未填）代表該欄位在 Ragic 本來就是空的";

  return (
    <>
      <div className="nc-exp-h">診斷</div>
      {/* mockup 只有 chips；判讀句是實作既有的 —— 它講的是「所以你該去改什麼」，
          chips 只給數字，兩者不重複，所以留著 */}
      <div className="nc-log-diag-verdict">{verdict}</div>
      <div className="nc-diag">
        <span>抓取 Ragic 資料 <b>{a.fetchError ? "失敗" : a.fetchSkipped ? "未執行" : a.recordFetched ? "成功" : "—"}</b></span>
        <span>回傳欄位數 <b>{a.payloadKeyCount ?? 0}</b></span>
        <span className={total > 0 && matched < total ? "bad" : undefined}>
          範本欄位對上 <b>{matched} / {total}</b>
        </span>
        <span>單號 <b>{a.parsedRecordId != null ? `#${a.parsedRecordId}` : "—"}</b></span>
      </div>
      <div className="nc-log-diag">
        {a.payloadKeys?.length ? <div>資料的欄位鍵：{a.payloadKeys.join(", ")}</div> : null}
        {a.templatePaths?.length ? <div>規則設定的欄位：{a.templatePaths.join(", ")}</div> : null}
        {a.webhookBody ? <div>Ragic 送來的原始內容：<code>{a.webhookBody}</code></div> : null}
      </div>
    </>
  );
}

/**
 * 「規則」欄要講得跟資料一樣確定，不可以多講。
 *
 * ⚠️ 原本一律寫「（規則已刪除）」，但 prod 53 筆日誌裡有 **48 筆的 `rule_id` 是 NULL** ——
 * 那是舊版 pipeline 留下的，當時根本沒有記錄是哪條規則觸發的。
 * 「沒記錄」跟「被刪掉」是兩件事，寫成後者等於宣稱一個沒發生過的事件，
 * 排查時會往「誰刪了規則」的方向找，而那個方向是空的。
 */
function ruleLabel(ruleId: string | null, ruleName: string | null): string {
  if (ruleName) return ruleName;
  if (!ruleId) return "—（舊版記錄 · 未留規則）";
  return "（規則已刪除）";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
