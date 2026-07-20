import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  ChatInput,
  ChatOutput,
  LLMProvider,
  LLMProviderConfig,
} from "../provider.interface.js";

// Anthropic Claude · 現有 pipeline pattern · 支援 prompt caching + adaptive thinking + zod structured output
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;
  private readonly cfg: LLMProviderConfig;

  constructor(cfg: LLMProviderConfig) {
    this.cfg = cfg;
    this.client = new Anthropic({ apiKey: cfg.apiKey });
  }

  async chat(input: ChatInput): Promise<ChatOutput> {
    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: input.systemPrompt },
    ];
    if (input.cacheableContext) {
      system.push({
        type: "text",
        text: input.cacheableContext,
        cache_control: { type: "ephemeral" },
      });
    }
    const res = await this.client.messages.parse({
      model: this.cfg.model,
      max_tokens: input.maxTokens ?? this.cfg.maxTokens ?? 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: input.userMessage }],
      output_config: { format: zodOutputFormat(input.outputSchema) },
    });
    const parsed = res.parsed_output;
    if (!parsed) throw new Error("Anthropic 結構化輸出解析失敗（parsed_output 為空）");
    return {
      parsed,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
