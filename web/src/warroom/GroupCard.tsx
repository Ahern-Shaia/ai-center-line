import { useState } from "react";
import { ApiError, getWarroomGroupMessages, type WarroomGroupMessage } from "../api";
import { useToast } from "../Toast";
import { catLabel } from "../shared/categoryLabel";
import { statusLabel } from "../shared/recordStatusLabel";
import { canOpenConvoDetail, navigateTo } from "../nav";

// 群組日誌的一張群卡 · 從 DailyLog.tsx 抽出（該檔到 398 行，貼在 400 紅線上）
// 純搬移：GroupCard 與它私有的 RecordItem / DailyReportSummary / formatTime。

// 一張卡最多列幾筆。這頁是「今天各群發生什麼」的掃視，不是逐條細讀 ——
// 原本 5 筆 + detail 不截斷，卡片高度差到 5 倍，三欄網格就變成一片鋸齒空白。
const MAX_ITEMS = 3;

export default function GroupCard({
  groupId, groupName, departmentId, departmentName, batchDate, dailyReports, records, uploadId,
  analysisIncomplete,
}: {
  groupId: string;
  groupName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  batchDate: string;
  dailyReports: Array<Record<string, unknown>>;
  records: Array<Record<string, unknown>>;
  uploadId: number;
  /** 分析沒完成 —— 空白要說「尚未整理」不是「當日無工作日報」 */
  analysisIncomplete: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<WarroomGroupMessage[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function toggleExpand() {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (messages !== null) return;   // 已載入 · 不重打
    setLoading(true);
    try {
      const res = await getWarroomGroupMessages(groupId, batchDate);
      setMessages(res.messages);
      setTotal(res.total);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入群訊息失敗", "danger");
      setExpanded(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dl-card">
      <div className="dl-card-hdr">
        {/* ⚠️ 不要把 LINE 的 group ID（Cf668e5a…）當標題印給使用者看 ——
            那是內部識別碼，對客戶沒有意義，還會讓畫面看起來像沒設定好。
            拉不到群名時說「未命名群組」並附短碼，至少看得出是哪一群。 */}
        <span className="dl-card-group">{groupName ?? `未命名群組 · ${groupId.slice(-6)}`}</span>
        {departmentName && <span className="dl-card-dept">{departmentName}</span>}
      </div>
      {/* ⚠️ 沒有部門 = materializer 直接 skip 整批，**一張任務都不會建**。
          原本只有 server log 有一行 warn，畫面上什麼都沒有 ——
          使用者看到 AI 抽出 11 項卻在任務看板找不到，只能猜是不是內容不夠格。
          （2026-07-29 客戶就是這樣問的） */}
      {!departmentId && (
        <div className="dl-card-nodept">
          此群尚未分派部門 · 分析結果<b>不會變成任務</b>
          <span className="dl-card-nodept-hint">到「設定 → 通訊管道 → LINE 群組」分派部門後，下次分析才會建立任務</span>
        </div>
      )}
      {/* ⚠️ 分析沒完成時，原本這張卡整列被後端過濾掉，畫面顯示「當日無資料」——
          跟「那天真的很閒」分不出來，客戶看到後者所以不會來問。
          語意寫「還沒好」不是「壞了」：客戶不需要知道我們的內部狀態機。
          也刻意**不給重跑按鈕** —— 重跑要花 API 費用且要判斷原因，那是 aiproot 的事。 */}
      {analysisIncomplete && (
        <div className="dl-card-nodept">
          這一天的分析<b>尚未完成</b> · 內容還沒整理出來
          <span className="dl-card-nodept-hint">已記錄，系統管理員會處理 · 完成後這張卡會自動出現內容</span>
        </div>
      )}
      {dailyReports.length > 0 ? (
        <ul className="dl-report-list">
          {dailyReports.slice(0, MAX_ITEMS).map((r, i) => (
            <li key={i} className="dl-report-item">
              <DailyReportSummary r={r} />
            </li>
          ))}
          {dailyReports.length > MAX_ITEMS && (
            <li className="dl-report-more">
              {canOpenConvoDetail() ? (
                <button className="nc-lnk" onClick={() => navigateTo({ page: "convo-detail", uploadId })}>
                  + {dailyReports.length - MAX_ITEMS} 筆 · 查完整對話 →
                </button>
              ) : <span>+ {dailyReports.length - 5} 筆</span>}
            </li>
          )}
        </ul>
      ) : records.length > 0 ? (
        <>
          <div className="dl-records-hint">
            此群無工廠報工格式訊息 · 但 AI 抽出 <b>{records.length}</b> 項分類記錄
          </div>
          <div className="dl-records">
            {records.slice(0, MAX_ITEMS).map((r, i) => (
              <RecordItem key={i} r={r} />
            ))}
            {records.length > MAX_ITEMS && (
              <div className="dl-report-more">
                {canOpenConvoDetail() ? (
                  <button className="nc-lnk" onClick={() => navigateTo({ page: "convo-detail", uploadId })}>
                    + {records.length - MAX_ITEMS} 筆 · 查完整對話 →
                  </button>
                ) : <span>+ {records.length - 5} 筆</span>}
              </div>
            )}
          </div>
        </>
      ) : analysisIncomplete ? null : (
        <div className="dl-card-empty">當日無工作日報</div>
      )}

      <button className="dl-card-toggle" onClick={() => void toggleExpand()}>
        {expanded ? "收合原始訊息 ▲" : "展開群內原始訊息 ▼"}
      </button>

      {expanded && (
        <div className="dl-raw">
          {loading && <div style={{ fontSize: 12, color: "var(--ink-3)", padding: 8 }}>載入中…</div>}
          {!loading && messages && messages.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--ink-3)", padding: 8, textAlign: "center" }}>當日此群 bot 無收到訊息</div>
          )}
          {!loading && messages && messages.length > 0 && (
            <>
              <div className="dl-raw-hdr">bot 收到的訊息 · {total} 則{total > 100 ? "（顯示前 100）" : ""}</div>
              {messages.map((m) => (
                <div key={m.messageId} className="dl-raw-item">
                  <div className="dl-raw-meta">
                    <span className="dl-raw-time">{formatTime(m.sentAt)}</span>
                    <span className="dl-raw-who">{m.senderName ?? "(未綁定成員)"}</span>
                  </div>
                  <div className="dl-raw-text">
                    {m.messageType === "text" && m.textContent}
                    {m.messageType === "sticker" && <span style={{ color: "var(--ink-3)" }}>[貼圖]</span>}
                    {m.messageType === "image" && <span style={{ color: "var(--ink-3)" }}>[圖片]</span>}
                    {!["text", "sticker", "image"].includes(m.messageType) && <span style={{ color: "var(--ink-3)" }}>[{m.messageType}]</span>}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function RecordItem({ r }: { r: Record<string, unknown> }) {
  const category = r.category ? catLabel(r.category as string) : "未分類";
  const title = (r.title as string) || "";
  const detail = (r.detail as string) || "";
  const status = r.status as string | null;
  const person = r.person as string | null;
  const machineCode = r.machine_code as string | null;
  const workOrder = r.work_order as string | null;

  const fields: Array<[string, string]> = [];
  if (person) fields.push(["對口", person]);
  if (machineCode) fields.push(["機台", machineCode]);
  if (workOrder) fields.push(["工單", workOrder]);
  if (status) fields.push(["狀態", statusLabel(status)]);

  return (
    <div className="dl-record-item">
      <div className="dl-record-cat">{category}</div>
      <div className="dl-record-summary">
        {title}
        {detail && detail !== title && <span style={{ color: "var(--ink-2)" }}> · {detail}</span>}
      </div>
      {fields.length > 0 && (
        <div className="dl-record-fields">
          {fields.map(([k, v]) => (
            <span key={k} className="dl-record-field"><b>{k}</b>{v}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function DailyReportSummary({ r }: { r: Record<string, unknown> }) {
  const reporter = r.reporter_name || r.reporter_code || "未署名";
  const parts: string[] = [];
  if (r.line) parts.push(`線別 ${r.line}`);
  if (r.machine_code) parts.push(`機台 ${r.machine_code}`);
  if (r.work_order) parts.push(`工單 ${r.work_order}`);
  if (r.output_qty != null) parts.push(`產出 ${r.output_qty}`);
  if (r.defect_qty != null) parts.push(`不良 ${r.defect_qty}`);
  if (r.work_hours != null) parts.push(`工時 ${r.work_hours}h`);
  return (
    <>
      <span className="dl-report-who">{String(reporter)}</span>
      <span className="dl-report-parts">{parts.join(" · ") || "—"}</span>
      {r.issues != null && String(r.issues).trim() && (
        <div className="dl-report-issue">問題：{String(r.issues)}</div>
      )}
    </>
  );
}
