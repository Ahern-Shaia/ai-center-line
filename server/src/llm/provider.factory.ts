import { AnthropicProvider } from "./providers/anthropic.provider.js";
import { OpenAIProvider } from "./providers/openai.provider.js";
import { GoogleProvider } from "./providers/google.provider.js";
import { OllamaProvider } from "./providers/ollama.provider.js";
import type { LLMProvider, LLMProviderConfig } from "./provider.interface.js";

// Factory · 由 config.provider 動態選 Provider · DeepSeek 重用 OpenAIProvider（baseUrl 帶不同）
const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/v1";

// 對話分析類任務 pipeline preferred defaults · 不露給客戶調
// - Temperature 0.1：求一致性（同輸入每次結果應一樣）· 避免幻覺
// - Max Tokens 16000：避免 JSON 截斷 parse fail（一段 30-60 訊息 output 可能 5000+ tokens）
const PIPELINE_DEFAULT_TEMPERATURE = 0.1;
const PIPELINE_DEFAULT_MAX_TOKENS = 16000;

export function createLLMProvider(cfg: LLMProviderConfig): LLMProvider {
  const cfgWithDefaults: LLMProviderConfig = {
    ...cfg,
    temperature: cfg.temperature ?? PIPELINE_DEFAULT_TEMPERATURE,
    maxTokens: cfg.maxTokens ?? PIPELINE_DEFAULT_MAX_TOKENS,
  };
  switch (cfgWithDefaults.provider) {
    case "anthropic":
      return new AnthropicProvider(cfgWithDefaults);
    case "openai":
      return new OpenAIProvider(cfgWithDefaults, "openai");
    case "google":
      return new GoogleProvider(cfgWithDefaults);
    case "ollama":
      return new OllamaProvider(cfgWithDefaults);
    case "deepseek":
      return new OpenAIProvider(
        {
          ...cfgWithDefaults,
          baseUrl: cfgWithDefaults.baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL,
        },
        "deepseek",
      );
    default: {
      const _exhaustive: never = cfgWithDefaults.provider;
      throw new Error(`unsupported provider: ${_exhaustive}`);
    }
  }
}

// Provider default model · 給 frontend dropdown 提示（也是 fallback default）
export const PROVIDER_DEFAULT_MODELS: Record<LLMProviderConfig["provider"], string[]> = {
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-4o", "gpt-4o-mini"],
  google: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  ollama: ["llama3.3", "llama3.1", "qwen2.5", "deepseek-r1"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
};
