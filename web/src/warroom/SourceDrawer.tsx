import { useEffect, useState } from "react";
import Drawer from "../shared/Drawer";
import { catLabel } from "../shared/categoryLabel";
import { statusLabel } from "../shared/recordStatusLabel";
import { ApiError, getTicketSource, type TicketSource } from "../api";
import SourceMessageList from "./SourceMessageList";
import { useT } from "../i18n/useT";

// 核對前對照：AI 整理的內容 vs 當時的原始訊息。
// 主管簽下去是要負責的 —— 看不到原文，核對就只是幫 AI 背書。
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
  category: "kb.fldCategory", title: "sd.title", detail: "sd.detail", status: "kb.fldStatus",
  person: "sd.person", machine_code: "sd.machine", work_order: "sd.workOrder",
  customer: "sd.customer", vehicle: "sd.vehicle", site: "sd.site", issues: "sd.issues",
};

export default function SourceDrawer({ open, onClose, ticketId, summary, confidence, needsReview }: Props) {
  const tr = useT();
  const [data, setData] = useState<TicketSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !ticketId) { setData(null); setErr(null); return; }
    let alive = true;
    setLoading(true); setErr(null);
    getTicketSource(ticketId)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : tr("common.loadFailed")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, ticketId]);

  return (
    <Drawer open={open} onClose={onClose} title={tr("sd.title2")} subtitle={summary ?? ""} width={580}>
      <div className="tc-hdr" style={{ marginTop: 0 }}>
        <span className={`tag ${confidence === "high" ? "ok" : confidence === "medium" ? "warn" : "danger"}`}>
          {tr(`wr.conf.${confidence}`)}
        </span>
        {needsReview && <span className="tag danger">{tr("sd.held")}</span>}
      </div>

      {loading && <div className="tc-empty">{tr("common.loading")}</div>}
      {err && <div className="tc-empty">{err}</div>}

      {/* 取不到原文時要說出原因，不能讓人以為「本來就沒有」 */}
      {!loading && !err && data?.unavailableReason && (
        <div className="tc-empty">{data.unavailableReason}</div>
      )}


      {!loading && !err && data && (
        <div className="tc-sec">
          <SourceMessageList data={data} />
        </div>
      )}

      {!loading && !err && data?.extracted && (
        <div className="tc-sec">
          <span className="tc-sec-lbl">{tr("sd.extracted")}</span>
          <div className="tc-extract">
            {Object.entries(data.extracted)
              .filter(([k, v]) => FIELD_LABEL[k] && v != null && v !== "")
              .map(([k, v]) => (
                <div key={k} className="tc-kv">
                  <span className="tc-k">{tr(FIELD_LABEL[k])}</span>
                  <span className="tc-v">{fmtValue(k, v)}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}
