import Spinner from "../shared/Spinner";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getConvoUpload,
  getConvoMetrics,
  createConvoLabel,
  type ConvoUploadDetail,
  type ConvoMetrics,
  type ConvoLabel,
  type ConvoMessage,
  ApiError,
} from "../api";
import { useToast } from "../Toast";
import { statusLabel } from "../shared/recordStatusLabel";

interface Props {
  uploadId: number;
  onBack: () => void;
}

// 分類語意 · muted CSS class 對應
const CAT_META: Record<string, { label: string; cls: string; rec: string }> = {
  daily_report: { label: "報工日報", cls: "cat-daily",    rec: "rec-daily" },
  maintenance:  { label: "維保異常", cls: "cat-maint",    rec: "rec-maint" },
  attendance:   { label: "出勤異動", cls: "cat-attend",   rec: "rec-attend" },
  rnd:          { label: "研發討論", cls: "cat-rd",       rec: "rec-rd" },
  procurement:  { label: "採購",     cls: "cat-purchase", rec: "rec-purchase" },
  chitchat:     { label: "閒聊",     cls: "cat-chat",     rec: "rec-chat" },
};

const CAT_ORDER = ["daily_report", "maintenance", "procurement", "rnd", "attendance", "chitchat"];



export default function ConversationAnalysisDetail({ uploadId, onBack }: Props) {
  const [detail, setDetail] = useState<ConvoUploadDetail | null>(null);
  const [metrics, setMetrics] = useState<ConvoMetrics | null>(null);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const fetchAll = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([
        getConvoUpload(uploadId),
        getConvoMetrics(uploadId).catch(() => null),
      ]);
      setDetail(d);
      setMetrics(m);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
    } finally {
      setLoading(false);
    }
  }, [uploadId, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const labelIndex = useMemo(() => {
    const m = new Map<string, ConvoLabel>();
    for (const l of detail?.labels ?? []) m.set(`${l.targetType}:${l.targetId}`, l);
    return m;
  }, [detail]);

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of detail?.result?.messages ?? []) {
      if (m.category) counts[m.category] = (counts[m.category] ?? 0) + 1;
    }
    return counts;
  }, [detail]);

  async function handleLabel(targetType: ConvoLabel["targetType"], targetId: string, correct: boolean) {
    try {
      await createConvoLabel({ uploadId, targetType, targetId, correct });
      toast.show(`已標記為${correct ? "正確" : "錯誤"}`, "ok");
      await fetchAll();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "標記失敗", "danger");
    }
  }

  if (loading) {
    return <div className="pane"><Spinner block /></div>;
  }
  if (!detail) {
    return <div className="pane"><div style={{ padding: 40, textAlign: "center", color: "var(--cat-maint)" }}>找不到資料</div></div>;
  }

  const { upload, result } = detail;
  const messages = result?.messages ?? [];
  const dailyReports = result?.dailyReports ?? [];
  const records = result?.records ?? [];
  const filteredMessages = filterCat ? messages.filter((m) => m.category === filterCat) : messages;
  const messagesByDate = groupMessagesByDate(filteredMessages);
  const classifiedCount = messages.filter((m) => m.category != null).length;
  const coveragePct = messages.length > 0 ? Math.round((classifiedCount / messages.length) * 100) : 0;

  return (
    <div className="pane">
      {/* Header */}
      <div className="detail-hdr">
        <button className="detail-back" onClick={onBack}>← 返回列表</button>
        <h1>{upload.filename}</h1>
        <div className="detail-hdr-meta">
          <span>#{upload.id}</span>
          <span>{upload.tenantSlug}</span>
          <span>{messages.length} 訊息</span>
          <span>{dailyReports.length} 結構化日報</span>
          <span>{records.length} 事件記錄</span>
          <span>上傳於 {new Date(upload.uploadedAt).toLocaleString("zh-TW", { hour12: false })}</span>
        </div>

        {/* Coverage bar */}
        <div className="detail-cov">
          <span className="detail-cov-lbl">訊息分類覆蓋</span>
          <div className="detail-cov-bar">
            <div className="detail-cov-fill" style={{ width: `${coveragePct}%` }} />
          </div>
          <span className="detail-cov-lbl"><b>{classifiedCount}</b> / {messages.length} · {coveragePct}%</span>
        </div>

        {/* Category chip strip */}
        <div className="detail-chips" role="tablist">
          <button
            className={`detail-chip${filterCat === null ? " active" : ""}`}
            style={filterCat === null ? undefined : { borderColor: "var(--line)", color: "var(--ink-2)" }}
            onClick={() => setFilterCat(null)}
          >
            全部
            <span className="detail-chip-count">{messages.length}</span>
          </button>
          {CAT_ORDER.filter((c) => catCounts[c]).map((c) => {
            const meta = CAT_META[c];
            const active = filterCat === c;
            const catColor = `var(--${meta.cls})`;
            return (
              <button
                key={c}
                className={`detail-chip${active ? " active" : ""}`}
                style={active ? undefined : { borderColor: catColor, color: catColor }}
                onClick={() => setFilterCat(active ? null : c)}
              >
                {meta.label}
                <span className="detail-chip-count">{catCounts[c]}</span>
              </button>
            );
          })}
        </div>

        {/* Metrics strip · 4 tile · 一行式 */}
        {metrics && metrics.label_count > 0 && (
          <div className="detail-metrics">
            <MetricTile label="分類正確率"
              value={metrics.contamination_rate != null ? `${((1 - metrics.contamination_rate) * 100).toFixed(0)}` : "—"}
              unit={metrics.contamination_rate != null ? "%" : ""}
              sub={`已標 ${metrics.by_type.classification?.total ?? 0} 則`}
            />
            <MetricTile label="日報準確率"
              value={metrics.daily_report_accuracy != null ? `${(metrics.daily_report_accuracy * 100).toFixed(0)}` : "—"}
              unit={metrics.daily_report_accuracy != null ? "%" : ""}
              sub={`已標 ${metrics.by_type.daily_report?.total ?? 0} 筆`}
            />
            <MetricTile label="記錄準確率"
              value={metrics.record_accuracy != null ? `${(metrics.record_accuracy * 100).toFixed(0)}` : "—"}
              unit={metrics.record_accuracy != null ? "%" : ""}
              sub={`已標 ${metrics.by_type.record?.total ?? 0} 筆`}
            />
            <MetricTile label="總標註"
              value={`${metrics.label_count}`}
              unit="筆"
              sub="人工回饋"
            />
          </div>
        )}
      </div>

      {/* §1 結構化報工日報 */}
      {dailyReports.length > 0 && (
        <section className="detail-sec">
          <div className="detail-sec-hdr">
            <div className="detail-sec-title">
              結構化報工日報
              <span className="detail-sec-title-mark">→ 報工表單</span>
            </div>
            <div className="detail-sec-count">{dailyReports.length} 筆 · 高信心 {dailyReports.filter((d) => d.confidence === "high").length}</div>
          </div>
          <table className="detail-tbl">
            <thead>
              <tr>
                <th>日期</th>
                <th>回報人</th>
                <th>工單</th>
                <th>機台</th>
                <th>備註 / 異常</th>
                <th className="num">工時</th>
                <th>信心</th>
                <th>來源</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dailyReports.map((d, idx) => {
                const label = labelIndex.get(`daily_report:${idx}`);
                return (
                  <tr key={idx}>
                    <td className="mono">{d.date ?? <span className="null">—</span>}</td>
                    <td>
                      {d.reporter_name ?? <span className="null">—</span>}
                      {d.reporter_code && <span className="detail-personcode">{d.reporter_code}</span>}
                    </td>
                    <td className="mono">{d.work_order ?? <span className="null">—</span>}</td>
                    <td className="mono">{d.machine_code ?? <span className="null">—</span>}</td>
                    <td>{d.issues ?? <span className="null">—</span>}</td>
                    <td className="num">{d.work_hours != null ? d.work_hours : <span className="null">—</span>}</td>
                    <td><ConfPill c={d.confidence} /></td>
                    <td className="src">#{d.source_ids.join(", #")}</td>
                    <td className="actions">
                      <LabelToggle
                        active={label != null}
                        correct={label?.correct}
                        onCorrect={() => handleLabel("daily_report", String(idx), true)}
                        onWrong={() => handleLabel("daily_report", String(idx), false)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* §2 事件記錄 */}
      {records.length > 0 && (
        <section className="detail-sec">
          <div className="detail-sec-hdr">
            <div className="detail-sec-title">
              事件記錄
              <span className="detail-sec-title-mark">→ 待辦 / 知識庫</span>
            </div>
            <div className="detail-sec-count">{records.length} 筆</div>
          </div>
          <div className="detail-records">
            {records.map((r, idx) => {
              const meta = CAT_META[r.category] ?? { label: r.category, cls: "cat-chat", rec: "rec-chat" };
              const label = labelIndex.get(`record:${idx}`);
              return (
                <div key={idx} className={`detail-record ${meta.rec}`}>
                  <div className="detail-record-head">
                    <span className={`cat ${meta.cls}`}>{meta.label}</span>
                    {r.status && <span className={`stat stat-${r.status}`}>{statusLabel(r.status)}</span>}
                    <ConfPill c={r.confidence} />
                    <div style={{ marginLeft: "auto" }}>
                      <LabelToggle
                        active={label != null}
                        correct={label?.correct}
                        onCorrect={() => handleLabel("record", String(idx), true)}
                        onWrong={() => handleLabel("record", String(idx), false)}
                      />
                    </div>
                  </div>
                  <div className="detail-record-title">{r.title}</div>
                  <div className="detail-record-body">{r.detail}</div>
                  <div className="detail-record-foot">
                    {r.person && <span><b>人員</b>{r.person}</span>}
                    {r.machine_code && <span><b>機台</b>{r.machine_code}</span>}
                    {r.work_order && <span><b>工單</b>{r.work_order}</span>}
                    <span className="src">來源 #{r.source_ids.join(", #")}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* §3 訊息時間軸 */}
      <section className="detail-sec">
        <div className="detail-sec-hdr">
          <div className="detail-sec-title">
            訊息時間軸
            {filterCat && <span className="detail-sec-title-mark">已篩選：{CAT_META[filterCat]?.label ?? filterCat}</span>}
          </div>
          <div className="detail-sec-count">
            {filteredMessages.length} / {messages.length} 則
          </div>
        </div>
        <div className="detail-timeline">
          {messagesByDate.map(([date, msgs]) => (
            <div key={date}>
              <div className="detail-time-daterow">
                <span>{date}</span>
                <div className="detail-time-daterow-hairline" />
                <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>{msgs.length} 則</span>
              </div>
              {msgs.map((m) => {
                const meta = m.category ? CAT_META[m.category] : null;
                const label = labelIndex.get(`classification:${m.id}`);
                const isLowConf = m.confidence === "low";
                return (
                  <div key={m.id} className={`detail-time-row${isLowConf ? " contaminated" : ""}`}>
                    <div className="detail-time-time">{m.time}</div>
                    <div className="detail-time-sender">{m.sender}</div>
                    <div className="detail-time-text">
                      {m.kind === "media" ? <span className="media">{m.text}</span> : m.text}
                    </div>
                    <div className="detail-time-cat">
                      {meta ? (
                        <>
                          <span className={`cat ${meta.cls}`}>{meta.label}</span>
                          {m.confidence && m.confidence !== "high" && (
                            <ConfPill c={m.confidence} />
                          )}
                        </>
                      ) : (
                        <span className="src">未分類</span>
                      )}
                      <LabelToggle
                        active={label != null}
                        correct={label?.correct}
                        onCorrect={() => handleLabel("classification", String(m.id), true)}
                        onWrong={() => handleLabel("classification", String(m.id), false)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MetricTile({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="detail-metric">
      <div className="detail-metric-lbl">{label}</div>
      <div className="detail-metric-val">{value}{unit && <span className="u">{unit}</span>}</div>
      {sub && <div className="detail-metric-sub">{sub}</div>}
    </div>
  );
}

function ConfPill({ c }: { c: "high" | "medium" | "low" | null | undefined }) {
  if (!c) return null;
  const label = c === "high" ? "高信心" : c === "medium" ? "中信心" : "低信心";
  return <span className={`conf conf-${c}`}>{label}</span>;
}

function LabelToggle({
  active,
  correct,
  onCorrect,
  onWrong,
}: {
  active: boolean;
  correct: boolean | undefined;
  onCorrect: () => void;
  onWrong: () => void;
}) {
  return (
    <div className={`detail-lbl${active ? " active" : ""}`}>
      <button
        className={`detail-lbl-btn correct${correct === true ? " on" : ""}`}
        onClick={onCorrect}
        title="標記為正確"
      >
        正確
      </button>
      <button
        className={`detail-lbl-btn wrong${correct === false ? " on" : ""}`}
        onClick={onWrong}
        title="標記為錯誤"
      >
        錯誤
      </button>
    </div>
  );
}

function groupMessagesByDate(messages: ConvoMessage[]): [string, ConvoMessage[]][] {
  const byDate = new Map<string, ConvoMessage[]>();
  for (const m of messages) {
    const arr = byDate.get(m.date) ?? [];
    arr.push(m);
    byDate.set(m.date, arr);
  }
  return Array.from(byDate.entries());
}
