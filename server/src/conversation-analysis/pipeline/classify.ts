// 對話分類抽取 · 走 LLMProvider 抽象 · 支援 5 家 provider（Anthropic/OpenAI/Google/Ollama/DeepSeek）
// ⚠️ Backend self-contained · 未來遷 shared package
import { buildAnalysisSchema, type AnalysisResultT } from "./schemas.js";
import { TEMPLATE_REGISTRY, type ExtractionTemplate } from "./templates.js";
import type { Tenant } from "./tenant-twh.js";
import type { ChatMessage } from "./parser.js";
import type { ChatUsage, LLMProvider } from "../../llm/provider.interface.js";

export interface UsageStats extends ChatUsage {
  calls: number;
}

export function emptyUsage(): UsageStats {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
}

export function addUsage(total: UsageStats, u: UsageStats): void {
  total.calls += u.calls;
  total.inputTokens += u.inputTokens;
  total.outputTokens += u.outputTokens;
  total.cacheWriteTokens += u.cacheWriteTokens;
  total.cacheReadTokens += u.cacheReadTokens;
}

export async function analyzeSegment(
  provider: LLMProvider,
  groupName: string,
  segment: ChatMessage[],
  tenant: Tenant,
  knownCategories?: Array<{ slug: string; name: string }>,     // WTB-M2 · 若有 · 注入 userMessage
  template: ExtractionTemplate = "factory_report",             // AAL · L2 業種模板
): Promise<{ result: AnalysisResultT; usage: UsageStats }> {
  const body = segment
    .map((m) => `#${m.id} [${m.date} ${m.time}] ${m.sender}: ${m.text.replace(/\n/g, " ⏎ ")}`)
    .join("\n");

  const categoryHint = knownCategories && knownCategories.length > 0
    ? `\n# 已知分類（依使用頻率 · 優先歸入 · 全新性質才自行命名）\n${knownCategories.map((c) => `- ${c.slug} (${c.name})`).join("\n")}\n`
    : "";

  // L2 模板的抽取規則接在 system prompt 尾端 —— 仍是穩定前綴，caching 不受影響
  // （易變內容如日期/訊息一律在 userMessage · 見 AGENTS.md）
  const def = TEMPLATE_REGISTRY[template];
  const output = await provider.chat({
    systemPrompt: tenant.systemPrompt + def.promptFragment,
    cacheableContext: `# 工廠主檔資料（模擬 Ragic 主檔，供實體對應）\n${tenant.masterDataJson}`,
    userMessage: `群組名稱：${groupName}${categoryHint}\n\n請分析以下 ${segment.length} 則訊息：\n${body}`,
    outputSchema: buildAnalysisSchema(template),
  });

  return {
    result: output.parsed as AnalysisResultT,
    usage: {
      calls: 1,
      inputTokens: output.usage.inputTokens,
      outputTokens: output.usage.outputTokens,
      cacheWriteTokens: output.usage.cacheWriteTokens,
      cacheReadTokens: output.usage.cacheReadTokens,
    },
  };
}
