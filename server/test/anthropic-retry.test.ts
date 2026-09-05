/**
 * 截斷重試 · docs 排查 2026-09-05
 *
 * 【為什麼要有這支】
 * prod 從 08-20 起陸續有分析批次失敗，錯誤是「輸出被截斷」的兩種表現。
 * 它是**機率性**的（同樣輸入重跑很可能就過），而原本一次失敗整批就報廢。
 *
 * ⚠️⚠️ 這支真正要守的是**「只重試截斷」**這條界線。
 * AGENTS.md 明文「不要自己包重試迴圈」—— 那條講 429/5xx（SDK 已內建）。
 * 如果哪天有人把 catch 放寬成「什麼都重試」，
 * 「API key 錯了」會變成「重試三次後 API key 還是錯」——
 * 慢三倍、貴三倍，而且錯誤訊息還被包了一層。那個退化不會有人發現，所以要測。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "../src/llm/providers/anthropic.provider.js";
import { z } from "zod";

const SCHEMA = z.object({ ok: z.boolean() });
const input = {
  systemPrompt: "s",
  userMessage: "u",
  outputSchema: SCHEMA,
} as Parameters<AnthropicProvider["chat"]>[0];

/** 把 provider 內部的 SDK client 換成假的，記錄每次呼叫的 max_tokens */
const withFakeClient = (
  behaviours: Array<() => unknown>,
): { provider: AnthropicProvider; maxTokensSeen: number[] } => {
  const p = new AnthropicProvider({ apiKey: "test", model: "claude-opus-5", maxTokens: 1000 } as never);
  const maxTokensSeen: number[] = [];
  let i = 0;
  (p as unknown as { client: unknown }).client = {
    messages: {
      parse: async (args: { max_tokens: number }) => {
        maxTokensSeen.push(args.max_tokens);
        const b = behaviours[Math.min(i++, behaviours.length - 1)];
        return b();
      },
    },
  };
  return { provider: p, maxTokensSeen };
};

const okResponse = () => ({
  parsed_output: { ok: true },
  usage: { input_tokens: 10, output_tokens: 20 },
});

test("⭐ 一次就成功 —— 不重試、不加預算", async () => {
  const { provider, maxTokensSeen } = withFakeClient([okResponse]);
  const out = await provider.chat(input);
  assert.deepEqual(out.parsed, { ok: true });
  assert.deepEqual(maxTokensSeen, [1000]);
});

test("⭐⭐ 截斷（SDK 丟的）→ 重試，第 2 次成功", async () => {
  const { provider, maxTokensSeen } = withFakeClient([
    () => { throw new Error("Failed to parse structured output as JSON: Unterminated string"); },
    okResponse,
  ]);
  const out = await provider.chat(input);
  assert.deepEqual(out.parsed, { ok: true });
  // 第 2 次**預算不變** —— 這樣才驗得出「同樣條件重跑就過」＝機率性
  assert.deepEqual(maxTokensSeen, [1000, 1000]);
});

test("⭐⭐ 截斷（parsed_output 為空）也算 —— 兩種表現都要認", async () => {
  const { provider } = withFakeClient([
    () => ({ parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } }),
    okResponse,
  ]);
  assert.deepEqual((await provider.chat(input)).parsed, { ok: true });
});

test("⭐⭐ 第 3 次把預算加倍（這同時是根因的量測手段）", async () => {
  const { provider, maxTokensSeen } = withFakeClient([
    () => { throw new Error("Failed to parse structured output"); },
    () => { throw new Error("Failed to parse structured output"); },
    okResponse,
  ]);
  await provider.chat(input);
  assert.deepEqual(maxTokensSeen, [1000, 1000, 2000], "最後一次沒有加倍預算就量不出是不是上限問題");
});

test("⭐⭐⭐ 非截斷錯誤**不可以**重試 —— 這是這支測試的重點", async () => {
  let calls = 0;
  const { provider } = withFakeClient([
    () => { calls++; throw new Error("401 authentication_error: invalid x-api-key"); },
  ]);
  await assert.rejects(() => provider.chat(input), /invalid x-api-key/);
  assert.equal(calls, 1, "設定錯誤被重試了 —— 只會慢三倍、貴三倍，錯誤訊息還被包一層");
});

test("⭐ 三次都截斷 → 錯誤訊息要講出試了幾次、預算加到多少", async () => {
  const { provider } = withFakeClient([
    () => { throw new Error("Failed to parse structured output"); },
  ]);
  await assert.rejects(
    () => provider.chat(input),
    // 只說「解析失敗」的話，畫面上看起來跟只試一次一樣，人會以為系統沒重試
    /連續 3 次被截斷.*加倍至 2000/,
  );
});
