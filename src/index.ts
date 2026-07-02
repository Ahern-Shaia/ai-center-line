import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { parseLineExport, segmentMessages } from "./parser.js";
import { analyzeSegment, addUsage, emptyUsage } from "./classify.js";
import { renderReport, type EnrichedMessage } from "./report.js";
import type { AnalysisResultT, Category } from "./schemas.js";

function loadDotEnv(): void {
  try {
    const raw = fs.readFileSync(".env", "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // 沒有 .env 就略過
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("錯誤：找不到 ANTHROPIC_API_KEY。請設定環境變數，或在專案根目錄建立 .env：");
    console.error("  ANTHROPIC_API_KEY=sk-ant-...");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const files =
    args.length > 0
      ? args
      : fs
          .readdirSync("samples")
          .filter((f) => f.endsWith(".txt"))
          .map((f) => path.join("samples", f))
          .sort();

  const client = new Anthropic();
  fs.mkdirSync("output", { recursive: true });

  const grandTotal = emptyUsage();

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const { groupName, messages } = parseLineExport(raw);
    const segments = segmentMessages(messages);
    console.log(`\n=== ${groupName}（${file}）：${messages.length} 則訊息 → ${segments.length} 個會話段 ===`);

    const catMap = new Map<number, { category: Category; confidence: string }>();
    const dailyReports: AnalysisResultT["daily_reports"] = [];
    const records: AnalysisResultT["records"] = [];
    const usage = emptyUsage();

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      process.stdout.write(`  會話段 ${i + 1}/${segments.length}（${seg.length} 則）分析中... `);
      const { result, usage: u } = await analyzeSegment(client, groupName, seg);
      for (const c of result.classifications) {
        catMap.set(c.id, { category: c.category, confidence: c.confidence });
      }
      dailyReports.push(...result.daily_reports);
      records.push(...result.records);
      addUsage(usage, u);
      console.log(
        `完成（input ${u.inputTokens}｜cache寫 ${u.cacheWriteTokens}｜cache讀 ${u.cacheReadTokens}｜output ${u.outputTokens}）`,
      );
    }

    const enriched: EnrichedMessage[] = messages.map((m) => ({
      ...m,
      category: catMap.get(m.id)?.category ?? null,
      confidence: catMap.get(m.id)?.confidence ?? null,
    }));

    const unclassified = enriched.filter((m) => m.category === null).length;
    if (unclassified > 0) {
      console.warn(`  警告：有 ${unclassified} 則訊息未被分類`);
    }

    const base = path.basename(file, ".txt");
    const jsonPath = path.join("output", `${base}.json`);
    const htmlPath = path.join("output", `${base}.html`);
    const data = { groupName, sourceFile: file, messages: enriched, dailyReports, records, usage };
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    fs.writeFileSync(htmlPath, renderReport(data));
    console.log(`  → 結構化日報 ${dailyReports.length} 筆、其他記錄 ${records.length} 筆`);
    console.log(`  → 輸出：${jsonPath}、${htmlPath}`);

    addUsage(grandTotal, usage);
  }

  console.log(
    `\n總計：${grandTotal.calls} 次 API 呼叫｜input ${grandTotal.inputTokens}｜cache寫 ${grandTotal.cacheWriteTokens}｜cache讀 ${grandTotal.cacheReadTokens}｜output ${grandTotal.outputTokens} tokens`,
  );
  if (grandTotal.cacheReadTokens === 0 && grandTotal.calls > 1) {
    console.log(
      "提示：cache 讀取為 0。Opus 4.7 的最小可快取前綴為 4096 tokens，系統提示＋主檔若未達門檻則不會建立快取；正式版主檔（完整機台/人員/工單/詞庫）會遠超過此門檻。",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
