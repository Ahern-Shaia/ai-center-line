import OpenAI from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  ChatInput,
  ChatOutput,
  LLMProvider,
  LLMProviderConfig,
  LLMProviderName,
} from "../provider.interface.js";

// OpenAI + DeepSeek（OpenAI-compatible）· 用 JSON Schema response_format · 無 prompt caching
// DeepSeek: baseUrl='https://api.deepseek.com/v1' · 其餘同 OpenAI
export class OpenAIProvider implements LLMProvider {
  readonly name: LLMProviderName;
  private readonly client: OpenAI;
  private readonly cfg: LLMProviderConfig;

  constructor(cfg: LLMProviderConfig, name: LLMProviderName = "openai") {
    this.cfg = cfg;
    this.name = name;
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
  }

  async chat(input: ChatInput): Promise<ChatOutput> {
    const jsonSchema = zodToJsonSchema(input.outputSchema as never, {
      $refStrategy: "none",
      target: "openAi",
    }) as Record<string, unknown>;
    const systemContent = input.cacheableContext
      ? `${input.systemPrompt}\n\n${input.cacheableContext}`
      : input.systemPrompt;
    const res = await this.client.chat.completions.create({
      model: this.cfg.model,
      max_tokens: input.maxTokens ?? this.cfg.maxTokens ?? 16000,
      temperature: this.cfg.temperature,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "result",
          strict: true,
          schema: jsonSchema,
        },
      },
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: input.userMessage },
      ],
    });
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error(`${this.name} 結構化輸出為空`);
    const parsed = input.outputSchema.parse(JSON.parse(content));
    return {
      parsed,
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }
}
