// Claude Opus 4.7 分類抽取 · adaptive thinking · prompt caching
// ⚠️ Backend self-contained copy — keep in sync with ../../../../../src/classify.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AnalysisResult, type AnalysisResultT } from "./schemas.js";
import type { Tenant } from "./tenant-twh.js";
import type { ChatMessage } from "./parser.js";

export interface UsageStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export function emptyUsage(): UsageStats {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
}

export function addUsage(total: UsageStats, u: UsageStats): void {
  total.calls += u.calls;
  total.inputTokens += u.inputTokens;
  total.outputTokens += u.outputTokens;
  total.cacheWriteTokens += u.cacheWriteTokens;
  total.cacheReadTokens += u.cacheReadTokens;
}

export async function analyzeSegment(
  client: Anthropic,
  groupName: string,
  segment: ChatMessage[],
  tenant: Tenant,
): Promise<{ result: AnalysisResultT; usage: UsageStats }> {
  const body = segment
    .map((m) => `#${m.id} [${m.date} ${m.time}] ${m.sender}: ${m.text.replace(/\n/g, " ⏎ ")}`)
    .join("\n");

  const response = await client.messages.parse({
    model: "claude-opus-4-7",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: tenant.systemPrompt },
      {
        type: "text",
        text: `# 工廠主檔資料（模擬 Ragic 主檔，供實體對應）\n${tenant.masterDataJson}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `群組名稱：${groupName}\n\n請分析以下 ${segment.length} 則訊息：\n${body}`,
      },
    ],
    output_config: { format: zodOutputFormat(AnalysisResult) },
  });

  const result = response.parsed_output;
  if (!result) throw new Error("結構化輸出解析失敗（parsed_output 為空）");

  const u = response.usage;
  return {
    result,
    usage: {
      calls: 1,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
    },
  };
}
