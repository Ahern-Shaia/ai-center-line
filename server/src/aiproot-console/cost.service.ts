import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
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
  efficiency: {
    // 全期間效率指標
    totalMessages: number;
    avgCostPerMessage: number;   // 平均每則訊息成本 $
    cacheHitRate: number;        // cacheRead / (input + cacheRead)  · 越高越省
    avgSegmentSize: number;      // messages / calls · 每段平均含幾則訊息
  };
  byTenant: Array<{ tenantId: string | null; tenantName: string; cost: number; tokens: number; calls: number; messages: number; percent: number }>;
  byProvider: Array<{ provider: string; model: string; cost: number; tokens: number; calls: number; percent: number }>;
  byGroup: Array<{ groupId: string; tenantId: string | null; tenantName: string; batches: number; messages: number; cost: number; costPerMessage: number }>;
  trend30d: Array<{ date: string; cost: number; tokens: number }>;
  pricingTable: Array<{ provider: string; model: string; inputPer1M: number; outputPer1M: number; cacheReadPer1M: number; cacheWritePer1M: number }>;
  recentUploads: Array<{
    uploadId: number;
    uploadedAt: string;
    tenantId: string | null;
    tenantName: string;
    source: string;
    groupId: string | null;
    filename: string;
    messageCount: number;
    segmentCount: number;
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    tokens: number;
    calls: number;
    cost: number;
    costPerMessage: number;
    provider: string;
    model: string;
  }>;
}

type UsageRow = {
  upload_id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  uploaded_at: string;
  source: string;
  group_id: string | null;
  filename: string;
  message_count: number | null;
  segment_count: number | null;
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
  private readonly logger = new Logger(CostService.name);

  async getSummary(): Promise<CostSummaryDto> {
    // 用 currentTx() 繼承 aiproot_admin actor_role · 讓 tenants JOIN bypass RLS
    const tx = currentTx();
    const rows = await tx.execute<UsageRow>(sql`
      SELECT a.id::text AS upload_id, a.tenant_id::text AS tenant_id,
             t.tenant_name,
             to_char(a.uploaded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS uploaded_at,
             COALESCE(a.source, 'manual') AS source,
             a.group_id,
             a.filename,
             a.message_count,
             a.segment_count,
             a.usage_stats
      FROM analysis_upload a
      LEFT JOIN tenants t ON t.tenant_id = a.tenant_id
      WHERE a.usage_stats IS NOT NULL
    `);

    // Normalize 每筆
    interface Enriched {
      uploadId: number;
      tenantId: string | null;
      tenantName: string;
      source: string;
      groupId: string | null;
      filename: string;
      provider: string;
      model: string;
      uploadedAt: Date;
      messageCount: number;
      segmentCount: number;
      inputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      outputTokens: number;
      cost: number;
      tokens: number;
      calls: number;
    }
    const enriched: Enriched[] = rows.rows.map((r) => {
      let stats: NonNullable<UsageRow["usage_stats"]> = {};
      if (r.usage_stats && typeof r.usage_stats === "object") {
        stats = r.usage_stats;
      } else if (typeof r.usage_stats === "string") {
        try { stats = JSON.parse(r.usage_stats); } catch { stats = {}; }
      }
      const inputTokens = Number(stats.inputTokens ?? 0) || 0;
      const outputTokens = Number(stats.outputTokens ?? 0) || 0;
      const cacheReadTokens = Number(stats.cacheReadTokens ?? 0) || 0;
      const cacheWriteTokens = Number(stats.cacheWriteTokens ?? 0) || 0;
      const calls = Number(stats.calls ?? 1) || 1;
      const provider = typeof stats.provider === "string" ? stats.provider : "anthropic";
      const model = typeof stats.model === "string" ? stats.model : "claude-opus-4-7";
      const pricing = lookupPricing(provider, model);
      const cost = computeCost({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }, pricing);
      const tokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
      let uploadedAt: Date;
      try {
        uploadedAt = new Date(r.uploaded_at);
        if (isNaN(uploadedAt.getTime())) uploadedAt = new Date();
      } catch { uploadedAt = new Date(); }
      return {
        uploadId: parseInt(r.upload_id, 10),
        tenantId: r.tenant_id,
        tenantName: r.tenant_name ?? "（未指派租戶）",
        source: r.source ?? "manual",
        groupId: r.group_id ?? null,
        filename: r.filename ?? "",
        provider,
        model,
        uploadedAt,
        messageCount: r.message_count ?? 0,
        segmentCount: r.segment_count ?? 0,
        inputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        outputTokens,
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

    // Efficiency 指標（全期間）
    const totalMessages = enriched.reduce((s, x) => s + x.messageCount, 0);
    const totalCalls = enriched.reduce((s, x) => s + x.calls, 0);
    const totalInput = enriched.reduce((s, x) => s + x.inputTokens, 0);
    const totalCacheRead = enriched.reduce((s, x) => s + x.cacheReadTokens, 0);
    const efficiency = {
      totalMessages,
      avgCostPerMessage: totalMessages > 0 ? round6(totals.all.cost / totalMessages) : 0,
      cacheHitRate: totalInput + totalCacheRead > 0
        ? round4(totalCacheRead / (totalInput + totalCacheRead))
        : 0,
      avgSegmentSize: totalCalls > 0 ? round2(totalMessages / totalCalls) : 0,
    };

    // By tenant · +messages
    const tenantMap = new Map<string, {
      tenantId: string | null; tenantName: string;
      cost: number; tokens: number; calls: number; messages: number;
    }>();
    for (const e of enriched) {
      const key = e.tenantId ?? "__null__";
      const cur = tenantMap.get(key) ?? { tenantId: e.tenantId, tenantName: e.tenantName, cost: 0, tokens: 0, calls: 0, messages: 0 };
      cur.cost += e.cost; cur.tokens += e.tokens; cur.calls += e.calls; cur.messages += e.messageCount;
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

    // By group (webhook batch 才有 group_id · manual = null skip)
    const groupMap = new Map<string, {
      groupId: string; tenantId: string | null; tenantName: string;
      batches: number; messages: number; cost: number;
    }>();
    for (const e of enriched) {
      if (!e.groupId) continue;
      const key = `${e.tenantId ?? ""}::${e.groupId}`;
      const cur = groupMap.get(key) ?? {
        groupId: e.groupId, tenantId: e.tenantId, tenantName: e.tenantName,
        batches: 0, messages: 0, cost: 0,
      };
      cur.batches += 1; cur.messages += e.messageCount; cur.cost += e.cost;
      groupMap.set(key, cur);
    }
    const byGroup = Array.from(groupMap.values())
      .map((r) => ({
        ...r,
        cost: round4(r.cost),
        costPerMessage: r.messages > 0 ? round6(r.cost / r.messages) : 0,
      }))
      .sort((a, b) => b.cost - a.cost);

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

    // Recent uploads · 依 uploadedAt desc · top 30
    const recentUploads = enriched
      .slice()
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
      .slice(0, 30)
      .map((e) => ({
        uploadId: e.uploadId,
        uploadedAt: e.uploadedAt.toISOString(),
        tenantId: e.tenantId,
        tenantName: e.tenantName,
        source: e.source,
        groupId: e.groupId,
        filename: e.filename,
        messageCount: e.messageCount,
        segmentCount: e.segmentCount,
        inputTokens: e.inputTokens,
        cacheReadTokens: e.cacheReadTokens,
        outputTokens: e.outputTokens,
        tokens: e.tokens,
        calls: e.calls,
        cost: round4(e.cost),
        costPerMessage: e.messageCount > 0 ? round6(e.cost / e.messageCount) : 0,
        provider: e.provider,
        model: e.model,
      }));

    return {
      totals,
      efficiency,
      byTenant,
      byProvider,
      byGroup,
      trend30d,
      pricingTable: PRICING.map((p) => ({
        provider: p.provider,
        model: p.model,
        inputPer1M: p.inputPer1M,
        outputPer1M: p.outputPer1M,
        cacheReadPer1M: p.cacheReadPer1M,
        cacheWritePer1M: p.cacheWritePer1M,
      })),
      recentUploads,
    };
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
function round6(n: number): number { return Math.round(n * 1000000) / 1000000; }
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
