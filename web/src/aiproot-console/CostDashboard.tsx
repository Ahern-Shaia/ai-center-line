import Spinner from "../shared/Spinner";
import { useEffect, useState } from "react";
import { getCostSummary, ApiError, type CostSummaryDto } from "../api";
import { useToast } from "../Toast";

// AI 成本管理儀表 · aiproot 專屬 · 依 analysis_upload.usage_stats 聚合
interface Props {
  onOpenAnalysis?: (uploadId: number) => void;
}
export default function CostDashboard({ onOpenAnalysis }: Props = {}) {
  const toast = useToast();
  const [data, setData] = useState<CostSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCostSummary()
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          toast.show(err instanceof ApiError ? err.message : "載入成本資料失敗", "danger");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [toast]);

  if (loading) {
    return <div className="pane"><Spinner block /></div>;
  }
  if (!data) {
    return <div className="pane"><div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>暫無資料</div></div>;
  }

  const maxTrend = Math.max(...data.trend30d.map((d) => d.cost), 0.0001);

  return (
    <div className="pane cost-wrap">
      <div className="pane-hdr">
        <div>
          <h1>AI 成本管理</h1>
          <div className="sub">依對話分析 usage_stats 聚合 · pricing 依模型 official 公告 (2026-07)</div>
        </div>
      </div>

      {/* 總量卡 */}
      <div className="cost-totals">
        <TotalCard label="今日" cost={data.totals.today.cost} tokens={data.totals.today.tokens} calls={data.totals.today.calls} accent="primary" />
        <TotalCard label="本月" cost={data.totals.month.cost} tokens={data.totals.month.tokens} calls={data.totals.month.calls} />
        <TotalCard label="累計" cost={data.totals.all.cost} tokens={data.totals.all.tokens} calls={data.totals.all.calls} />
      </div>

      {/* 效率指標 tile (B) */}
      <section className="cost-section">
        <div className="cost-section-hdr">
          <div className="cost-section-title">效率指標</div>
          <div className="cost-section-mark">全期間 · {data.efficiency.totalMessages.toLocaleString()} 則訊息</div>
        </div>
        <div className="cost-totals">
          <MetricCard
            label="平均每則訊息成本"
            value={`$${data.efficiency.avgCostPerMessage.toFixed(6)}`}
            sub={`累計 ${data.efficiency.totalMessages.toLocaleString()} 則 ÷ $${data.totals.all.cost.toFixed(4)}`}
          />
          <MetricCard
            label="快取命中率"
            value={`${(data.efficiency.cacheHitRate * 100).toFixed(1)}%`}
            sub={data.efficiency.cacheHitRate > 0.5 ? "省很兇 · 大部分命中快取" : data.efficiency.cacheHitRate > 0.2 ? "還可以 · 尚有空間" : "低 · 每次幾乎全新輸入"}
          />
          <MetricCard
            label="平均段長"
            value={`${data.efficiency.avgSegmentSize.toFixed(2)} 則`}
            sub="每次 API call 平均含幾則訊息"
          />
        </div>
      </section>

      {/* 30 天走勢 */}
      <section className="cost-section">
        <div className="cost-section-hdr">
          <div className="cost-section-title">30 天走勢</div>
          <div className="cost-section-mark">日花費 US$</div>
        </div>
        <div className="cost-trend">
          {data.trend30d.map((d, i) => (
            <div key={d.date} className="cost-bar-wrap" title={`${d.date} · $${d.cost.toFixed(4)} · ${d.tokens} tok`}>
              <div className="cost-bar" style={{ height: `${Math.max((d.cost / maxTrend) * 100, 2)}%` }} />
              {(i === 0 || i === data.trend30d.length - 1 || i === Math.floor(data.trend30d.length / 2)) && (
                <div className="cost-bar-lbl">{d.date.slice(5)}</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 按租戶 */}
      <section className="cost-section">
        <div className="cost-section-hdr">
          <div className="cost-section-title">按租戶</div>
          <div className="cost-section-mark">{data.byTenant.length} 家</div>
        </div>
        {data.byTenant.length === 0 ? (
          <div className="cost-empty">尚無分析資料 · 使用「AI 對話分析 → 上傳新對話」後會出現</div>
        ) : (
          <table className="cost-tbl">
            <thead>
              <tr>
                <th>租戶</th>
                <th className="num">花費 US$</th>
                <th className="num">Tokens</th>
                <th className="num">訊息數</th>
                <th className="num">呼叫次數</th>
                <th>占比</th>
              </tr>
            </thead>
            <tbody>
              {data.byTenant.map((r) => (
                <tr key={r.tenantId ?? r.tenantName}>
                  <td>{r.tenantName}</td>
                  <td className="num mono">${r.cost.toFixed(4)}</td>
                  <td className="num mono">{r.tokens.toLocaleString()}</td>
                  <td className="num mono">{r.messages.toLocaleString()}</td>
                  <td className="num mono">{r.calls.toLocaleString()}</td>
                  <td className="cost-pct-cell">
                    <div className="cost-pct-bar"><div className="cost-pct-fill" style={{ width: `${r.percent}%` }} /></div>
                    <span className="cost-pct-txt">{r.percent}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 按供應商 */}
      <section className="cost-section">
        <div className="cost-section-hdr">
          <div className="cost-section-title">按供應商 / 模型</div>
          <div className="cost-section-mark">{data.byProvider.length} 組</div>
        </div>
        {data.byProvider.length === 0 ? (
          <div className="cost-empty">尚無資料</div>
        ) : (
          <table className="cost-tbl">
            <thead>
              <tr>
                <th>供應商 / 模型</th>
                <th className="num">花費 US$</th>
                <th className="num">Tokens</th>
                <th className="num">呼叫次數</th>
                <th>占比</th>
              </tr>
            </thead>
            <tbody>
              {data.byProvider.map((r) => (
                <tr key={`${r.provider}:${r.model}`}>
                  <td><b>{r.provider}</b> <span className="cost-model">{r.model}</span></td>
                  <td className="num mono">${r.cost.toFixed(4)}</td>
                  <td className="num mono">{r.tokens.toLocaleString()}</td>
                  <td className="num mono">{r.calls.toLocaleString()}</td>
                  <td className="cost-pct-cell">
                    <div className="cost-pct-bar"><div className="cost-pct-fill" style={{ width: `${r.percent}%` }} /></div>
                    <span className="cost-pct-txt">{r.percent}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 按群組 (C · 只 webhook batch) */}
      {data.byGroup.length > 0 && (
        <section className="cost-section">
          <div className="cost-section-hdr">
            <div className="cost-section-title">按 LINE 群組</div>
            <div className="cost-section-mark">{data.byGroup.length} 個群 · 只含 webhook batch</div>
          </div>
          <table className="cost-tbl">
            <thead>
              <tr>
                <th>租戶</th>
                <th>群組</th>
                <th className="num">批次數</th>
                <th className="num">訊息數</th>
                <th className="num">總花費</th>
                <th className="num">每則 $</th>
              </tr>
            </thead>
            <tbody>
              {data.byGroup.slice(0, 30).map((r) => (
                <tr key={`${r.tenantId}::${r.groupId}`}>
                  <td>{r.tenantName}</td>
                  <td className="mono" title={r.groupId}>{r.groupId.slice(0, 14)}…</td>
                  <td className="num mono">{r.batches.toLocaleString()}</td>
                  <td className="num mono">{r.messages.toLocaleString()}</td>
                  <td className="num mono">${r.cost.toFixed(4)}</td>
                  <td className="num mono">${r.costPerMessage.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* 對話明細 (A · Top 30 recent uploads) */}
      {data.recentUploads.length > 0 && (
        <section className="cost-section">
          <div className="cost-section-hdr">
            <div className="cost-section-title">對話明細 · 近 30 筆</div>
            <div className="cost-section-mark">點「查看」跳分析詳情</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="cost-tbl">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>租戶</th>
                  <th>來源</th>
                  <th>檔名 / Group</th>
                  <th className="num">訊息數</th>
                  <th className="num">段數</th>
                  <th className="num">Input</th>
                  <th className="num">Cache</th>
                  <th className="num">Output</th>
                  <th className="num">$</th>
                  <th className="num">每則 $</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.recentUploads.map((r) => (
                  <tr key={r.uploadId}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {new Date(r.uploadedAt).toLocaleString("zh-TW", {
                        hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                    <td>{r.tenantName}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{r.source}</td>
                    <td className="mono" title={r.filename}>
                      {r.filename.length > 24 ? r.filename.slice(0, 24) + "…" : r.filename}
                    </td>
                    <td className="num mono">{r.messageCount.toLocaleString()}</td>
                    <td className="num mono">{r.segmentCount.toLocaleString()}</td>
                    <td className="num mono">{r.inputTokens.toLocaleString()}</td>
                    <td className="num mono">{r.cacheReadTokens.toLocaleString()}</td>
                    <td className="num mono">{r.outputTokens.toLocaleString()}</td>
                    <td className="num mono">${r.cost.toFixed(4)}</td>
                    <td className="num mono">${r.costPerMessage.toFixed(6)}</td>
                    <td>
                      {onOpenAnalysis && (
                        <button className="btn small" onClick={() => onOpenAnalysis(r.uploadId)}>查看</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pricing 參考表 */}
      <section className="cost-section">
        <div className="cost-section-hdr">
          <div className="cost-section-title">定價參考表</div>
          <div className="cost-section-mark">USD / 每百萬 tokens · 各家官方 2026-07 公告</div>
        </div>
        <table className="cost-tbl">
          <thead>
            <tr>
              <th>供應商</th>
              <th>模型</th>
              <th className="num">Input</th>
              <th className="num">Output</th>
              <th className="num">Cache Read</th>
              <th className="num">Cache Write</th>
            </tr>
          </thead>
          <tbody>
            {data.pricingTable.map((p) => (
              <tr key={`${p.provider}:${p.model}`}>
                <td><b>{p.provider}</b></td>
                <td className="mono">{p.model}</td>
                <td className="num mono">${p.inputPer1M}</td>
                <td className="num mono">${p.outputPer1M}</td>
                <td className="num mono">${p.cacheReadPer1M}</td>
                <td className="num mono">${p.cacheWritePer1M}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function TotalCard({ label, cost, tokens, calls, accent }: {
  label: string;
  cost: number;
  tokens: number;
  calls: number;
  accent?: "primary";
}) {
  return (
    <div className={`cost-total-card${accent ? " cost-total-card--primary" : ""}`}>
      <div className="cost-total-lbl">{label}</div>
      <div className="cost-total-val">${cost.toFixed(4)}</div>
      <div className="cost-total-sub">
        <span>{tokens.toLocaleString()} tokens</span>
        <span>·</span>
        <span>{calls.toLocaleString()} 呼叫</span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="cost-total-card">
      <div className="cost-total-lbl">{label}</div>
      <div className="cost-total-val" style={{ fontSize: 22 }}>{value}</div>
      <div className="cost-total-sub" style={{ fontSize: 11, color: "var(--ink-3)" }}>{sub}</div>
    </div>
  );
}
