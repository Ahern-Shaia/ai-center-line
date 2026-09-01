/**
 * 探測：`due_at` / `due_text` 加得進 L1 抽取 schema 嗎？
 *
 * 背景：calendar-sync M0（2026-07-27）的第一個里程碑是「補 L1 抽取的時間欄位」。
 *      但 2026-08-01 `service_intake` 因為 Anthropic 結構化輸出的 union 上限
 *      被 revert（memory: anthropic-structured-output-union-limit）——
 *      而那份 M0 寫在事故之前，算不到這件事。
 *
 * ⚠️⚠️ **紀律：先跑對照組。**
 *   如果「現況 schema」自己就失敗，那實驗組失敗**證明不了任何事** ——
 *   可能只是 key 錯、模型名錯、SDK 版本不對。
 *   對照組沒過就直接停，不要report「加欄位會爆」。
 *   （memory: green-because-empty · 假陰性的第 2 種形狀：對照組根本沒切換）
 *
 * ⚠️ 這支會**真的打 API**，每次呼叫都要錢。輸入刻意壓到最小
 *   （max_tokens 512、一則 20 字的訊息）。
 *
 * 用法：
 *   cd server && npx tsx --env-file=../.env scripts/probe-union-limit.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { buildAnalysisSchema } from "../src/conversation-analysis/pipeline/schemas.js";

const MODEL = process.env.LLM_DEFAULT_MODEL?.trim() || "claude-opus-4-7";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * ⚠️⚠️ **用真正的 buildAnalysisSchema，不要在這裡手刻一份複本。**
 *    2026-09-01 我手刻的 service_order 複本量到 12，實際是 15 ——
 *    因為我猜錯了 items 內層的欄位。**用複本量出來的預算是假的**，
 *    而這支腳本存在的意義正是「別再靠推算」。
 *    （同 probe-pdr-source-ids.ts：prompt 直接從 service 原始碼讀。）
 */
const build = (extraRecordFields: z.ZodRawShape = {}) => {
  const base = buildAnalysisSchema("factory_report");
  if (Object.keys(extraRecordFields).length === 0) return base;
  // 只在 records 那一層加欄位（模擬「往 L1 加東西」）
  const shape = (base as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
  const rec = (shape.records as unknown as { element: z.ZodObject<z.ZodRawShape> }).element;
  return z.object({ ...shape, records: z.array(rec.extend(extraRecordFields)) });
};

/** 照 memory 的算法數（已知這個算法對不上現實，印出來只為了留下對照） */
function countUnions(schema: z.ZodType): number {
  const j = JSON.stringify(zodOutputFormat(schema));
  return (j.match(/"anyOf"|"oneOf"|"enum"/g) ?? []).length;
}

async function attempt(label: string, schema: z.ZodType): Promise<boolean> {
  const n = countUnions(schema);
  process.stdout.write(`${label.padEnd(38)} anyOf/oneOf/enum=${String(n).padStart(3)}  → `);
  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 512,
      system: [{ type: "text", text: "你是抽取助手。照 schema 輸出，抽不到填 null。" }],
      messages: [{ role: "user", content: "8/24 14:00 王○○去北部港區看實車，確認料件。" }],
      output_config: { format: zodOutputFormat(schema) },
    });
    console.log(res.parsed_output ? "✅ 成功" : "⚠️ 回來了但 parsed_output 是空的");
    return true;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.log(`❌ ${m.slice(0, 150).replace(/\s+/g, " ")}`);
    return false;
  }
}

const main = async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 沒有 ANTHROPIC_API_KEY —— 停止（不然失敗會被誤判成 union 上限）");
    process.exit(1);
  }
  console.log(`模型：${MODEL}\n`);

  // ── ① 對照組 · 現況 schema。這一步沒過就不要往下解讀 ──
  const ok = await attempt("① 現況（已含 due_at/due_text 不可空）", build());
  if (!ok) {
    console.error(
      "\n⛔ 對照組就失敗了 —— 這代表問題出在環境（key／模型名／SDK），"
      + "不是 union 上限。**不要**把下面的結果當成「加欄位會爆」。",
    );
    process.exit(2);
  }

  // ── ② 實驗組 · M0 要加的兩個欄位 ──
  await attempt("② 若把那兩欄改成「可空」", build({
    due_at: z.string().nullable(),
    due_text: z.string().nullable(),
  }));

  // ── ③ 上限數的是 **union 型別**不是欄位數 → 非 nullable 欄位是 0 成本 ──
  console.log("\n── 現況只剩 1 格 · 以下確認邊界在哪 ──");
  await attempt("③ 只有 due_at 改可空", build({
    due_at: z.string().nullable(),
    due_text: z.string(),           // 抽不到給 "" · 不佔 union
  }));
  await attempt("④ 維持現況（兩個都不可空）", build({
    due_at: z.string(),
    due_text: z.string(),
  }));
  await attempt("⑤ 再多加一個可空欄位", build({
    due_at: z.string().nullable(),
  }));
};

void main();
