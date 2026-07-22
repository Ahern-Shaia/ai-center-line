// runPipeline · pilot backend orchestration
// LINE 匯出檔 raw text → parser → segments → analyzeSegment × N → 匯總 result
import { sql } from "drizzle-orm";
import { parseLineExport, segmentMessages, type ChatMessage } from "./parser.js";
import { analyzeSegment, addUsage, emptyUsage, type UsageStats } from "./classify.js";
import { TWH_TENANT, type Tenant } from "./tenant-twh.js";
import { DEFAULT_CATEGORIES, type AnalysisResultT } from "./schemas.js";
import type { LLMProvider } from "../../llm/provider.interface.js";
import { createLLMProvider } from "../../llm/provider.factory.js";
import { withTenant } from "../../db/client.js";

export type EnrichedMessage = ChatMessage & {
  category: string | null;                    // WTB-M2 · 開放為 string
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
// "batch" alias · convo-analysis-realtime webhook batch 用 (fallback twh master data)
// TODO(M6): 依 analysis_upload.tenant_id 查 DB 拿該 tenant 自訂主檔
export function resolveTenant(slug: string): Tenant {
  if (slug === "twh" || slug === "batch") return TWH_TENANT;
  throw new Error(`unknown tenant slug: ${slug}（pilot 階段只支援 twh / batch · M6 才擴充）`);
}

// Fallback provider · 若 tenant 沒 llm-config · 用 env ANTHROPIC_API_KEY
export function defaultAnthropicProvider(): LLMProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY 未設 · 且 tenant 無 llm-config · 無 LLM 可用");
  }
  return createLLMProvider({
    provider: "anthropic",
    model: "claude-opus-4-7",
    apiKey,
  });
}

export async function runPipeline(
  rawText: string,
  tenantSlug: string,
  provider: LLMProvider = defaultAnthropicProvider(),
  tenantId?: string,                                   // WTB-M2 · 若給 · pipeline 讀 category_registry
): Promise<PipelineResult> {
  const tenant = resolveTenant(tenantSlug);
  const { groupName, messages } = parseLineExport(rawText);
  const segments = segmentMessages(messages);

  // WTB-M2 · 讀 category_registry active list · 若 tenant 沒 registry → 用 DEFAULT_CATEGORIES
  const knownCategories = await loadKnownCategories(tenantId);

  const catMap = new Map<number, { category: string; confidence: string }>();
  const dailyReports: AnalysisResultT["daily_reports"] = [];
  const records: AnalysisResultT["records"] = [];
  const usage = emptyUsage();

  for (const seg of segments) {
    const { result, usage: u } = await analyzeSegment(provider, groupName, seg, tenant, knownCategories);
    for (const c of result.classifications) {
      catMap.set(c.id, { category: c.category, confidence: c.confidence });
    }
    dailyReports.push(...result.daily_reports);
    records.push(...result.records);
    addUsage(usage, u);
  }

  // WTB-M2 · 新分類 upsert (OQ-WTB-2 = A · auto-active)
  if (tenantId) {
    const seen = new Set<string>();
    for (const rec of records) {
      if (rec.category) seen.add(rec.category);
    }
    for (const c of catMap.values()) {
      if (c.category) seen.add(c.category);
    }
    await upsertCategoriesFromPipeline(tenantId, Array.from(seen));
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

// WTB-M2 helper · 讀 registry · 空則回 DEFAULT_CATEGORIES 提示
async function loadKnownCategories(tenantId?: string): Promise<Array<{ slug: string; name: string }>> {
  if (!tenantId) {
    return DEFAULT_CATEGORIES.map((s) => ({ slug: s, name: s }));
  }
  try {
    const res = await withTenant({ tenantId, role: "tenant_admin" }, (tx) => tx.execute<{ slug: string; name: string }>(sql`
      SELECT category_slug AS slug, category_name AS name
      FROM category_registry
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
      ORDER BY usage_count DESC, last_used_at DESC
      LIMIT 50
    `));
    if (res.rows.length === 0) {
      return DEFAULT_CATEGORIES.map((s) => ({ slug: s, name: s }));
    }
    return res.rows.map((r) => ({ slug: r.slug, name: r.name }));
  } catch {
    return DEFAULT_CATEGORIES.map((s) => ({ slug: s, name: s }));
  }
}

// WTB-M2 helper · 冪等 upsert · usage_count++
async function upsertCategoriesFromPipeline(tenantId: string, categories: string[]): Promise<void> {
  if (categories.length === 0) return;
  try {
    await withTenant({ tenantId, role: "tenant_admin" }, async (tx) => {
      for (const category of categories) {
        const slug = slugify(category);
        if (!slug) continue;
        await tx.execute(sql`
          INSERT INTO category_registry
            (tenant_id, category_name, category_slug, status, usage_count, last_used_at)
          VALUES (${tenantId}::uuid, ${category}, ${slug}, 'active', 1, now())
          ON CONFLICT (tenant_id, category_slug) DO UPDATE SET
            usage_count = category_registry.usage_count + 1,
            last_used_at = now()
        `);
      }
    });
  } catch {
    // 分類 upsert 失敗不影響 pipeline 主流程 (P1 殘留 · 治本：alert)
  }
}

// OQ-WTB-10 = B · slugify · 英文 lowercase + 中文保留去空格
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9一-龥_-]/g, "")
    .slice(0, 50);
}
