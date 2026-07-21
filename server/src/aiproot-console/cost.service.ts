import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withAuthLookup } from "../db/client.js";
import { PRICING, computeCost, lookupPricing } from "./llm-pricing.js";

// AI 成本管理 · 依對話分析 analysis_upload.usage_stats 聚合
// usage_stats JSON 應含 {calls, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, provider?, model?}
// 若缺 provider/model · fallback 預設 pricing (anthropic:claude-opus-4-7)

export interface CostSummaryDto {
  totals: {
    today: { cost: number; tokens: number; calls: number };
    month: { cost: number; tokens: number; calls: number };
    all:   { cost: number; tokens: number; calls: number };
  };
  byTenant: Array<{ tenantId: string | null; tenantName: string; cost: number; tokens: number; calls: number; percent: number }>;
  byProvider: Array<{ provider: string; model: string; cost: number; tokens: number; calls: number; percent: number }>;
  trend30d: Array<{ date: string; cost: number; tokens: number }>;
  pricingTable: Array<{ provider: string; model: string; inputPer1M: number; outputPer1M: number; cacheReadPer1M: number; cacheWritePer1M: number }>;
}

type UsageRow = {
  upload_id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  uploaded_at: string;
  usage_stats: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    calls?: number;
    provider?: string;
    model?: string;
  } | null;
  [k: string]: unknown;
};

@Injectable()
export class CostService {
  async getSummary(): Promise<CostSummaryDto> {
    // 拉 analysis_upload · 只要有 usage_stats 的 · JOIN tenant 顯示名
    // withAuthLookup 繞 tenant RLS (aiproot 需跨所有 tenant)
    const rows = await withAuthLookup((tx) => tx.execute<UsageRow>(sql`
      SELECT a.id AS upload_id, a.tenant_id, t.tenant_name, a.uploaded_at::text, a.usage_stats
      FROM analysis_upload a
      LEFT JOIN tenants t ON t.tenant_id = a.tenant_id
      WHERE a.usage_stats IS NOT NULL
    `));

    // Normalize 每筆
    interface Enriched {
      tenantId: string | null;
      tenantName: string;
      provider: string;
      model: string;
      uploadedAt: Date;
      cost: number;
      tokens: number;
      calls: number;
    }
    const enriched: Enriched[] = rows.rows.map((r) => {
      const stats = r.usage_stats ?? {};
      const inputTokens = stats.inputTokens ?? 0;
      const outputTokens = stats.outputTokens ?? 0;
      const cacheReadTokens = stats.cacheReadTokens ?? 0;
      const cacheWriteTokens = stats.cacheWriteTokens ?? 0;
      const calls = stats.calls ?? 1;
      const provider = stats.provider ?? "anthropic";
      const model = stats.model ?? "claude-opus-4-7";
      const pricing = lookupPricing(provider, model);
      const cost = computeCost({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }, pricing);
      const tokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
      return {
        tenantId: r.tenant_id,
        tenantName: r.tenant_name ?? "（未指派租戶）",
        provider,
        model,
        uploadedAt: new Date(r.uploaded_at),
        cost,
        tokens,
        calls,
      };
    });

    // Totals · today / month / all
    const now = new Date();
    const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const isSince = (d: Date) => (r: Enriched) => r.uploadedAt >= d;
    const agg = (items: Enriched[]) => ({
      cost: round4(items.reduce((s, x) => s + x.cost, 0)),
      tokens: items.reduce((s, x) => s + x.tokens, 0),
      calls: items.reduce((s, x) => s + x.calls, 0),
    });
    const totals = {
      today: agg(enriched.filter(isSince(startToday))),
      month: agg(enriched.filter(isSince(startMonth))),
      all: agg(enriched),
    };

    // By tenant
    const tenantMap = new Map<string, { tenantId: string | null; tenantName: string; cost: number; tokens: number; calls: number }>();
    for (const e of enriched) {
      const key = e.tenantId ?? "__null__";
      const cur = tenantMap.get(key) ?? { tenantId: e.tenantId, tenantName: e.tenantName, cost: 0, tokens: 0, calls: 0 };
      cur.cost += e.cost;
      cur.tokens += e.tokens;
      cur.calls += e.calls;
      tenantMap.set(key, cur);
    }
    const byTenant = Array.from(tenantMap.values())
      .map((r) => ({ ...r, cost: round4(r.cost) }))
      .sort((a, b) => b.cost - a.cost)
      .map((r) => ({ ...r, percent: totals.all.cost > 0 ? Math.round((r.cost / totals.all.cost) * 100) : 0 }));

    // By provider (+ model)
    const provMap = new Map<string, { provider: string; model: string; cost: number; tokens: number; calls: number }>();
    for (const e of enriched) {
      const key = `${e.provider}:${e.model}`;
      const cur = provMap.get(key) ?? { provider: e.provider, model: e.model, cost: 0, tokens: 0, calls: 0 };
      cur.cost += e.cost; cur.tokens += e.tokens; cur.calls += e.calls;
      provMap.set(key, cur);
    }
    const byProvider = Array.from(provMap.values())
      .map((r) => ({ ...r, cost: round4(r.cost) }))
      .sort((a, b) => b.cost - a.cost)
      .map((r) => ({ ...r, percent: totals.all.cost > 0 ? Math.round((r.cost / totals.all.cost) * 100) : 0 }));

    // 30d trend · 依日 bucket
    const trendMap = new Map<string, { cost: number; tokens: number }>();
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 29); cutoff.setHours(0, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      const d = new Date(cutoff); d.setDate(d.getDate() + i);
      trendMap.set(fmtDate(d), { cost: 0, tokens: 0 });
    }
    for (const e of enriched) {
      if (e.uploadedAt < cutoff) continue;
      const day = fmtDate(e.uploadedAt);
      const cur = trendMap.get(day);
      if (cur) { cur.cost += e.cost; cur.tokens += e.tokens; }
    }
    const trend30d = Array.from(trendMap.entries()).map(([date, v]) => ({ date, cost: round4(v.cost), tokens: v.tokens }));

    return {
      totals,
      byTenant,
      byProvider,
      trend30d,
      pricingTable: PRICING.map((p) => ({
        provider: p.provider,
        model: p.model,
        inputPer1M: p.inputPer1M,
        outputPer1M: p.outputPer1M,
        cacheReadPer1M: p.cacheReadPer1M,
        cacheWritePer1M: p.cacheWritePer1M,
      })),
    };
  }
}

function round4(n: number): number { return Math.round(n * 10000) / 10000; }
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
