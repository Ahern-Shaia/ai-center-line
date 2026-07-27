import { useCallback, useEffect, useState } from "react";
import { ApiError, ncListLogs, type NotifyLogRow } from "../api";
import { useToast } from "../Toast";

// 通知紀錄 · 回答「Ragic 改了為什麼沒通知」
// 關鍵不是把 status 字串印出來，而是每一種狀態都要能直接讀成「所以我現在該做什麼」。
const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "mut"; why: string }> = {
  sent:              { label: "已送出",       tone: "ok",     why: "訊息已推送到 LINE" },
  line_failed:       { label: "推送失敗",     tone: "danger", why: "我們收到了，但 LINE 拒絕——多半是 Bot token 失效或機器人已離開該群組" },
  skipped_dedup:     { label: "重複略過",     tone: "mut",    why: "30 秒內同一筆重複觸發，只送第一次" },
  skipped_event:     { label: "未訂閱此異動", tone: "warn",   why: "事件有進來，但這條規則沒勾選這種異動（新增／更新／刪除）" },
  skipped_filter:    { label: "未達門檻",     tone: "mut",    why: "內部事件被規則的數值門檻過濾掉" },
  invalid_body:      { label: "內容不符",     tone: "warn",   why: "送進來的內容無法解析" },
  invalid_secret:    { label: "驗證失敗",     tone: "danger", why: "token 不正確" },
  sheet_not_allowed: { label: "表單未授權",   tone: "warn",   why: "該表單不在此規則允許範圍" },
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "全部" },
  { key: "sent", label: "已送出" },
  { key: "line_failed", label: "推送失敗" },
  { key: "skipped_event", label: "未訂閱此異動" },
  { key: "skipped_dedup", label: "重複略過" },
];

export default function LogsTab() {
  const toast = useToast();
  const [rows, setRows] = useState<NotifyLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await ncListLogs({ limit: 100, status: status || undefined })); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "載入失敗", "danger"); }
    finally { setLoading(false); }
  }, [status, toast]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="nc-log-bar">
        <div className="nc-log-filters">
          {FILTERS.map((f) => (
            <button key={f.key} className={`nc-lnk${status === f.key ? " active" : ""}`} onClick={() => setStatus(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>重新整理</button>
      </div>

      {loading ? (
        <div className="dm-empty">載入中…</div>
      ) : rows.length === 0 ? (
        <div className="dm-empty">
          {status ? "這個狀態沒有紀錄" : "還沒有任何通知紀錄"}
          {!status && (
            <div className="dm-empty-hint">
              一筆都沒有＝<b>事件從來沒有進到我們這裡</b>。若是 Ragic 規則，代表 Webhook 網址沒貼進該表單：
              到規則列表按「複製網址」→ Ragic 該表單 → 右上三角下拉 → <b>工具 → 同步 → Webhook</b> → 貼上儲存 →
              仍沒反應就<b>登出 Ragic 再登入</b>（設定有 session 快取）。
            </div>
          )}
        </div>
      ) : (
        <table className="nc-tbl">
          <thead><tr>
            <th style={{ width: "16%" }}>時間</th><th style={{ width: "24%" }}>規則</th>
            <th style={{ width: "14%" }}>結果</th><th style={{ width: "18%" }}>來源對象</th>
            <th style={{ width: "20%" }}>說明</th><th style={{ width: "8%" }}>耗時</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const s = STATUS[r.status] ?? { label: r.status, tone: "mut" as const, why: "" };
              return (
                <tr key={i} onClick={() => setOpen(open === i ? null : i)} style={{ cursor: "pointer" }}>
                  <td className="nc-t-mono" style={{ fontSize: 12 }}>{formatTime(r.receivedAt)}</td>
                  <td>
                    <div className="nc-t-name">{r.ruleName ?? "（規則已刪除）"}</div>
                    {open === i && r.messageText && <div className="nc-log-msg">{r.messageText}</div>}
                    {open === i && <Diagnostics audit={r.audit} />}
                  </td>
                  <td><span className={`nc-pill ${s.tone}`}>{s.label}</span></td>
                  <td className="nc-t-mono" style={{ fontSize: 12 }}>
                    {r.sourceRef || "—"}{r.recordId ? ` · #${r.recordId}` : ""}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--ink-2)" }}>
                    {r.lineMessage ? `${r.lineStatus ?? ""} ${r.lineMessage}`.trim() : s.why}
                  </td>
                  <td className="nc-t-mono" style={{ fontSize: 12 }}>{r.latencyMs != null ? `${r.latencyMs} ms` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="login-hint" style={{ marginTop: 12 }}>
        最近 100 筆 · 點任一列可展開實際送出的訊息內容。
      </div>
    </>
  );
}

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
    <div className="nc-log-diag">
      <div className="nc-log-diag-verdict">{verdict}</div>
      <div>記錄編號 {String(a.parsedRecordId ?? "—")} · 抓到 {a.payloadKeyCount ?? 0} 個欄位 · 對上 {matched}/{total}</div>
      {a.payloadKeys?.length ? <div>資料的欄位鍵：{a.payloadKeys.join(", ")}</div> : null}
      {a.templatePaths?.length ? <div>規則設定的欄位：{a.templatePaths.join(", ")}</div> : null}
      {a.webhookBody ? <div>Ragic 送來的原始內容：<code>{a.webhookBody}</code></div> : null}
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
