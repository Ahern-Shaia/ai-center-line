/**
 * calendar-sync M3 的 **gate**：`due_at` 實際抽得到多少？
 *
 * 為什麼需要這支：`due_at` 抽到的比例太低的話，「今日預定」區塊永遠是空的，
 * 那就是交付一個空區塊（doc F-8）—— 此時要先改抽取，不要急著做 M4 前端。
 *
 * ⚠️⚠️ **不可以直接去 prod 的 analysis_result 數 due_at**：
 *    現有的 records 全都是**舊 prompt** 產出的，裡面根本沒有 due_at 這個 key。
 *    量出來一定是 0%，但那個 0% 的意思是「還沒跑過」不是「抽不到」。
 *    拿它當 gate 判準，紅燈綠燈的原因都會是「什麼都沒跑到」。
 *    所以這支是**拿真實訊息重跑一次新 prompt**，不是查現成欄位。
 *
 * ⚠️⚠️ **分母不可以用「全部 records」**。真實對話裡本來就大部分沒有未來安排，
 *    用全部當分母，抽得再準看起來都很低，然後就會去「修」一個沒壞的東西。
 *    要看的是 **抽到的 ÷ 應該抽到的**。這支用關鍵詞粗篩出「這批訊息裡有幾則
 *    長得像在講未來日期」當對照組，兩個數字一起看。
 *    ⚠️ 粗篩只是**對照**不是真相 —— 它會多抓（「8/24 已完成」也含日期）。
 *       所以低於預期時要人去看逐筆明細，不要只看百分比。
 *
 * ⚠️ **prompt 走正式的 `analyzeSegment()`**，不在這裡自己拼一份呼叫。
 *    第一版我自己拼 blob，格式是 `#序號 內容` —— 少了正式管線的 `[日期 時間] 發話者`，
 *    模型連相對日期都算不出來，量出來的比例偏低而且量的不是正在跑的東西。
 *    ⚠️ 與 prod 唯一的差異：不注入 knownCategories / 人名 / 客戶主檔
 *       （那些影響分類與人名對應，不影響 due_at 判讀）。
 *
 * ⚠️ **唯讀**。不寫 analysis_result、不寫 tickets、不寫任何東西。
 *    R10：它會連 prod，所以由人執行，我只產指令。
 *
 * ⚠️ 輸出會含**真實對話內容與人名**。看完就好，**不要把輸出貼進任何檔案或
 *    貼回對話**（repo 是 public，test/no-real-customer-names.test.ts 擋的就是這個）。
 *
 * 用法（由人在本機對 prod 跑）：
 *   cd server && DATABASE_URL='<prod 連線字串>' \
 *     npx tsx --env-file=../.env scripts/gate-due-at-rate.ts [取樣批數，預設 8]
 */
import { Pool } from "pg";
import { analyzeSegment } from "../src/conversation-analysis/pipeline/classify.js";
import { TWH_TENANT } from "../src/conversation-analysis/pipeline/tenant-twh.js";
// ⚠️ 用正式的 defaultAnthropicProvider()，不要自己呼叫 createLLMProvider() ——
//    第一版我沒帶 config 直接炸（factory 需要 provider/model/apiKey）。
//    ⚠️ 這是**平台預設**（env LLM_DEFAULT_MODEL）。若某租戶另設了 llm-config，
//       正式跑的模型會跟這裡不同 —— 量到的比例要照這個前提解讀。
import { defaultAnthropicProvider } from "../src/conversation-analysis/pipeline/index.js";
import { platformDefaultModel } from "../src/llm/provider.factory.js";
import { parseDueAt } from "../src/warroom-task-board/due-at.js";
import type { ChatMessage } from "../src/conversation-analysis/pipeline/parser.js";

const SAMPLE = Number(process.argv[2] ?? 8);

/**
 * 粗篩「這則看起來在講日期」。
 * ⚠️ 這是**對照組**不是答案：它會多抓（講過去的日期也算）。
 *    它回答的是「這批對話裡到底有沒有東西可抽」，不是「這則該不該有 due_at」。
 */
const LOOKS_DATED =
  /(\d{1,2})\s*[/月]\s*(\d{1,2})|下週|下星期|下禮拜|本週|這週|明天|後天|月底|月初|下個?月|週[一二三四五六日天]|星期[一二三四五六日天]/;

const main = async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("❌ 缺 ANTHROPIC_API_KEY"); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error("❌ 缺 DATABASE_URL"); process.exit(1); }
  // 讀到的必須是改過的那份 prompt，否則下面全部白測
  if (!TWH_TENANT.systemPrompt.includes("due_at")) {
    console.error("❌ 正式 system prompt 裡沒有 due_at —— 還沒 M2 或讀錯檔，停止");
    process.exit(2);
  }
  // ⚠️⚠️ 沒設就會退回 factory 的 fallback（claude-opus-4-7），
  //    而 prod 是用 env LLM_DEFAULT_MODEL 指定的模型 ——
  //    量到的就會是**prod 不會用的模型**的抽取率。不會報錯，數字看起來也很正常。
  //    要對 prod 做決策，就得用 prod 的模型。
  if (!process.env.LLM_DEFAULT_MODEL?.trim()) {
    console.error("❌ 沒設 LLM_DEFAULT_MODEL —— 會退回 fallback，量到的不是 prod 用的模型。");
    console.error("   先去 Render 的環境變數看 prod 設的是哪一個，然後：");
    console.error("   LLM_DEFAULT_MODEL='<prod 的值>' DATABASE_URL='...' npx tsx ... ");
    process.exit(5);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  // ⚠️ 表名／欄名都是查過 information_schema 的，不是憑印象：
  //    訊息存在 `analysis_result.messages`（不是 analysis_upload），
  //    upload 的主鍵是 `id`（不是 upload_id），日期欄是 `batch_date`（不是 report_date）。
  // ⚠️ analysis_upload / analysis_result 沒開 RLS —— 這支讀得到全部租戶，量測用途可接受。
  const { rows } = await pool.query<{
    upload_id: number; tenant_slug: string | null; batch_date: string | null; messages: unknown;
  }>(
    `SELECT ar.upload_id, au.tenant_slug, au.batch_date::text, ar.messages
       FROM analysis_result ar
       JOIN analysis_upload au ON au.id = ar.upload_id
      WHERE ar.messages IS NOT NULL AND jsonb_array_length(ar.messages) > 0
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

  let recTotal = 0, withDue = 0, parsedOk = 0, datedMsgs = 0, msgTotal = 0;
  // ⚠️ M3.5（一則訊息排多天就拆成多筆）之後，「抽到的 ÷ 看起來有日期的訊息數」
  //    會超過 100% —— 一則訊息可以生 7 筆記錄，分母裡卻只算 1 則。
  //    所以另外算**逐訊息覆蓋率**：粗篩認為在講日期的訊息，有幾則至少產出一筆 due_at。
  //    這個數字有上限、看得懂，才是能拿來判斷的那個。
  let datedCovered = 0;
  const detail: string[] = [];

  for (const r of rows) {
    // 存下來的就是 ChatMessage ＋ category/confidence（pipeline/index.ts EnrichedMessage）
    const msgs = ((r.messages as ChatMessage[] | null) ?? []).filter((m) => m.kind === "text" && m.text);
    if (msgs.length === 0) continue;
    msgTotal += msgs.length;
    datedMsgs += msgs.filter((m) => LOOKS_DATED.test(m.text)).length;

    const { result } = await analyzeSegment(provider, "（量測）", msgs, TWH_TENANT);
    const recs = result.records ?? [];
    recTotal += recs.length;
    for (const rec of recs) {
      const raw = typeof rec.due_at === "string" ? rec.due_at.trim() : "";
      if (raw === "") continue;
      withDue++;
      const parsed = parseDueAt(raw);
      if (parsed) parsedOk++;
      detail.push(
        `  upload=${r.upload_id}(${r.tenant_slug ?? "?"} ${r.batch_date ?? "?"}) `
        + `${parsed ? "✅" : "⚠️ 解析不了"} due_at=${JSON.stringify(raw)} `
        + `due_text=${JSON.stringify(rec.due_text)} · ${String(rec.title).slice(0, 30)}`,
      );
    }
  }

  console.log(`訊息 ${msgTotal} 則 · 其中「看起來在講日期」${datedMsgs} 則（粗篩，會多抓）`);
  console.log(`records ${recTotal} 筆 · 抽到 due_at ${withDue} 筆 · 其中解析得出來 ${parsedOk} 筆\n`);
  console.log("逐筆（⚠️ 含真實內容，不要外流）：");
  console.log(detail.length ? detail.join("\n") : "  （一筆都沒有）");

  // ── gate 判準 ──────────────────────────────────────
  console.log("\n── gate ──");
  if (datedMsgs === 0) {
    console.log("⚠️ 這批對話裡連粗篩都找不到日期 —— **不能下結論**。");
    console.log("   換一段時間或多取幾批再跑。0% 的原因是沒東西可抽，不是抽不到。");
    await pool.end();
    process.exit(4);
  }
  console.log(`⭐ **逐訊息覆蓋率**：粗篩認為在講日期的 ${datedMsgs} 則裡，`
    + `有 ${datedCovered} 則至少產出一筆 due_at ＝ ${((datedCovered / datedMsgs) * 100).toFixed(0)}%`);
  console.log("（粗篩會多抓「8/24 已完成」這種過去式，所以不必追到 100%）");
  console.log(`   參考：due_at 總筆數 ${withDue} 筆。⚠️ **這個數字不要拿來除**——`);
  console.log("   M3.5 之後一則訊息會拆成多筆，除出來會超過 100%，沒有意義。");
  if (parsedOk < withDue) {
    console.log(`❌ 有 ${withDue - parsedOk} 筆模型填了但解析不出來 —— 先修 prompt 的格式要求，這是白丟的`);
  }
  console.log(withDue === 0
    ? "\n❌ 一筆都沒抽到 → **不要進 M4**。先改抽取，否則「今日預定」永遠是空區塊（F-8）。"
    : "\n✅ 抽得到東西 → 可以進 M4；但上面的逐筆要人看過，確認抽的是真的未來安排。");
  await pool.end();
};

void main();
