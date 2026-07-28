// 人名候選集 · docs/modules/four-features-reflection.md §4（P4）
//
// 這段的價值全在「有沒有真的送進 prompt」——送錯地方（system blocks）會讓
// prompt caching 每次失效（AGENTS.md：易變內容一律放 userMessage），
// 而漏送就是回到自動歸屬 0% 的原點。兩種都不會有任何錯誤訊息。
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSegment } from "../src/conversation-analysis/pipeline/classify.js";
import type { LLMProvider } from "../src/llm/provider.interface.js";
import type { ChatMessage } from "../src/conversation-analysis/pipeline/parser.js";

/** 攔下送給模型的東西，不真的呼叫 API */
function spyProvider(): { provider: LLMProvider; seen: { system?: string; user?: string; cache?: string } } {
  const seen: { system?: string; user?: string; cache?: string } = {};
  const provider = {
    async chat(args: { systemPrompt: string; userMessage: string; cacheableContext?: string }) {
      seen.system = args.systemPrompt;
      seen.user = args.userMessage;
      seen.cache = args.cacheableContext;
      return {
        parsed: { classifications: [], records: [], daily_reports: [] },
        usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
      };
    },
  } as unknown as LLMProvider;
  return { provider, seen };
}

const TENANT = { systemPrompt: "SYS", masterDataJson: "{}" };
const seg: ChatMessage[] = [
  { id: 1, date: "2026-07-28", time: "09:00", sender: "阿源", text: "這件事給佳慧處理" } as ChatMessage,
];

test("⭐ 名單要出現在 userMessage 裡", async () => {
  const { provider, seen } = spyProvider();
  await analyzeSegment(provider, "測試群", seg, TENANT, undefined, "factory_report", ["許佳惠", "陳威廉"]);
  assert.match(seen.user!, /許佳惠/);
  assert.match(seen.user!, /陳威廉/);
});

test("⭐ 名單不可進 system 或 cacheableContext（會讓 prompt 快取每次失效）", async () => {
  const { provider, seen } = spyProvider();
  await analyzeSegment(provider, "測試群", seg, TENANT, undefined, "factory_report", ["許佳惠"]);
  assert.doesNotMatch(seen.system!, /許佳惠/, "名單依租戶而異，放進穩定前綴＝每家一份快取且每次改名就失效");
  assert.doesNotMatch(seen.cache ?? "", /許佳惠/);
});

test("⭐ 要明講限制，不能只丟名單", async () => {
  const { provider, seen } = spyProvider();
  await analyzeSegment(provider, "測試群", seg, TENANT, undefined, "factory_report", ["許佳惠"]);
  // 只給名單模型仍會自由發揮 —— prod 抽到過「佳慧/小星星/威廉/三爪」就是這樣來的
  assert.match(seen.user!, /只能填/, "要明確限制只能填名單內的值");
  assert.match(seen.user!, /null/, "要給模型一個合法的「不知道」出口");
  assert.match(seen.user!, /主要負責的那一位/, "要處理一件事牽涉多人的情況");
});

test("名單為空 → 完全不加這一段（維持原行為）", async () => {
  const { provider, seen } = spyProvider();
  await analyzeSegment(provider, "測試群", seg, TENANT, undefined, "factory_report", []);
  assert.doesNotMatch(seen.user!, /同仁名單/);
});

test("沒傳名單參數 → 也不加（既有呼叫端不受影響）", async () => {
  const { provider, seen } = spyProvider();
  await analyzeSegment(provider, "測試群", seg, TENANT);
  assert.doesNotMatch(seen.user!, /同仁名單/);
});

test("⭐ 訊息內容仍完整送出（加了名單不可擠掉正文）", async () => {
  const { provider, seen } = spyProvider();
  await analyzeSegment(provider, "測試群", seg, TENANT, undefined, "factory_report", ["許佳惠"]);
  assert.match(seen.user!, /這件事給佳慧處理/);
  assert.match(seen.user!, /測試群/);
});
