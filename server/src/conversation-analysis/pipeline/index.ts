// runPipeline · pilot backend orchestration
// LINE 匯出檔 raw text → parser → segments → analyzeSegment × N → 匯總 result
import { sql } from "drizzle-orm";
import { parseLineExport, segmentMessages, type ChatMessage } from "./parser.js";
import { analyzeSegment, addUsage, emptyUsage, type UsageStats } from "./classify.js";
import { TWH_TENANT, type Tenant } from "./tenant-twh.js";
import { DEFAULT_CATEGORIES, type AnalysisResultT } from "./schemas.js";
import { TEMPLATE_REGISTRY, resolveTemplate, DEFAULT_TEMPLATE, type ExtractionTemplate } from "./templates.js";
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
  /** L2 業種區塊 · 依 template 決定存到哪個欄位（見 templates.ts resultKey）*/
  templateReports: Array<Record<string, unknown>>;
  template: ExtractionTemplate;
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
  // AAL · L2 業種模板 · 讀不到一律 fallback DEFAULT_TEMPLATE（＝現行行為，不因設定缺失而改變抽取）
  const template = await loadTemplate(tenantId);
  const resultKey = TEMPLATE_REGISTRY[template].resultKey;
  const { groupName, messages } = parseLineExport(rawText);
  const segments = segmentMessages(messages);

  // WTB-M2 · 讀 category_registry active list · 若 tenant 沒 registry → 用 DEFAULT_CATEGORIES
  const knownCategories = await loadKnownCategories(tenantId);
  // 4FR-P4 · 這個租戶實際存在的人 · 給模型當候選集
  const roster = await loadMemberRoster(tenantId);
  // master-data-sync · 客戶主檔（沒接就是空陣列，抽取回到原行為）
  const customers = await loadCustomerRoster(tenantId);

  const catMap = new Map<number, { category: string; confidence: string }>();
  const templateReports: Array<Record<string, unknown>> = [];
  const records: AnalysisResultT["records"] = [];
  const usage = emptyUsage();

  for (const seg of segments) {
    const { result, usage: u } = await analyzeSegment(provider, groupName, seg, tenant, knownCategories, template, roster, customers);
    for (const c of result.classifications) {
      catMap.set(c.id, { category: c.category, confidence: c.confidence });
    }
    if (resultKey) {
      const section = (result as unknown as Record<string, unknown>)[resultKey];
      if (Array.isArray(section)) templateReports.push(...(section as Array<Record<string, unknown>>));
    }
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
    templateReports,
    template,
    records,
    messageCount: messages.length,
    segmentCount: segments.length,
    usage,
  };
}

// AAL helper · 讀該租戶的 L2 模板 · 查不到用 DEFAULT_TEMPLATE（保持現行行為）
async function loadTemplate(tenantId?: string): Promise<ExtractionTemplate> {
  if (!tenantId) return DEFAULT_TEMPLATE;
  try {
    const res = await withTenant({ tenantId, role: "tenant_admin" }, (tx) => tx.execute<{ t: string | null }>(sql`
      SELECT extraction_template AS t FROM tenants WHERE tenant_id = ${tenantId}::uuid
    `));
    return resolveTemplate(res.rows[0]?.t);
  } catch {
    return DEFAULT_TEMPLATE;   // 0030 未跑或查詢失敗 → 不改變抽取行為
  }
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

/**
 * 這個租戶實際存在的人名 · four-features-reflection.md §4
 *
 * 為什麼需要：沒有候選集時，模型抽出來的是自由文字 ——
 * prod 實際抽到過「佳慧/小星星/威廉/三爪」（一格四個人）、「許佳惠/SHIN 新」，
 * 這種字串永遠對不到任何帳號，自動歸屬因此是 0%。
 *
 * 名單來源是 line_member + users，都是真實資料（prod 42 人），
 * 不是 tenant-twh.ts 那份假主檔（P-01 洪○○ 那些人在真實群組裡不存在）。
 *
 * ⚠️ 只送顯示名，不送電話/地址 —— 名單會進 prompt 送到模型供應商（FMEA F-1）。
 */
async function loadMemberRoster(tenantId?: string): Promise<string[]> {
  if (!tenantId) return [];
  try {
    const res = await withTenant({ tenantId, role: "tenant_admin" }, (tx) => tx.execute<{ name: string }>(sql`
      SELECT DISTINCT btrim(name) AS name FROM (
        SELECT u.display_name AS name FROM users u
         WHERE u.tenant_id = ${tenantId}::uuid AND nullif(btrim(u.display_name), '') IS NOT NULL
        UNION
        SELECT lm.display_name FROM line_member lm
         WHERE lm.tenant_id = ${tenantId}::uuid AND nullif(btrim(lm.display_name), '') IS NOT NULL
      ) s
      ORDER BY 1
      LIMIT 80
    `));
    return res.rows.map((r) => r.name);
  } catch {
    // 拿不到名單就退回原行為（自由抽取）· 不因為名單查詢失敗而讓整份分析失敗
    return [];
  }
}

/**
 * 客戶主檔候選 · master-data-sync.md
 * 沒接主檔就回空陣列 —— 抽取退回原本的自由文字行為，不會壞。
 */
async function loadCustomerRoster(tenantId?: string): Promise<string[]> {
  if (!tenantId) return [];
  try {
    const res = await withTenant({ tenantId, role: "tenant_admin" }, (tx) => tx.execute<{ name: string }>(sql`
      SELECT name FROM data_sync_customer
       WHERE tenant_id = ${tenantId}::uuid AND active
       ORDER BY name
       LIMIT 150
    `));
    return res.rows.map((r) => r.name);
  } catch {
    return [];
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
