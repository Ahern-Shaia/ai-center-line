import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  ChatInput,
  ChatOutput,
  LLMProvider,
  LLMProviderConfig,
} from "../provider.interface.js";

// Ollama 地端 · 走 fetch to /api/chat · format='json' · schema 塞 system prompt 為 hint（Ollama 0.5+ 支援 format={schema} 但版本相容性採 hint 較安全）
const DEFAULT_BASE_URL = "http://localhost:11434";
const REQUEST_TIMEOUT_MS = 120_000;

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama" as const;
  readonly model: string;
  private readonly cfg: LLMProviderConfig;

  constructor(cfg: LLMProviderConfig) {
    this.cfg = cfg;
    this.model = cfg.model;
  }

  async chat(input: ChatInput): Promise<ChatOutput> {
    const baseUrl = (this.cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    const jsonSchema = zodToJsonSchema(input.outputSchema as never, {
      $refStrategy: "none",
    });
    const systemContent = [
      input.systemPrompt,
      input.cacheableContext ?? "",
      "\n請以 JSON 回覆 · 嚴格符合以下 schema · 不加任何 markdown 或解釋文字:",
      JSON.stringify(jsonSchema),
    ]
      .filter(Boolean)
      .join("\n\n");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.cfg.model,
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: input.userMessage },
          ],
          format: "json",
          stream: false,
          options: {
            temperature: this.cfg.temperature,
            num_predict: input.maxTokens ?? this.cfg.maxTokens,
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Ollama HTTP ${res.status}: ${body}`);
      }
      const data = (await res.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const content = data.message?.content;
      if (!content) throw new Error("Ollama 回應為空");
      const parsed = input.outputSchema.parse(JSON.parse(content));
      return {
        parsed,
        usage: {
          inputTokens: data.prompt_eval_count ?? 0,
          outputTokens: data.eval_count ?? 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
