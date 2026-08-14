import { GoogleGenerativeAI } from "@google/generative-ai";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  ChatInput,
  ChatOutput,
  LLMProvider,
  LLMProviderConfig,
} from "../provider.interface.js";

// Google Gemini · 用 responseSchema · schema 需 sanitize（不支援 $schema/additionalProperties/format 等）
export class GoogleProvider implements LLMProvider {
  readonly name = "google" as const;
  private readonly client: GoogleGenerativeAI;
  readonly model: string;
  private readonly cfg: LLMProviderConfig;

  constructor(cfg: LLMProviderConfig) {
    this.cfg = cfg;
    this.model = cfg.model;
    this.client = new GoogleGenerativeAI(cfg.apiKey);
  }

  async chat(input: ChatInput): Promise<ChatOutput> {
    const jsonSchema = zodToJsonSchema(input.outputSchema as never, {
      $refStrategy: "none",
      target: "openApi3",
    }) as Record<string, unknown>;
    const sanitized = sanitizeGeminiSchema(jsonSchema);
    const systemContent = input.cacheableContext
      ? `${input.systemPrompt}\n\n${input.cacheableContext}`
      : input.systemPrompt;
    const model = this.client.getGenerativeModel({
      model: this.cfg.model,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: sanitized as never,
        temperature: this.cfg.temperature,
        maxOutputTokens: input.maxTokens ?? this.cfg.maxTokens ?? 16000,
      },
      systemInstruction: systemContent,
    });
    const res = await model.generateContent(input.userMessage);
    const text = res.response.text();
    if (!text) throw new Error("Gemini 結構化輸出為空");
    const parsed = input.outputSchema.parse(JSON.parse(text));
    const meta = res.response.usageMetadata;
    return {
      parsed,
      usage: {
        inputTokens: meta?.promptTokenCount ?? 0,
        outputTokens: meta?.candidatesTokenCount ?? 0,
        cacheReadTokens: meta?.cachedContentTokenCount ?? 0,
        cacheWriteTokens: 0,
      },
    };
  }
}

// Gemini responseSchema 不支援 $schema / additionalProperties / format 等欄位 · 遞歸移除
function sanitizeGeminiSchema(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(sanitizeGeminiSchema);
  const obj = node as Record<string, unknown>;
  const { $schema, additionalProperties, format, ...rest } = obj;
  const out: Record<string, unknown> = { ...rest };
  if (out.properties && typeof out.properties === "object") {
    const newProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(out.properties as Record<string, unknown>)) {
      newProps[k] = sanitizeGeminiSchema(v);
    }
    out.properties = newProps;
  }
  if (out.items) out.items = sanitizeGeminiSchema(out.items);
  return out;
}
