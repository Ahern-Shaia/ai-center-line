import { useCallback, useEffect, useState } from "react";
import {
  getConvoUpload,
  getConvoMetrics,
  createConvoLabel,
  type ConvoUploadDetail,
  type ConvoMetrics,
  type ConvoLabel,
  ApiError,
} from "./api";
import { useToast } from "./Toast";

interface Props {
  uploadId: number;
  onBack: () => void;
}

type Tab = "messages" | "daily_reports" | "records";

const CATEGORY_LABEL: Record<string, string> = {
  daily_report: "日報",
  attendance: "出勤",
  maintenance: "維修",
  rnd: "研發",
  procurement: "採購",
  chitchat: "閒聊",
};

const CATEGORY_COLOR: Record<string, string> = {
  daily_report: "#2b9348",
  attendance: "#9b59b6",
  maintenance: "#e74c3c",
  rnd: "#3498db",
  procurement: "#f39c12",
  chitchat: "#95a5a6",
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "#2b9348",
  medium: "#f39c12",
  low: "#c62828",
};

export default function ConversationAnalysisDetail({ uploadId, onBack }: Props) {
  const [detail, setDetail] = useState<ConvoUploadDetail | null>(null);
  const [metrics, setMetrics] = useState<ConvoMetrics | null>(null);
  const [tab, setTab] = useState<Tab>("messages");
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const fetchAll = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([getConvoUpload(uploadId), getConvoMetrics(uploadId).catch(() => null)]);
      setDetail(d);
      setMetrics(m);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "載入失敗";
      toast.show(msg, "danger");
    } finally {
      setLoading(false);
    }
  }, [uploadId, toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const labelIndex = new Map<string, ConvoLabel>();
  for (const l of detail?.labels ?? []) {
    labelIndex.set(`${l.targetType}:${l.targetId}`, l);
  }

  async function handleLabel(targetType: Tab, targetId: string, correct: boolean) {
    try {
      await createConvoLabel({ uploadId, targetType: targetType as ConvoLabel["targetType"], targetId, correct });
      toast.show(`已標記為${correct ? "正確" : "錯誤"}`, "ok");
      await fetchAll();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "標記失敗";
      toast.show(msg, "danger");
    }
  }

  if (loading) return <div className="pane"><div style={{ padding: 40, textAlign: "center", color: "#999" }}>載入中...</div></div>;
  if (!detail) return <div className="pane"><div style={{ padding: 40, textAlign: "center", color: "#c62828" }}>找不到資料</div></div>;

  const { upload, result } = detail;

  return (
    <div className="pane">
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "#0066cc",
            cursor: "pointer",
            padding: 0,
            fontSize: 14,
            marginBottom: 8,
          }}
        >
          ← 返回列表
        </button>
        <h1 style={{ margin: 0 }}>{upload.filename}</h1>
        <div style={{ color: "#666", marginTop: 4, fontSize: 13 }}>
          #{upload.id} · {upload.tenantSlug} · {upload.messageCount ?? 0} 訊息 · {upload.segmentCount ?? 0} 段 ·
          上傳於 {new Date(upload.uploadedAt).toLocaleString("zh-TW", { hour12: false })}
        </div>
      </div>

      {/* Metric bar */}
      {metrics && metrics.label_count > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            padding: 16,
            background: "#f5faff",
            border: "1px solid #b3d7ff",
            borderRadius: 6,
            marginBottom: 20,
          }}
        >
          <MetricCard
            title="訊息分類"
            value={metrics.contamination_rate != null ? `${((1 - metrics.contamination_rate) * 100).toFixed(0)}%` : "-"}
            sub={`${metrics.by_type.classification?.total ?? 0} 已標`}
            color="#2b9348"
          />
          <MetricCard
            title="日報準確"
            value={metrics.daily_report_accuracy != null ? `${(metrics.daily_report_accuracy * 100).toFixed(0)}%` : "-"}
            sub={`${metrics.by_type.daily_report?.total ?? 0} 已標`}
            color="#3498db"
          />
          <MetricCard
            title="記錄準確"
            value={metrics.record_accuracy != null ? `${(metrics.record_accuracy * 100).toFixed(0)}%` : "-"}
            sub={`${metrics.by_type.record?.total ?? 0} 已標`}
            color="#9b59b6"
          />
          <MetricCard title="總 label" value={`${metrics.label_count}`} sub="筆" color="#666" />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #e0e0e0", marginBottom: 20 }}>
        <TabBtn active={tab === "messages"} onClick={() => setTab("messages")}>
          訊息分類 ({result?.messages.length ?? 0})
        </TabBtn>
        <TabBtn active={tab === "daily_reports"} onClick={() => setTab("daily_reports")}>
          日報 ({result?.dailyReports.length ?? 0})
        </TabBtn>
        <TabBtn active={tab === "records"} onClick={() => setTab("records")}>
          事件記錄 ({result?.records.length ?? 0})
        </TabBtn>
      </div>

      {/* Tab content */}
      {tab === "messages" && (
        <div>
          {result?.messages.map((m) => {
            const label = labelIndex.get(`classification:${m.id}`);
            return (
              <div
                key={m.id}
                style={{
                  padding: 12,
                  border: "1px solid #eee",
                  borderLeft: `4px solid ${m.category ? CATEGORY_COLOR[m.category] ?? "#ccc" : "#ccc"}`,
                  borderRadius: 4,
                  marginBottom: 8,
                  background: label ? (label.correct ? "#f0fdf4" : "#fef2f2") : "white",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13, color: "#666" }}>
                  <span style={{ color: "#999" }}>#{m.id}</span>
                  <span>{m.date} {m.time}</span>
                  <b style={{ color: "#333" }}>{m.sender}</b>
                  {m.category && (
                    <span
                      style={{
                        padding: "2px 8px",
                        background: CATEGORY_COLOR[m.category] ?? "#ccc",
                        color: "white",
                        borderRadius: 10,
                        fontSize: 11,
                      }}
                    >
                      {CATEGORY_LABEL[m.category] ?? m.category}
                    </span>
                  )}
                  {m.confidence && (
                    <span
                      style={{
                        padding: "2px 8px",
                        border: `1px solid ${CONFIDENCE_COLOR[m.confidence]}`,
                        color: CONFIDENCE_COLOR[m.confidence],
                        borderRadius: 10,
                        fontSize: 11,
                      }}
                    >
                      信心 {m.confidence}
                    </span>
                  )}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <LabelBtn correct={true} active={label?.correct === true} onClick={() => handleLabel("messages", String(m.id), true)} />
                    <LabelBtn correct={false} active={label?.correct === false} onClick={() => handleLabel("messages", String(m.id), false)} />
                  </div>
                </div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{m.text}</div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "daily_reports" && (
        <div>
          {result?.dailyReports.map((d, idx) => {
            const label = labelIndex.get(`daily_report:${idx}`);
            return (
              <div
                key={idx}
                style={{
                  padding: 16,
                  border: "1px solid #eee",
                  borderLeft: "4px solid #2b9348",
                  borderRadius: 4,
                  marginBottom: 12,
                  background: label ? (label.correct ? "#f0fdf4" : "#fef2f2") : "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 13, color: "#666" }}>
                    #{idx} · {d.date} · <b>{d.reporter_name ?? "-"}</b>
                    {d.reporter_code && <span style={{ marginLeft: 4, color: "#999" }}>({d.reporter_code})</span>}
                    <span style={{ marginLeft: 8, padding: "2px 8px", border: `1px solid ${CONFIDENCE_COLOR[d.confidence]}`, color: CONFIDENCE_COLOR[d.confidence], borderRadius: 10, fontSize: 11 }}>
                      {d.confidence}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <LabelBtn correct={true} active={label?.correct === true} onClick={() => handleLabel("daily_reports", String(idx), true)} />
                    <LabelBtn correct={false} active={label?.correct === false} onClick={() => handleLabel("daily_reports", String(idx), false)} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
                  {d.work_order && (<><b>工單</b><span>{d.work_order}</span></>)}
                  {d.machine_code && (<><b>工位</b><span>{d.machine_code}</span></>)}
                  {d.line && (<><b>產線</b><span>{d.line}</span></>)}
                  {d.output_qty != null && (<><b>產量</b><span>{d.output_qty}</span></>)}
                  {d.defect_qty != null && (<><b>不良</b><span>{d.defect_qty}</span></>)}
                  {d.work_hours != null && (<><b>工時</b><span>{d.work_hours} 小時</span></>)}
                  {d.overtime_hours != null && (<><b>加班</b><span>{d.overtime_hours} 小時</span></>)}
                  {d.issues && (<><b>備註</b><span>{d.issues}</span></>)}
                  <b>來源訊息</b><span style={{ color: "#999", fontSize: 12 }}>#{d.source_ids.join(", #")}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "records" && (
        <div>
          {result?.records.map((r, idx) => {
            const label = labelIndex.get(`record:${idx}`);
            return (
              <div
                key={idx}
                style={{
                  padding: 16,
                  border: "1px solid #eee",
                  borderLeft: `4px solid ${CATEGORY_COLOR[r.category] ?? "#ccc"}`,
                  borderRadius: 4,
                  marginBottom: 12,
                  background: label ? (label.correct ? "#f0fdf4" : "#fef2f2") : "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span
                        style={{
                          padding: "2px 8px",
                          background: CATEGORY_COLOR[r.category] ?? "#ccc",
                          color: "white",
                          borderRadius: 10,
                          fontSize: 11,
                        }}
                      >
                        {CATEGORY_LABEL[r.category] ?? r.category}
                      </span>
                      {r.status && (
                        <span style={{ padding: "2px 8px", background: "#e8e8e8", borderRadius: 10, fontSize: 11 }}>
                          {r.status}
                        </span>
                      )}
                      <span style={{ padding: "2px 8px", border: `1px solid ${CONFIDENCE_COLOR[r.confidence]}`, color: CONFIDENCE_COLOR[r.confidence], borderRadius: 10, fontSize: 11 }}>
                        {r.confidence}
                      </span>
                    </div>
                    <div style={{ fontWeight: 500, fontSize: 15 }}>{r.title}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <LabelBtn correct={true} active={label?.correct === true} onClick={() => handleLabel("records", String(idx), true)} />
                    <LabelBtn correct={false} active={label?.correct === false} onClick={() => handleLabel("records", String(idx), false)} />
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "#333", marginBottom: 8 }}>{r.detail}</div>
                <div style={{ fontSize: 12, color: "#666", display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {r.person && <span>人員：{r.person}</span>}
                  {r.machine_code && <span>工位：{r.machine_code}</span>}
                  {r.work_order && <span>工單：{r.work_order}</span>}
                  <span style={{ color: "#999" }}>來源：#{r.source_ids.join(", #")}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, value, sub, color }: { title: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ padding: 12, background: "white", border: "1px solid #e0e0e0", borderRadius: 4, textAlign: "center" }}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 16px",
        background: "none",
        border: "none",
        borderBottom: active ? "3px solid #0066cc" : "3px solid transparent",
        color: active ? "#0066cc" : "#666",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: active ? 500 : 400,
        marginBottom: -2,
      }}
    >
      {children}
    </button>
  );
}

function LabelBtn({ correct, active, onClick }: { correct: boolean; active: boolean; onClick: () => void }) {
  const bg = active ? (correct ? "#2b9348" : "#c62828") : "white";
  const fg = active ? "white" : correct ? "#2b9348" : "#c62828";
  const border = correct ? "#2b9348" : "#c62828";
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 12px",
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: 4,
        cursor: "pointer",
        fontSize: 12,
      }}
    >
      {correct ? "✓ 正確" : "✗ 錯誤"}
    </button>
  );
}
