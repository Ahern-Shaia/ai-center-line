import { useCallback, useEffect, useState } from "react";
import { ApiError, getExtractionHealth, type FieldFill, type TenantHealth } from "../api";
import { useToast } from "../Toast";

// 抽取健康度 · docs/modules/ai-analysis-layering.md §5
// 回答一個問題：這個客戶的業種模板選對了嗎？
// 訊號是「某欄位長期趨近 0%」—— 2026-07-27 台灣福祉 schema 不合是手動連 DB 才發現的。

// 欄位名稱一律中文（feedback_chinese_first_ui_text）
const FIELD_LABEL: Record<string, string> = {
  person: "當責人", status: "狀態", machine_code: "機台", work_order: "工單",
  work_hours: "工時", reporter_code: "回報人代碼", customer: "客戶／案場", vehicle: "車輛",
};
const label = (f: string) => FIELD_LABEL[f] ?? f;

export default function ExtractionHealth() {
  const toast = useToast();
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<TenantHealth[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await getExtractionHealth(days)).tenants); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "載入失敗", "danger"); }
    finally { setLoading(false); }
  }, [days, toast]);
  useEffect(() => { void load(); }, [load]);

  // 沒有任何訊息的租戶不列 —— 那是「還沒開始用」，不是健康度問題，列出來只會稀釋訊號
  const active = rows.filter((t) => t.messageCount > 0);
  const idle = rows.length - active.length;

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>抽取健康度</h1>
          <div className="sub">每個客戶的業種模板選對了嗎 · 欄位長期抽不到就代表模板與該客戶的回報格式不合</div>
        </div>
        <div className="hdr-toolbar">
          <div className="hdr-group">
            <label className="hdr-label">統計期間</label>
            <div style={{ display: "flex", gap: 6 }}>
              {[7, 30].map((d) => (
                <button key={d} className={`btn${days === d ? " btn-primary" : ""}`}
                  onClick={() => setDays(d)} disabled={loading}>近 {d} 天</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="dm-empty">載入中…</div>
      ) : active.length === 0 ? (
        <div className="dm-empty">
          這段期間沒有任何客戶產生分析結果
          <div className="dm-empty-hint">確認 LINE 群組已啟用 AI 分析、且排程有執行</div>
        </div>
      ) : (
        <>
          {active.map((t) => <TenantCard key={t.tenantId} t={t} />)}
          {idle > 0 && (
            <div className="login-hint" style={{ marginTop: 12 }}>
              另有 {idle} 家客戶這段期間沒有分析資料（尚未開始使用，不列入健康度判讀）。
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TenantCard({ t }: { t: TenantHealth }) {
  const conf = t.confidence.high + t.confidence.medium + t.confidence.low;
  const highPct = conf ? Math.round((t.confidence.high / conf) * 100) : 0;

  return (
    <div className="eh-card">
      <div className="eh-hdr">
        <span className="eh-name">{t.tenantName}</span>
        <span className="nc-pill ev">{t.templateLabel}</span>
        <span className="eh-stats">
          讀取 {t.messageCount} 則 · 核心產出 {t.recordCount} 筆 · 業種產出 {t.templateReportCount} 筆
          {conf > 0 && <> · 高信心 {highPct}%</>}
        </span>
      </div>

      {t.warnings.length > 0 && (
        <div className="eh-warn">
          {t.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
        </div>
      )}

      <div className="eh-fields">
        {t.fields.map((f) => <FieldBar key={`${f.layer}-${f.field}`} f={f} />)}
      </div>
    </div>
  );
}

function FieldBar({ f }: { f: FieldFill }) {
  // total=0 顯示「無資料」而不是 0% —— 0% 會被讀成「抽不到」，但實際是「根本沒有這種資料」
  const noData = f.total === 0;
  const tone = noData ? "" : f.rate < 10 ? " danger" : f.rate < 40 ? " warn" : " ok";
  return (
    <div className="eh-field">
      <span className="eh-field-name">
        <span className="eh-layer">{f.layer}</span>{label(f.field)}
      </span>
      <span className="eh-bar"><i className={`eh-bar-fill${tone}`} style={{ width: `${noData ? 0 : f.rate}%` }} /></span>
      <span className={`eh-rate${tone}`}>
        {noData ? "無資料" : `${f.rate}%`}
        {!noData && <span className="eh-frac">{f.filled}/{f.total}</span>}
      </span>
    </div>
  );
}
