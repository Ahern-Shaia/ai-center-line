// LLM 定價表 · 每 1M tokens · USD
// 若 usage_stats 有 provider/model · 精確查此表；缺則走 default (anthropic:claude-opus-4-7)
//
// Anthropic 區塊 2026-08-14 依官方 pricing 頁校正（platform.claude.com/docs/en/about-claude/pricing）：
//   - 原本 opus-4-7 記成 $15/$75（那是 Opus 4.1 的價）→ 實際 $5/$25，成本被高估 3 倍
//   - 原本 haiku-4-5 記成 $0.8/$4（那是 Haiku 3.5 的價）→ 實際 $1/$5
// cacheWrite 用 5 分鐘 TTL 價（1.25× input）· cacheRead 為 0.1× input · 與 provider 實作一致
// （anthropic.provider 只用 {type:"ephemeral"} 預設 5m，沒用 1h TTL）
//
// 其他 provider 的數字尚未逐一查證，沿用原表；要報給客戶看之前應各自對一次官方頁。

export interface ModelPricing {
  provider: string;
  model: string;
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M: number;
  cacheWritePer1M: number;
}

export const PRICING: ModelPricing[] = [
  // Anthropic Claude · 2026-08-14 對過官方 pricing 頁
  { provider: "anthropic", model: "claude-opus-5",       inputPer1M: 5,    outputPer1M: 25,   cacheReadPer1M: 0.5,  cacheWritePer1M: 6.25 },
  { provider: "anthropic", model: "claude-opus-4-8",     inputPer1M: 5,    outputPer1M: 25,   cacheReadPer1M: 0.5,  cacheWritePer1M: 6.25 },
  { provider: "anthropic", model: "claude-opus-4-7",     inputPer1M: 5,    outputPer1M: 25,   cacheReadPer1M: 0.5,  cacheWritePer1M: 6.25 },
  { provider: "anthropic", model: "claude-opus-4-6",     inputPer1M: 5,    outputPer1M: 25,   cacheReadPer1M: 0.5,  cacheWritePer1M: 6.25 },
  { provider: "anthropic", model: "claude-sonnet-5",     inputPer1M: 2,    outputPer1M: 10,   cacheReadPer1M: 0.2,  cacheWritePer1M: 2.5 },
  { provider: "anthropic", model: "claude-sonnet-4-6",   inputPer1M: 3,    outputPer1M: 15,   cacheReadPer1M: 0.3,  cacheWritePer1M: 3.75 },
  { provider: "anthropic", model: "claude-haiku-4-5",    inputPer1M: 1,    outputPer1M: 5,    cacheReadPer1M: 0.1,  cacheWritePer1M: 1.25 },
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

// 沒記到 provider/model 的舊資料 · 用 opus-4-7 計價（歷史上平台預設就是它）
// 刻意不跟著 env LLM_DEFAULT_MODEL 走：那會拿今天的價去重算昨天用別的模型跑出來的量
export const DEFAULT_PRICING =
  PRICING.find((p) => p.provider === "anthropic" && p.model === "claude-opus-4-7") ?? PRICING[0];

export function lookupPricing(provider?: string | null, model?: string | null): ModelPricing {
  if (!provider) return DEFAULT_PRICING;
  if (model) {
    const exact = PRICING.find((p) => p.provider === provider && p.model === model);
    if (exact) return exact;
    // dated snapshot（claude-haiku-4-5-20251001）· 取最長前綴 · 否則會掉到下面的 provider fallback 用錯價
    const byPrefix = PRICING
      .filter((p) => p.provider === provider && p.model !== "*" && model.startsWith(p.model))
      .sort((a, b) => b.model.length - a.model.length)[0];
    if (byPrefix) return byPrefix;
  }
  const providerFallback = PRICING.find((p) => p.provider === provider && p.model === "*");
  if (providerFallback) return providerFallback;
  // 認不得的新模型 · 用該 provider 表中第一筆（最貴的一階）· 寧可高估也不要低估成本
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
