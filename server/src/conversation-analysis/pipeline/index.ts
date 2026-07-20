// runPipeline · pilot backend orchestration
// LINE 匯出檔 raw text → parser → segments → analyzeSegment × N → 匯總 result
import Anthropic from "@anthropic-ai/sdk";
import { parseLineExport, segmentMessages, type ChatMessage } from "./parser.js";
import { analyzeSegment, addUsage, emptyUsage, type UsageStats } from "./classify.js";
import { TWH_TENANT, type Tenant } from "./tenant-twh.js";
import type { AnalysisResultT, Category } from "./schemas.js";

export type EnrichedMessage = ChatMessage & {
  category: Category | null;
  confidence: string | null;
};

export interface PipelineResult {
  groupName: string;
  messages: EnrichedMessage[];
  dailyReports: AnalysisResultT["daily_reports"];
  records: AnalysisResultT["records"];
  messageCount: number;
  segmentCount: number;
  usage: UsageStats;
}

// 目前 pilot 只支援 twh · M6 才擴 tenant registry
export function resolveTenant(slug: string): Tenant {
  if (slug === "twh") return TWH_TENANT;
  throw new Error(`unknown tenant slug: ${slug}（pilot 階段只支援 twh · M6 才擴充）`);
}

export async function runPipeline(
  rawText: string,
  tenantSlug: string,
  client: Anthropic = new Anthropic(),
): Promise<PipelineResult> {
  const tenant = resolveTenant(tenantSlug);
  const { groupName, messages } = parseLineExport(rawText);
  const segments = segmentMessages(messages);

  const catMap = new Map<number, { category: Category; confidence: string }>();
  const dailyReports: AnalysisResultT["daily_reports"] = [];
  const records: AnalysisResultT["records"] = [];
  const usage = emptyUsage();

  for (const seg of segments) {
    const { result, usage: u } = await analyzeSegment(client, groupName, seg, tenant);
    for (const c of result.classifications) {
      catMap.set(c.id, { category: c.category, confidence: c.confidence });
    }
    dailyReports.push(...result.daily_reports);
    records.push(...result.records);
    addUsage(usage, u);
  }

  const enriched: EnrichedMessage[] = messages.map((m) => ({
    ...m,
    category: catMap.get(m.id)?.category ?? null,
    confidence: catMap.get(m.id)?.confidence ?? null,
  }));

  return {
    groupName,
    messages: enriched,
    dailyReports,
    records,
    messageCount: messages.length,
    segmentCount: segments.length,
    usage,
  };
}
