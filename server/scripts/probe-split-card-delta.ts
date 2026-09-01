/**
 * 量「拆分規則（M3.5）會讓任務看板多出幾張卡」。
 *
 * 為什麼要量：台灣福祉現在已經有 211 張待簽核、其中 205 張逾時 ——
 * 拆分是打在一個**已經沒人在清**的佇列上。加成太大的話，
 * 「今日預定」的信號會被自己製造的卡片淹掉。
 *
 * ⚠️ 「改前」不必再打一次 API：prod 的 `analysis_result.records` 就是舊 prompt
 *    對**同一批訊息**跑出來的結果 —— 那才是客戶現在真的看到的卡片數。
 *    所以只跑 30 次新 prompt，不是 60 次。
 *    ⚠️ 但要知道這個差額**同時含 M2（加 due_at 欄位）和 M3.5（拆分）兩者**的影響。
 *       所以下面另外算「其中有多少是拆分造成的」：同一批裡 source_ids 完全相同、
 *       且各自都有 due_at 的多筆記錄 —— 那就是拆出來的。
 *
 * ⚠️ 數的是**卡片**不是 records。laneFor() 會擋掉低信心與中信心的公告，
 *    直接數 records 會高估（本專案的判準只寫在 ticket-lane.ts，不在這裡抄一份）。
 *
 * ⚠️ **唯讀**。不寫 analysis_result、不寫 tickets。
 *    R10：會連 prod，由人執行。
 *
 * ⚠️ 輸出含真實對話衍生的標題 —— 看完就好，不要貼進任何檔案（repo 是 public）。
 *
 * 用法：
 *   cd server && LLM_DEFAULT_MODEL='<prod 的值>' DATABASE_URL='<prod>' \
 *     npx tsx --env-file=.env --env-file=../.env scripts/probe-split-card-delta.ts [批數，預設 30]
 */
import { Pool } from "pg";
import { analyzeSegment } from "../src/conversation-analysis/pipeline/classify.js";
import { TWH_TENANT } from "../src/conversation-analysis/pipeline/tenant-twh.js";
import { defaultAnthropicProvider } from "../src/conversation-analysis/pipeline/index.js";
import { platformDefaultModel } from "../src/llm/provider.factory.js";
import { laneFor } from "../src/warroom-task-board/ticket-lane.js";
import { parseDueAt } from "../src/warroom-task-board/due-at.js";
import type { ChatMessage } from "../src/conversation-analysis/pipeline/parser.js";

const SAMPLE = Number(process.argv[2] ?? 30);

type Rec = { confidence?: string; status?: string | null; title?: string; due_at?: string; source_ids?: number[] };

/**
 * 幾筆 records 會變成卡片，**依分區拆開**。
 *
 * ⚠️ 只報總卡片數會誤導：「存查」（公告／已完成）也是卡片，但它**不進簽核佇列** ——
 *    而使用者關心的 211 張／205 張逾時全都是「待簽核」。
 *    拆分多出來的卡如果都落在存查，對那個佇列就是零影響；落在待簽核才是壓力。
 */
function lanesOf(recs: Rec[]): { total: number; 待簽核: number; 待確認: number; 存查: number } {
  const out = { total: 0, 待簽核: 0, 待確認: 0, 存查: 0 };
  for (const r of recs) {
    const lane = laneFor(r.confidence, r.status ?? null);
    if (!lane) continue;
    out.total++;
    if (lane === "待簽核" || lane === "待確認" || lane === "存查") out[lane]++;
  }
  return out;
}

const main = async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("❌ 缺 ANTHROPIC_API_KEY"); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error("❌ 缺 DATABASE_URL"); process.exit(1); }
  if (!process.env.LLM_DEFAULT_MODEL?.trim()) {
    console.error("❌ 沒設 LLM_DEFAULT_MODEL —— 會退回 fallback，量到的不是 prod 用的模型");
    process.exit(5);
  }
  if (!TWH_TENANT.systemPrompt.includes("一筆記錄只能有一個日期")) {
    console.error("❌ 正式 prompt 裡沒有拆分規則 —— 讀錯檔或還沒改到，停止");
    process.exit(2);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  const { rows } = await pool.query<{
    upload_id: number; batch_date: string | null; messages: unknown; records: unknown;
  }>(
    `SELECT ar.upload_id, au.batch_date::text, ar.messages, ar.records
       FROM analysis_result ar
       JOIN analysis_upload au ON au.id = ar.upload_id
      WHERE ar.messages IS NOT NULL AND jsonb_array_length(ar.messages) > 0
        AND ar.records IS NOT NULL
      ORDER BY ar.upload_id DESC
      LIMIT $1`,
    [SAMPLE],
  );
  if (rows.length === 0) {
    console.error("❌ 取樣 0 批 —— 條件有問題或連錯庫，停止（不要把 0 當成結論）");
    process.exit(3);
  }

  const provider = defaultAnthropicProvider();
  console.log(`模型：${platformDefaultModel()} · 取樣 ${rows.length} 批\n`);

  const B = { total: 0, 待簽核: 0, 待確認: 0, 存查: 0 };
  const A = { total: 0, 待簽核: 0, 待確認: 0, 存查: 0 };
  let beforeRecs = 0, afterRecs = 0, splitExtra = 0, batchesWithSplit = 0;
  const lines: string[] = [];

  for (const r of rows) {
    const msgs = ((r.messages as ChatMessage[] | null) ?? []).filter((m) => m.kind === "text" && m.text);
    if (msgs.length === 0) continue;
    const before = (r.records as Rec[] | null) ?? [];

    const { result } = await analyzeSegment(provider, "（量測）", msgs, TWH_TENANT);
    const after = (result.records ?? []) as Rec[];

    // 拆出來的：同一批裡 source_ids 完全相同、且各自都有可解析的 due_at 的多筆
    const byKey = new Map<string, number>();
    for (const rec of after) {
      if (!parseDueAt(rec.due_at)) continue;
      const k = JSON.stringify([...(rec.source_ids ?? [])].sort((a, b) => a - b));
      byKey.set(k, (byKey.get(k) ?? 0) + 1);
    }
    const extra = [...byKey.values()].reduce((s, n) => s + Math.max(0, n - 1), 0);
    if (extra > 0) batchesWithSplit++;
    splitExtra += extra;

    const b = lanesOf(before), a = lanesOf(after);
    for (const k of ["total", "待簽核", "待確認", "存查"] as const) { B[k] += b[k]; A[k] += a[k]; }
    const bc = b.total, ac = a.total;
    beforeRecs += before.length; afterRecs += after.length;
    lines.push(`  upload=${String(r.upload_id).padStart(4)} (${r.batch_date}) `
      + `卡片 ${String(bc).padStart(2)} → ${String(ac).padStart(2)}`
      + (extra > 0 ? `   ← 其中拆分多出 ${extra}` : ""));
  }

  console.log(lines.join("\n"));

  // ⚠️ 自我檢查：before 全 0 的話下面的百分比是假的
  if (B.total === 0) {
    console.error("\n❌ 現況卡片數是 0 —— records 讀不到或 laneFor 判準對不上，"
      + "不要拿下面的數字下結論。");
    await pool.end();
    process.exit(4);
  }

  const pct = (n: number, d: number) => `${((n / d - 1) * 100).toFixed(0)}%`;
  console.log("\n── 合計 ──");
  console.log(`records   ${beforeRecs} → ${afterRecs}（${pct(afterRecs, beforeRecs)}）`);
  console.log(`卡片合計  ${B.total} → ${A.total}（${pct(A.total, B.total)}）`);
  console.log(`  ├ **待簽核**（會進簽核佇列 · 就是那 211 張）  ${B.待簽核} → ${A.待簽核}`
    + (B.待簽核 ? `（${pct(A.待簽核, B.待簽核)}）` : ""));
  console.log(`  ├ 待確認（主管定奪）                        ${B.待確認} → ${A.待確認}`);
  console.log(`  └ 存查（公告／已完成 · **不進佇列**）        ${B.存查} → ${A.存查}`);
  console.log(`其中拆分造成的額外卡片：${splitExtra} 張，出現在 ${batchesWithSplit}/${rows.length} 批`);
  console.log(`（差額同時含 M2 加欄位與 M3.5 拆分兩者；上面這一行只算拆分那部分）`);

  console.log("\n── 換算到台灣福祉現況 ──");
  const ratio = B.待簽核 ? A.待簽核 / B.待簽核 : 1;
  console.log(`目前 211 張待簽核 · 205 張逾時。`);
  console.log(`若照**待簽核**這一區的比例：211 → 約 ${Math.round(211 * ratio)} 張`);
  console.log(`⚠️ 這是**外推**不是量測：取樣批次不等於全部歷史，而且既有卡片不會被重跑`);
  console.log(`   （舊 records 沒有 due_at，重跑材料化也拆不出來）——`);
  console.log(`   真正會長的是**今後**的新批次。這個數字看的是「每天多幾張」的量級。`);
  await pool.end();
};

void main();
