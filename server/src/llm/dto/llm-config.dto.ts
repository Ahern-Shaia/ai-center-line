import { z } from "zod";

export const LlmConfigUpsertSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google", "ollama", "deepseek"]),
  model: z.string().min(1).max(100),
  apiKey: z.string().min(1).max(500),        // Ollama 可填 "not-required"
  baseUrl: z.string().url().max(500).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(64000).optional(),
});

export type LlmConfigUpsertPayload = z.infer<typeof LlmConfigUpsertSchema>;
