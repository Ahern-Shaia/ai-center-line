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

const MODEL = process.env.LLM_DEFAULT_MODEL?.trim() || "claude-opus-4-7";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const Confidence = z.enum(["high", "medium", "low"]);

/** 現況 base（src/conversation-analysis/pipeline/schemas.ts） */
const classification = z.object({
  id: z.number(),
  category: z.string().min(1).max(100),
});
const record = (extra: z.ZodRawShape = {}) =>
  z.object({
    category: z.string().min(1).max(100),
    title: z.string(),
    detail: z.string(),
    status: z.enum(["open", "in_progress", "resolved", "info"]).nullable(),
    person: z.string().nullable(),
    machine_code: z.string().nullable(),
    work_order: z.string().nullable(),
    source_ids: z.array(z.number()),
    ...extra,
  });

/** 現況 L2：factory_report（預設模板 · templates.ts） */
const factoryReport = z.object({
  date: z.string().nullable(),
  reporter_name: z.string().nullable(),
  reporter_code: z.string().nullable(),
  line: z.string().nullable(),
  machine_code: z.string().nullable(),
  work_order: z.string().nullable(),
  output_qty: z.number().nullable(),
  defect_qty: z.number().nullable(),
  work_hours: z.number().nullable(),
  overtime_hours: z.number().nullable(),
  issues: z.string().nullable(),
  source_ids: z.array(z.number()),
  confidence: Confidence,
});

const build = (extraRecordFields: z.ZodRawShape = {}) =>
  z.object({
    classifications: z.array(classification),
    records: z.array(record(extraRecordFields)),
    daily_reports: z.array(factoryReport),
  });

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
      messages: [{ role: "user", content: "8/24 14:00 冠毅去台北港看實車，確認料件。" }],
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
  const ok = await attempt("① 對照組：現況 base + factory_report", build());
  if (!ok) {
    console.error(
      "\n⛔ 對照組就失敗了 —— 這代表問題出在環境（key／模型名／SDK），"
      + "不是 union 上限。**不要**把下面的結果當成「加欄位會爆」。",
    );
    process.exit(2);
  }

  // ── ② 實驗組 · M0 要加的兩個欄位 ──
  await attempt("② 實驗：+ due_at / due_text", build({
    due_at: z.string().nullable(),
    due_text: z.string().nullable(),
  }));

  // ── ③ 上限數的是 **union 型別**不是欄位數 → 非 nullable 欄位是 0 成本 ──
  console.log("\n── 找塞得進去的組合（現況 15 · 只剩 1 格）──");
  await attempt("③ due_at 可空 + due_text 不可空", build({
    due_at: z.string().nullable(),
    due_text: z.string(),           // 抽不到給 "" · 不佔 union
  }));
  await attempt("④ 兩個都不可空（都給 \"\"）", build({
    due_at: z.string(),
    due_text: z.string(),
  }));
  await attempt("⑤ 只加 due_at 可空（不要 due_text）", build({
    due_at: z.string().nullable(),
  }));
};

void main();
