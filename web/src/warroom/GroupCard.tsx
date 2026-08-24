import { useState } from "react";
import { ApiError, getWarroomGroupMessages, type WarroomGroupMessage } from "../api";
import { useToast } from "../Toast";
import { catLabel } from "../shared/categoryLabel";
import { statusLabel } from "../shared/recordStatusLabel";
import { canOpenConvoDetail, navigateTo } from "../nav";

// 群組日誌的一群 = 一列 feed（V4 時間軸脊重構）。
// 收合＝一行摘要（燈點 + 群名 + 一句話 + 筆數）；展開＝細節（日報/記錄 + 原始訊息）。
// 掃描邏輯：眼睛一路往下，只在琥珀燈點（需注意）停。

const MAX_ITEMS = 3;

type Signal = "ok" | "warn" | "mute";

export interface GroupRowProps {
  groupId: string;
  groupName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  batchDate: string;
  dailyReports: Array<Record<string, unknown>>;
  records: Array<Record<string, unknown>>;
  /** 客服報修派工單（service_order 第二區塊）· 獨立一區顯示，不被 records fallback 蓋掉 */
  serviceIntake: Array<Record<string, unknown>>;
  uploadId: number;
  /** 分析沒完成 —— 摘要要說「尚未整理」不是「當日無工作日報」 */
  analysisIncomplete: boolean;
}

// 一列的訊號燈 + 一句摘要 + 筆數 + 需注意 pill —— 掃描全靠這個
function deriveRow(p: GroupRowProps): { signal: Signal; summary: string; count: string; pill: string | null } {
  if (!p.departmentId) {
    return { signal: "warn", summary: "此群尚未分派部門 · 分析結果不會變成任務", count: "", pill: "未分派部門" };
  }
  if (p.analysisIncomplete) {
    return { signal: "warn", summary: "這一天的分析尚未完成 · 內容還沒整理出來", count: "", pill: "分析未完成" };
  }
  // 報修派工單優先：它是「有人在等回覆」的待辦，比當日記錄更該被看到
  if (p.serviceIntake.length > 0) {
    const first = p.serviceIntake[0];
    const who = (first.customer as string) || (first.vehicle as string) || "";
    const issue = typeof first.issue === "string" && first.issue.trim() ? first.issue.trim() : "";
    return {
      signal: "ok",
      summary: `${p.serviceIntake.length} 張報修派工${who || issue ? ` · ${who ? who + "：" : ""}${issue}` : ""}`,
      count: `${p.serviceIntake.length} 張`,
      pill: null,
    };
  }
  if (p.dailyReports.length > 0) {
    const first = p.dailyReports[0];
    const issue = typeof first.issues === "string" && first.issues.trim() ? first.issues.trim() : null;
    return {
      signal: "ok",
      summary: `${p.dailyReports.length} 則報工${issue ? ` · ${issue}` : ""}`,
      count: `${p.dailyReports.length} 則`,
      pill: null,
    };
  }
  if (p.records.length > 0) {
    const first = p.records[0];
    const cat = first.category ? catLabel(first.category as string) : "";
    const title = (first.title as string) || (first.detail as string) || "";
    return {
      signal: "ok",
      summary: `${p.records.length} 項記錄${cat || title ? ` · ${cat ? cat + "：" : ""}${title}` : ""}`,
      count: `${p.records.length} 項`,
      pill: null,
    };
  }
  return { signal: "mute", summary: "當日無工作日報", count: "", pill: null };
}

export default function GroupCard(props: GroupRowProps) {
  const { groupId, groupName, departmentId, departmentName, batchDate, dailyReports, records, serviceIntake, uploadId, analysisIncomplete } = props;
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<WarroomGroupMessage[] | null>(null);
  const [total, setTotal] = useState(0);
  const [rawOpen, setRawOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const { signal, summary, count, pill } = deriveRow(props);

  async function loadRaw() {
    if (rawOpen) { setRawOpen(false); return; }
    setRawOpen(true);
    if (messages !== null) return;
    setLoading(true);
    try {
      const res = await getWarroomGroupMessages(groupId, batchDate);
      setMessages(res.messages);
      setTotal(res.total);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入群訊息失敗", "danger");
      setRawOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`dlr${signal === "warn" ? " dlr-attn" : ""}`}>
      <button className="dlr-hd" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className={`dlr-dot dlr-dot-${signal}`} aria-hidden />
        {/* ⚠️ 群 ID（Cf668e5a…）是內部識別碼，不當標題印給客戶看 */}
        <span className="dlr-name">{groupName ?? `未命名群組 · ${groupId.slice(-6)}`}</span>
        {departmentName && <span className="dlr-dept">{departmentName}</span>}
        <span className="dlr-sum">{summary}</span>
        {pill && <span className="dlr-pill">{pill}</span>}
        {count && <span className="dlr-count">{count}</span>}
        <span className="dlr-chev" aria-hidden>{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="dlr-body">
          {/* ⚠️ 沒有部門 = materializer 直接 skip，一張任務都不會建 */}
          {!departmentId && (
            <div className="dl-card-nodept">
              此群尚未分派部門 · 分析結果<b>不會變成任務</b>
              <span className="dl-card-nodept-hint">到「設定 → LINE 群組」分派部門後，下次分析才會建立任務</span>
            </div>
          )}
          {/* ⚠️ 分析沒完成 ≠ 那天很閒 —— 說「還沒好」不是「壞了」 */}
          {analysisIncomplete && (
            <div className="dl-card-nodept">
              這一天的分析<b>尚未完成</b> · 內容還沒整理出來
              <span className="dl-card-nodept-hint">已記錄，系統管理員會處理 · 完成後這裡會自動出現內容</span>
            </div>
          )}
          {/* 報修派工單 · 獨立一區（不進 dailyReports/records 的 fallback 鏈）——
              同一天可能既有派工單又有其他記錄，用 fallback 會把派工單蓋掉。*/}
          {serviceIntake.length > 0 && (
            <div className="dl-intake">
              <div className="dl-intake-hdr">報修派工 · {serviceIntake.length} 張</div>
              {serviceIntake.slice(0, MAX_ITEMS).map((r, i) => <IntakeItem key={i} r={r} />)}
              {serviceIntake.length > MAX_ITEMS && (
                <div className="dl-report-more">
                  {canOpenConvoDetail() ? (
                    <button className="nc-lnk" onClick={() => navigateTo({ page: "convo-detail", uploadId })}>
                      + {serviceIntake.length - MAX_ITEMS} 張 · 查完整對話 →
                    </button>
                  ) : <span>+ {serviceIntake.length - MAX_ITEMS} 張</span>}
                </div>
              )}
            </div>
          )}
          {dailyReports.length > 0 ? (
            <ul className="dl-report-list">
              {dailyReports.slice(0, MAX_ITEMS).map((r, i) => (
                <li key={i} className="dl-report-item"><DailyReportSummary r={r} /></li>
              ))}
              {dailyReports.length > MAX_ITEMS && (
                <li className="dl-report-more">
                  {canOpenConvoDetail() ? (
                    <button className="nc-lnk" onClick={() => navigateTo({ page: "convo-detail", uploadId })}>
                      + {dailyReports.length - MAX_ITEMS} 筆 · 查完整對話 →
                    </button>
                  ) : <span>+ {dailyReports.length - MAX_ITEMS} 筆</span>}
                </li>
              )}
            </ul>
          ) : records.length > 0 ? (
            <div className="dl-records">
              {records.slice(0, MAX_ITEMS).map((r, i) => <RecordItem key={i} r={r} />)}
              {records.length > MAX_ITEMS && (
                <div className="dl-report-more">
                  {canOpenConvoDetail() ? (
                    <button className="nc-lnk" onClick={() => navigateTo({ page: "convo-detail", uploadId })}>
                      + {records.length - MAX_ITEMS} 筆 · 查完整對話 →
                    </button>
                  ) : <span>+ {records.length - MAX_ITEMS} 筆</span>}
                </div>
              )}
            </div>
          ) : analysisIncomplete || !departmentId || serviceIntake.length > 0 ? null : (
            // ⚠️ serviceIntake 有東西時不可再說「當日無工作日報」—— 上面才剛列出派工單，會自相矛盾
            <div className="dl-card-empty">當日無工作日報</div>
          )}

          <button className="dl-card-toggle" onClick={() => void loadRaw()}>
            {rawOpen ? "收合原始訊息 ▲" : "展開群內原始訊息 ▼"}
          </button>

          {rawOpen && (
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

// 一張客服報修派工單 · 沿用 .dl-record-* 版型（同一頁的視覺語言）
// 欄位對照 serviceIntakeSchema：customer/site/vehicle/warranty/issue/status/contact/phone
function IntakeItem({ r }: { r: Record<string, unknown> }) {
  const customer = (r.customer as string) || "";
  const site = (r.site as string) || "";
  const vehicle = (r.vehicle as string) || "";
  const issue = (r.issue as string) || "";
  const warranty = r.warranty as string | null;
  const status = r.status as string | null;
  const contact = r.contact as string | null;
  const phone = r.phone as string | null;

  const fields: Array<[string, string]> = [];
  if (vehicle) fields.push(["車輛", vehicle]);
  if (warranty) fields.push(["保固", warranty]);
  if (contact) fields.push(["聯絡人", contact]);
  if (phone) fields.push(["電話", phone]);
  if (status) fields.push(["狀態", status]);

  // 客戶未抽到時（表單常無「客戶:」欄）用車輛當標題，不要顯示空白列
  const head = customer || vehicle || "未指明客戶";
  return (
    <div className="dl-record-item">
      <div className="dl-record-cat dl-intake-cat">報修</div>
      <div className="dl-record-summary">
        <b>{head}</b>{site && <span style={{ color: "var(--ink-3)" }}> · {site}</span>}
        {issue && <span style={{ color: "var(--ink-2)" }}> · {issue}</span>}
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
