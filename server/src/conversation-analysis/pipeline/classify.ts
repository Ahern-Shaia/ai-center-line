// 對話分類抽取 · 走 LLMProvider 抽象 · 支援 5 家 provider（Anthropic/OpenAI/Google/Ollama/DeepSeek）
// ⚠️ Backend self-contained · 未來遷 shared package
import { z } from "zod";
import { buildAnalysisSchema, type AnalysisResultT } from "./schemas.js";
import { TEMPLATE_REGISTRY, type ExtractionTemplate, type ExtraSection } from "./templates.js";
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
  memberRoster: string[] = [],                                 // 4FR-P4 · 該租戶實際存在的人
  customerRoster: string[] = [],                               // master-data-sync · 客戶主檔
): Promise<{ result: AnalysisResultT; usage: UsageStats }> {
  const body = segment
    .map((m) => `#${m.id} [${m.date} ${m.time}] ${m.sender}: ${m.text.replace(/\n/g, " ⏎ ")}`)
    .join("\n");

  const categoryHint = knownCategories && knownCategories.length > 0
    ? `\n# 已知分類（依使用頻率 · 優先歸入 · 全新性質才自行命名）\n${knownCategories.map((c) => `- ${c.slug} (${c.name})`).join("\n")}\n`
    : "";

  // 人名候選集 · 放 userMessage 不放 system（名單依租戶而異，放進穩定前綴會讓快取失效）
  //
  // 沒有這段時，模型抽出來的是自由文字 —— prod 實際抽到過
  // 「佳慧/小星星/威廉/三爪」（一格塞四個人），那種字串永遠對不到帳號。
  // 明講「只能填名單裡的，或 null」比只給名單有效：不限制的話模型仍會自行發揮。
  const rosterHint = memberRoster.length > 0
    ? `\n# 本公司同仁名單（person 欄位只能填這裡面的名字，或 null）\n`
      + `${memberRoster.join("、")}\n`
      + `一件事若牽涉多人，person 只填**主要負責的那一位**；分不出來就填 null。\n`
      + `名單裡沒有的人一律填 null —— 不要自己拼湊或合併名字。\n`
    : "";

  // 客戶候選集 · 同樣放 userMessage（每家客戶名冊不同，放穩定前綴會讓快取失效）
  const customerHint = customerRoster.length > 0
    ? `\n# 本公司客戶名冊（提到客戶時請用名冊裡的寫法）\n${customerRoster.join("、")}\n`
      + `名冊裡沒有的客戶照原文寫，不要硬套成相近的名字。\n`
    : "";

  // L2 模板的抽取規則接在 system prompt 尾端 —— 仍是穩定前綴，caching 不受影響
  // （易變內容如日期/訊息一律在 userMessage · 見 AGENTS.md）
  const def = TEMPLATE_REGISTRY[template];
  const output = await provider.chat({
    systemPrompt: tenant.systemPrompt + def.promptFragment,
    cacheableContext: `# 工廠主檔資料（模擬 Ragic 主檔，供實體對應）\n${tenant.masterDataJson}`,
    userMessage: `群組名稱：${groupName}${categoryHint}${rosterHint}${customerHint}\n\n請分析以下 ${segment.length} 則訊息：\n${body}`,
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

/**
 * 第二區塊抽取 · 獨立 LLM 呼叫（v2）。
 * ⚠️ 為什麼是獨立呼叫而非併進主 schema：併進去整包 union 參數會超過
 *    Anthropic 結構化輸出 ≤16 上限、API 回 400（doc §3.6 / FMEA F-10）。
 *    這裡的 schema 只有一個陣列（約 11 union），單獨呼叫穩在上限內。
 * 回傳已套 postProcess（如 phone 遮罩）的區塊記錄。
 */
export async function analyzeExtraSection(
  provider: LLMProvider,
  groupName: string,
  segment: ChatMessage[],
  tenant: Tenant,
  section: ExtraSection,
): Promise<{ records: Record<string, unknown>[]; usage: UsageStats }> {
  const body = segment
    .map((m) => `#${m.id} [${m.date} ${m.time}] ${m.sender}: ${m.text.replace(/\n/g, " ⏎ ")}`)
    .join("\n");

  const output = await provider.chat({
    systemPrompt: tenant.systemPrompt + section.promptFragment,
    cacheableContext: `# 工廠主檔資料（模擬 Ragic 主檔，供實體對應）\n${tenant.masterDataJson}`,
    userMessage: `群組名稱：${groupName}\n\n請從以下 ${segment.length} 則訊息抽取（依上方規則）：\n${body}`,
    outputSchema: z.object({ [section.key]: z.array(section.schema) }),
  });

  const parsed = output.parsed as Record<string, unknown>;
  const raw = Array.isArray(parsed[section.key]) ? (parsed[section.key] as Record<string, unknown>[]) : [];
  const records = section.postProcess ? raw.map(section.postProcess) : raw;

  return {
    records,
    usage: {
      calls: 1,
      inputTokens: output.usage.inputTokens,
      outputTokens: output.usage.outputTokens,
      cacheWriteTokens: output.usage.cacheWriteTokens,
      cacheReadTokens: output.usage.cacheReadTokens,
    },
  };
}
