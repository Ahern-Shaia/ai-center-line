import { useEffect, useState } from "react";
import Drawer from "../shared/Drawer";
import { catLabel } from "../shared/categoryLabel";
import { statusLabel } from "../shared/recordStatusLabel";
import { ApiError, getTicketSource, type TicketSource } from "../api";

// 簽核前對照：AI 整理的內容 vs 當時的原始訊息。
// 主管簽下去是要負責的 —— 看不到原文，簽核就只是幫 AI 背書。
//
// ⚠️ 2026-07-27 修：這支原本讀 mockdata/lineExcerpts（示範資料），
//    真實任務查不到對應就整片空白。改接 GET /warroom/tickets/:id/source。
interface Props {
  open: boolean;
  onClose: () => void;
  ticketId: string | null;
  summary: string | null;
  confidence: "high" | "medium" | "low" | null;
  needsReview: boolean;
}

/**
 * ⚠️ 欄位名與**值**都要翻。
 * 原本只翻了欄位名，值直接 String(v) —— 於是畫面上出現
 * 「狀態：in_progress」「分類：procurement」，把資料庫的 enum 丟給客戶看。
 */
function fmtValue(key: string, v: unknown): string {
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  if (key === "status") return statusLabel(s);
  if (key === "category") return catLabel(s);
  return s;
}

// 欄位一律顯示中文 · 不把資料庫欄位名丟給使用者看
const FIELD_LABEL: Record<string, string> = {
  category: "分類", title: "標題", detail: "內容", status: "狀態",
  person: "對口", machine_code: "工位", work_order: "案號／車號",
  customer: "客戶", vehicle: "車輛", site: "站點", issues: "問題",
};

export default function SourceDrawer({ open, onClose, ticketId, summary, confidence, needsReview }: Props) {
  const [data, setData] = useState<TicketSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !ticketId) { setData(null); setErr(null); return; }
    let alive = true;
    setLoading(true); setErr(null);
    getTicketSource(ticketId)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : "載入失敗"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, ticketId]);

  return (
    <Drawer open={open} onClose={onClose} title="來源與整理結果" subtitle={summary ?? ""} width={580}>
      <div className="tc-hdr" style={{ marginTop: 0 }}>
        <span className={`tag ${confidence === "high" ? "ok" : confidence === "medium" ? "warn" : "danger"}`}>
          {confidence === "high" ? "高信心" : confidence === "medium" ? "中信心" : "低信心"}
        </span>
        {needsReview && <span className="tag danger">已自動攔截 · 需補資訊</span>}
      </div>

      {loading && <div className="tc-empty">載入中…</div>}
      {err && <div className="tc-empty">{err}</div>}

      {/* 取不到原文時要說出原因，不能讓人以為「本來就沒有」 */}
      {!loading && !err && data?.unavailableReason && (
        <div className="tc-empty">{data.unavailableReason}</div>
      )}

      {!loading && !err && data && data.messages.length > 0 && (
        <div className="tc-sec">
          <span className="tc-sec-lbl">這是根據以下 {data.messages.length} 則訊息整理的</span>
          <div className="tc-raw">
            {data.messages.map((m) => (
              <div key={m.id} className="ts-msg">
                <span className="ts-msg-meta">{m.time} {m.sender}</span>
                <span className="ts-msg-text">{m.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !err && data?.extracted && (
        <div className="tc-sec">
          <span className="tc-sec-lbl">整理出的內容</span>
          <div className="tc-extract">
            {Object.entries(data.extracted)
              .filter(([k, v]) => FIELD_LABEL[k] && v != null && v !== "")
              .map(([k, v]) => (
                <div key={k} className="tc-kv">
                  <span className="tc-k">{FIELD_LABEL[k]}</span>
                  <span className="tc-v">{fmtValue(k, v)}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}
