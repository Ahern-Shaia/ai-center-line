import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  ChatInput,
  ChatOutput,
  LLMProvider,
  LLMProviderConfig,
} from "../provider.interface.js";

// Anthropic Claude · 現有 pipeline pattern · 支援 prompt caching + adaptive thinking + zod structured output
//
// adaptive thinking 不是全系列都吃 · 送給不支援的模型（Haiku 4.5 / 4.5 世代）API 會回 400。
// 這裡以模型前綴判斷 · 不支援者整個 thinking 參數不送（＝不思考，仍可正常結構化輸出）。
// 新增模型到 PROVIDER_DEFAULT_MODELS 時 · 若它支援 adaptive 記得補進這個清單。
const ADAPTIVE_THINKING_MODEL_PREFIXES = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
];

export function supportsAdaptiveThinking(model: string): boolean {
  return ADAPTIVE_THINKING_MODEL_PREFIXES.some((p) => model.startsWith(p));
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;
  readonly model: string;
  private readonly cfg: LLMProviderConfig;

  constructor(cfg: LLMProviderConfig) {
    this.cfg = cfg;
    this.model = cfg.model;
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
      ...(supportsAdaptiveThinking(this.cfg.model) ? { thinking: { type: "adaptive" as const } } : {}),
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
