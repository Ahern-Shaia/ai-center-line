import { Logger } from "@nestjs/common";
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

/**
 * 輸出被截斷 —— 這是**唯一**會在這裡重試的錯誤。
 *
 * ⚠️ AGENTS.md 明文「API 呼叫失敗讓 SDK 自動重試，不要自己包重試迴圈」。
 * 那條講的是 429 / 5xx，SDK 內建 backoff 會處理。
 * **解析截斷 SDK 不重試** —— 對它來說請求成功了（HTTP 200），只是內容寫到一半。
 * 所以這裡只認這一種，其餘（認證、額度、schema 不合法…）一律原樣拋出，
 * 否則會把「設定錯了」變成「重試三次後設定還是錯了」，只是慢三倍又貴三倍。
 *
 * 兩種表現形式都要認：
 *   · SDK 解半截 JSON 時丟的  → 訊息含 "Failed to parse structured output"
 *   · 截得更早、SDK 回 null   → 我們自己在下面丟的
 */
const TRUNCATED_OUTPUT = /Failed to parse structured output|parsed_output 為空/;
const isTruncatedOutput = (e: unknown): boolean =>
  TRUNCATED_OUTPUT.test(String((e as Error)?.message ?? e));

/**
 * 重試策略 · 第 3 次把預算加倍。
 *
 * ⚠️ 這個「加倍」不只是保險，它同時是**量測**：
 * 2026-09-05 排查時無法分辨截斷是「機率性（adaptive thinking 那次想太多）」
 * 還是「決定性（輸出本來就超過上限）」—— 因為失敗批次不留任何 usage。
 * 現在每次成功都會 log 是第幾次、用了多少預算：
 *   · 大多在第 2 次成功（預算沒變）→ 機率性
 *   · 大多在第 3 次成功（預算加倍）→ 就是上限問題，該調 max_tokens 預設
 * 沒有這行 log，這題還是查不出來。
 */
const MAX_ATTEMPTS = 3;

export class AnthropicProvider implements LLMProvider {
  private readonly logger = new Logger(AnthropicProvider.name);
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
    const baseMaxTokens = input.maxTokens ?? this.cfg.maxTokens ?? 16000;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // 最後一次把預算加倍 —— 若截斷真的是「寫不完」，這一次才有機會過
      const maxTokens = attempt === MAX_ATTEMPTS ? baseMaxTokens * 2 : baseMaxTokens;
      try {
        const res = await this.client.messages.parse({
          model: this.cfg.model,
          max_tokens: maxTokens,
          ...(supportsAdaptiveThinking(this.cfg.model) ? { thinking: { type: "adaptive" as const } } : {}),
          system,
          messages: [{ role: "user", content: input.userMessage }],
          output_config: { format: zodOutputFormat(input.outputSchema) },
        });
        const parsed = res.parsed_output;
        if (!parsed) throw new Error("Anthropic 結構化輸出解析失敗（parsed_output 為空）");
        if (attempt > 1) {
          // ⭐ 這行就是根因的答案來源，不要拿掉（見 MAX_ATTEMPTS 的說明）
          this.logger.warn(
            `[anthropic] 截斷後重試成功 · 第 ${attempt} 次 · max_tokens=${maxTokens} · output=${res.usage.output_tokens}`,
          );
        }
        return {
          parsed,
          usage: {
            inputTokens: res.usage.input_tokens,
            outputTokens: res.usage.output_tokens,
            cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
          },
        };
      } catch (err) {
        lastErr = err;
        // ⚠️ 只重試截斷。其餘原樣拋 —— 設定錯了重試三次還是錯，只是慢三倍又貴三倍。
        if (!isTruncatedOutput(err)) throw err;
        this.logger.warn(
          `[anthropic] 輸出被截斷 · 第 ${attempt}/${MAX_ATTEMPTS} 次 · max_tokens=${maxTokens} · `
          + String((err as Error).message ?? err).slice(0, 120),
        );
      }
    }
    // 三次都截斷 —— 把「試了幾次」講出來，否則畫面上看起來跟只試一次一樣
    throw new Error(
      `AI 回覆連續 ${MAX_ATTEMPTS} 次被截斷（最後一次預算已加倍至 ${baseMaxTokens * 2}）：`
      + String((lastErr as Error)?.message ?? lastErr),
    );
  }
}
