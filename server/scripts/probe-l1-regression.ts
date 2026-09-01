/**
 * R12 回歸：往 L1 加了 `due_at` / `due_text` 之後，**既有欄位有沒有變差**？
 *
 * ⚠️ 這是 R12 的重點，也是最容易被跳過的一半。
 *    「新欄位有沒有填對」很好驗；「加了新欄位之後，category / status / person /
 *    source_ids 是不是還跟以前一樣準」才是真正的風險 ——
 *    prompt 變長、模型注意力被分散，舊欄位悄悄退步是常見的。
 *
 * ⚠️ schema 與 prompt **都直接從正式碼讀**，不在這裡抄一份：
 *    抄的那份會漂移，然後這支驗的就不是正在跑的東西。
 *
 * ⚠️ 這支會進公開 repo —— 測試資料一律假名化。
 *
 * 用法：
 *   cd server && npx tsx --env-file=../.env scripts/probe-l1-regression.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildAnalysisSchema } from "../src/conversation-analysis/pipeline/schemas.js";
import { TWH_TENANT } from "../src/conversation-analysis/pipeline/tenant-twh.js";

const MODEL = process.env.LLM_DEFAULT_MODEL?.trim() || "claude-opus-4-7";

/** 涵蓋既有欄位的各種情況 ＋ 兩種 due 情境 */
const MESSAGES = [
  "[2026-09-01 08:05] 林○○: 早上到廠，ST-01 工位開機正常",
  "[2026-09-01 09:12] 王○○: 示範車號A 升降機異音，先停用，我下午查",
  "[2026-09-01 10:30] 李○○: 9/1改裝日報 李○○ 示範車號A 斜坡板焊接 1.5h、內裝隔板 2h",
  "[2026-09-01 11:40] 王○○: 異音查到了，鋼索繞線鬆脫，已重新繞線並試車，恢復正常",
  "[2026-09-01 14:20] 陳○○: 9/8 10:00 要跟供應商開會確認鋼索交期，我跟林○○去",
  "[2026-09-01 15:05] 林○○: 下週三再把備料清單給我",
  "[2026-09-01 17:50] 蔡○○: 大家辛苦了 明天見",
];

const main = async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 沒有 ANTHROPIC_API_KEY —— 停止（不然失敗會被誤判成 schema 問題）");
    process.exit(1);
  }
  const schema = buildAnalysisSchema("factory_report");
  const unions = (JSON.stringify(zodOutputFormat(schema)).match(/"anyOf"|"oneOf"|"enum"/g) ?? []).length;
  // 先確認讀到的是改過的那份 —— 讀錯了下面全部白測
  if (!TWH_TENANT.systemPrompt.includes("due_at")) {
    console.error("❌ 正式的 system prompt 裡沒有 due_at —— 讀錯檔或還沒改到，停止");
    process.exit(2);
  }
  console.log(`模型：${MODEL} · union=${unions}/16\n`);

  const blob = MESSAGES.map((m, i) => `#${i + 1} ${m}`).join("\n");
  const res = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.parse({
    model: MODEL, max_tokens: 8000,
    system: [
      { type: "text", text: TWH_TENANT.systemPrompt },
      { type: "text", text: TWH_TENANT.masterDataJson },
    ],
    messages: [{ role: "user", content: `日期：2026-09-01\n\n以下是 ${MESSAGES.length} 則訊息：\n${blob}` }],
    output_config: { format: zodOutputFormat(schema) },
  });

  const out = res.parsed_output as {
    classifications: Array<{ id: number; category: string }>;
    records: Array<Record<string, unknown>>;
  };
  const cls = out.classifications ?? [];
  const recs = out.records ?? [];

  console.log(`分類 ${cls.length} 則 / 共 ${MESSAGES.length} 則 · records ${recs.length} 筆\n`);
  for (const r of recs) {
    console.log(`· [${r.category}] ${r.title}`);
    console.log(`  status=${r.status}  person=${r.person}  machine=${r.machine_code}  src=${JSON.stringify(r.source_ids)}`);
    console.log(`  due_at=${JSON.stringify(r.due_at)}  due_text=${JSON.stringify(r.due_text)}`);
  }

  // ── 驗收 ─────────────────────────────────────────────
  const checks: Array<[boolean, string]> = [
    [cls.length === MESSAGES.length, `分類覆蓋率 100%（${cls.length}/${MESSAGES.length}）—— R12：不可下降`],
    [recs.length >= 3, `records 至少 3 筆（實際 ${recs.length}）`],
    [recs.every((r) => typeof r.due_at === "string"), "每筆都有 due_at（不可為 null/undefined）"],
    [recs.every((r) => typeof r.due_text === "string"), "每筆都有 due_text"],
    [recs.every((r) => Array.isArray(r.source_ids) && (r.source_ids as unknown[]).length > 0),
      "既有欄位沒退步：source_ids 每筆都有"],
    [recs.some((r) => r.person !== null), "既有欄位沒退步：至少一筆對到 person"],
    [recs.some((r) => r.machine_code !== null || r.work_order !== null),
      "既有欄位沒退步：至少一筆對到工位或工單"],
    [recs.some((r) => r.status === "resolved"), "既有欄位沒退步：異音修好那筆要是 resolved"],
    // 未來安排：#5 明確日期 → 要抓到
    [recs.some((r) => typeof r.due_at === "string" && r.due_at.startsWith("2026-09-08")),
      "9/8 開會那筆抓到 due_at"],
    // R11：#6「下週三」不可換算
    [!recs.some((r) => typeof r.due_text === "string" && r.due_text.includes("下週三")
      && typeof r.due_at === "string" && r.due_at !== ""),
      "「下週三」沒有被自行換算成日期（R11）"],
    // 已完成的事不可以被塞日期
    [recs.filter((r) => r.status === "resolved").every((r) => r.due_at === ""),
      "已完成的記錄 due_at 留空"],
  ];
  console.log("\n── 驗收 ──");
  let pass = 0;
  for (const [ok, label] of checks) { console.log(`${ok ? "✅" : "❌"} ${label}`); if (ok) pass++; }
  console.log(`\n${pass}/${checks.length} 通過`);
  process.exit(pass === checks.length ? 0 : 1);
};

void main();
