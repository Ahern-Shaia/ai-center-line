import type { z } from "zod";

// LLM Provider 抽象介面 · 對應 EEA PDF §5.9 「平台支援多 LLM · Ollama/Gemini/DeepSeek 等」
// 5 providers · 統一 chat() 呼叫 · 各家 SDK 差異在 impl · 對上層透明
// Zod schema 由 helper zodToJsonSchema 轉 · Anthropic 用 zodOutputFormat · 其他家用 JSON Schema

export type LLMProviderName = "anthropic" | "openai" | "google" | "ollama" | "deepseek";

export interface LLMProviderConfig {
  provider: LLMProviderName;
  model: string;
  apiKey: string;                  // Anthropic/OpenAI/Google/DeepSeek 用 · Ollama 可空
  baseUrl?: string;                // Ollama (default localhost:11434) · DeepSeek (default api.deepseek.com) · 或 custom
  temperature?: number;
  maxTokens?: number;
}

export interface ChatInput {
  systemPrompt: string;            // 主 system prompt
  cacheableContext?: string;       // Anthropic prompt caching 專用 · 其他 provider 併入 systemPrompt
  userMessage: string;
  outputSchema: z.ZodType<unknown>;
  maxTokens?: number;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;         // Anthropic + Google（cachedContentTokenCount）
  cacheWriteTokens: number;        // Anthropic only
}

export interface ChatOutput {
  parsed: unknown;                 // Zod validated result
  usage: ChatUsage;
}

export interface LLMProvider {
  readonly name: LLMProviderName;
  chat(input: ChatInput): Promise<ChatOutput>;
}

export function emptyUsage(): ChatUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}
