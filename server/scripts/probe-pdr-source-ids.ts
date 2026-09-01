/**
 * 驗收：個人日報加了 `source_ids` 之後，模型真的會填嗎？
 *
 * 起因：2026-08-31 客戶回報「今天有 4 個行程，2 跟 4 同單位、維修項目也一樣，
 *      系統會合併在一起，可以分別顯示嗎？」
 *      查下去發現**個人日報的項目沒有 source_ids**（違反 R11）——
 *      沒有人（包括我們）看得出某一項到底併了哪幾則訊息。
 *
 * ⚠️ zod 綠、tsc 綠、build 綠**都驗不到這件事**：
 *    ① schema 會不會撞 Anthropic 的 16 union 上限 —— 限制在 API 端
 *    ② 模型會不會真的填 source_ids —— 那是行為，不是型別
 *    （memory: anthropic-structured-output-union-limit）
 *
 * ⚠️ prompt **直接從 service 原始碼讀出來**，不要在這裡抄一份 ——
 *    抄的那份會跟正式的漂移，然後這支驗的就不是正在跑的東西了。
 *
 * 用法：
 *   cd server && npx tsx --env-file=../.env scripts/probe-pdr-source-ids.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync } from "node:fs";
import { z } from "zod";

const SRC = "src/personal-daily-report/personal-daily-report.service.ts";

/** 從 service 原始碼挖出正在用的 prompt（避免抄一份然後漂移） */
function realPrompt(): string {
  const s = readFileSync(SRC, "utf8");
  const m = s.match(/const PERSONAL_SYSTEM_PROMPT = `([\s\S]*?)`;/);
  if (!m) throw new Error(`從 ${SRC} 抓不到 PERSONAL_SYSTEM_PROMPT`);
  return m[1];
}

/** 與 service 同形狀 */
const PersonalReportSchema = z.object({
  items: z.array(z.object({
    time: z.string().nullable(),
    title: z.string(),
    detail: z.string().nullable(),
    followup: z.string().nullable(),
    source_ids: z.array(z.number()),
  })),
});

/**
 * 客戶那天的情境（依他的描述重建 · 假名化）：
 * 4 趟，其中 #2 與 #4 同單位、同維修項目 —— 正是被併掉的那兩趟。
 */
const MESSAGES = process.env.PROBE_CASE === "future" ? [
  // 2026-09-01 · 驗證要跟客戶講的那句「會放在追蹤事項那一區」是不是真的
  "16:29 ○○廂型車對開門 (VW#XXXXX)-北部港區看實車 ⏎ 8/24 14:00 王○○、林○○、陳○○ ⏎ 任務：PE (確認料件) 是否 與 ○○ 雙開門 相符合？ 通用設計 可行性？",
] : [
  "11:24 桃園○○之家升降機電路檢修，手煞車微動開關未釋放導致升降機不過電，收費600元",
  "13:09 ○○福祉車JS 斜坡板更換左側鋼索",
  "13:41 新北○○電車 斜坡板更換右側鋼索，收費1000元",
  "14:57 ○○福祉車JS 斜坡板更換左側鋼索完成",
];

const main = async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 沒有 ANTHROPIC_API_KEY —— 停止（不然失敗會被誤判成 schema 問題）");
    process.exit(1);
  }
  const model = process.env.LLM_DEFAULT_MODEL?.trim() || "claude-opus-4-7";
  const prompt = realPrompt();

  // 先確認抓到的 prompt 真的是改過的那份 —— 抓錯了下面全部白測
  if (!prompt.includes("source_ids")) {
    console.error("❌ 從原始碼抓到的 prompt 裡沒有 source_ids —— 抓錯段落或還沒改到，停止");
    process.exit(2);
  }
  const unions = (JSON.stringify(zodOutputFormat(PersonalReportSchema))
    .match(/"anyOf"|"oneOf"|"enum"/g) ?? []).length;
  console.log(`模型：${model} · schema union 數：${unions}（上限 16）\n`);

  const blob = MESSAGES.map((t, i) => `#${i + 1} [${t.slice(0, 5)}] ${t.slice(6)}`).join("\n");
  const res = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.parse({
    model,
    max_tokens: 4000,
    system: [{ type: "text", text: prompt }],
    messages: [{ role: "user", content: `員工姓名：測試員\n日期：2026-08-31\n\n以下是 ${MESSAGES.length} 則訊息：\n${blob}` }],
    output_config: { format: zodOutputFormat(PersonalReportSchema) },
  });

  const items = (res.parsed_output as z.infer<typeof PersonalReportSchema>).items;
  console.log(`抽出 ${items.length} 項（原始 ${MESSAGES.length} 則）\n`);
  for (const [i, it] of items.entries()) {
    const src = it.source_ids ?? [];
    console.log(`${i + 1}. [${it.time ?? "—"}] ${it.title}`);
    console.log(`   detail  : ${it.detail ?? "(空)"}`);
    console.log(`   followup: ${it.followup ?? "(空)"}   ← 「追蹤事項」那一區`);
    console.log(`   source_ids=${JSON.stringify(src)}${src.length > 1 ? "  ← 合併了" : ""}`);
  }

  // ── 驗收 ─────────────────────────────────────────────
  const missing = items.filter((i) => !i.source_ids?.length).length;
  const bad = items.flatMap((i) => i.source_ids ?? [])
    .filter((n) => !Number.isInteger(n) || n < 1 || n > MESSAGES.length);
  console.log("\n── 驗收 ──");
  console.log(`${missing === 0 ? "✅" : "❌"} 每一項都有 source_ids（缺 ${missing} 項）`);
  console.log(`${bad.length === 0 ? "✅" : "❌"} 序號都在 1..${MESSAGES.length} 範圍內${bad.length ? `（越界：${bad}）` : ""}`);
  const merged = items.filter((i) => (i.source_ids ?? []).length > 1);
  console.log(merged.length
    ? `ℹ️  有 ${merged.length} 項是合併的 —— **現在看得出來了**，這就是這次要的效果`
    : "ℹ️  這次沒有合併（#2 #4 被分開了）");
  process.exit(missing === 0 && bad.length === 0 ? 0 : 1);
};

void main();
