// LLM 定價表 · 每 1M tokens · USD (2026-07 各家官方公告)
// 若 usage_stats 有 provider/model · 精確查此表；缺則走 default (anthropic:claude-opus-4-7)

export interface ModelPricing {
  provider: string;
  model: string;
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M: number;
  cacheWritePer1M: number;
}

export const PRICING: ModelPricing[] = [
  // Anthropic Claude
  { provider: "anthropic", model: "claude-opus-4-7",     inputPer1M: 15,   outputPer1M: 75,   cacheReadPer1M: 1.5,  cacheWritePer1M: 18.75 },
  { provider: "anthropic", model: "claude-sonnet-4-6",   inputPer1M: 3,    outputPer1M: 15,   cacheReadPer1M: 0.3,  cacheWritePer1M: 3.75 },
  { provider: "anthropic", model: "claude-haiku-4-5",    inputPer1M: 0.8,  outputPer1M: 4,    cacheReadPer1M: 0.08, cacheWritePer1M: 1 },
  // OpenAI
  { provider: "openai",    model: "gpt-4o",              inputPer1M: 5,    outputPer1M: 15,   cacheReadPer1M: 2.5,  cacheWritePer1M: 5 },
  { provider: "openai",    model: "gpt-4o-mini",         inputPer1M: 0.15, outputPer1M: 0.6,  cacheReadPer1M: 0.075, cacheWritePer1M: 0.15 },
  // Google
  { provider: "google",    model: "gemini-2.0-pro",      inputPer1M: 1.25, outputPer1M: 5,    cacheReadPer1M: 0.3125, cacheWritePer1M: 1.25 },
  { provider: "google",    model: "gemini-2.0-flash",    inputPer1M: 0.3,  outputPer1M: 2.5,  cacheReadPer1M: 0.075,  cacheWritePer1M: 0.3 },
  // DeepSeek
  { provider: "deepseek",  model: "deepseek-chat",       inputPer1M: 0.14, outputPer1M: 0.28, cacheReadPer1M: 0.014, cacheWritePer1M: 0.14 },
  // Ollama (地端)
  { provider: "ollama",    model: "*",                    inputPer1M: 0,    outputPer1M: 0,    cacheReadPer1M: 0,    cacheWritePer1M: 0 },
];

export const DEFAULT_PRICING = PRICING[0];  // claude-opus-4-7

export function lookupPricing(provider?: string | null, model?: string | null): ModelPricing {
  if (!provider) return DEFAULT_PRICING;
  const found = PRICING.find((p) => p.provider === provider && p.model === model);
  if (found) return found;
  const providerFallback = PRICING.find((p) => p.provider === provider && p.model === "*");
  if (providerFallback) return providerFallback;
  const anyOfProvider = PRICING.find((p) => p.provider === provider);
  if (anyOfProvider) return anyOfProvider;
  return DEFAULT_PRICING;
}

export function computeCost(
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  pricing: ModelPricing,
): number {
  const cost =
    (usage.inputTokens * pricing.inputPer1M
      + usage.outputTokens * pricing.outputPer1M
      + usage.cacheReadTokens * pricing.cacheReadPer1M
      + usage.cacheWriteTokens * pricing.cacheWritePer1M
    ) / 1_000_000;
  return Math.round(cost * 10000) / 10000;   // 4 decimals
}
