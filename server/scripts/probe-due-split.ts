/**
 * 驗「一則訊息排了多天 → 拆成多筆記錄」（calendar-sync M3.5）。
 *
 * 起因：2026-09-01 對 prod 真實資料跑 gate-due-at-rate.ts，7 筆抽到 due_at 裡有 2 筆是
 *      排程訊息，各自含 7 個和 4 個日期，但 `due_at` 只放得下第一個 ——
 *      模型明明把整串都寫進 due_text 了，我們的欄位放不下。
 *      9/4、9/7、9/9、9/10、9/16 那幾天的「今日預定」會是空的（F-1）。
 *      這不是抽取失敗，是資料形狀不對。
 *
 * ⚠️ 這是型別檢查與單元測試**都驗不到**的東西：它是模型行為。
 * ⚠️ 這支會進公開 repo —— 公司名／人名一律假名化。
 *
 * 用法：
 *   cd server && LLM_DEFAULT_MODEL='<prod 的值>' \
 *     npx tsx --env-file=.env --env-file=../.env scripts/probe-due-split.ts
 */
import { analyzeSegment } from "../src/conversation-analysis/pipeline/classify.js";
import { TWH_TENANT } from "../src/conversation-analysis/pipeline/tenant-twh.js";
import { defaultAnthropicProvider } from "../src/conversation-analysis/pipeline/index.js";
import { platformDefaultModel } from "../src/llm/provider.factory.js";
import { parseDueAt } from "../src/warroom-task-board/due-at.js";
import type { ChatMessage } from "../src/conversation-analysis/pipeline/parser.js";

const D = "2026-09-01";
const msg = (id: number, time: string, sender: string, text: string): ChatMessage =>
  ({ id, date: D, time, sender, text, kind: "text" });

const MESSAGES: ChatMessage[] = [
  // ① 本體：一則排了 6 天（真實案例的形狀，公司名假名化）
  msg(1, "10:12", "林○○",
    "9月排程 9/2 示範拖車行A拖車、9/4 拍照、9/4下午 示範拖車行B拖車、9/7下午 示範拖車行B拖車、9/10 交車、9/16 拖車"),
  // ② 對照：單一日期不可以被拆
  msg(2, "11:05", "王○○", "10/2 前要提供結案報告"),
  // ③ 對照：已完成的事提到多個日期，不可以拆也不可以有 due_at
  msg(3, "14:30", "陳○○", "8/25 和 8/28 的兩台升降機檢修都已完成，收費已請款"),
  // ④ 對照：模糊日期不可以自己換算
  msg(4, "15:40", "蔡○○", "下週三再跟客戶確認斜坡板規格"),
  // ⑤ 對照：算得出唯一答案的相對詞**可以**換算（上面給了日期 2026-09-01）
  msg(5, "16:20", "林○○", "明天下午要去客戶端交車"),
  // ⑥ 對照：要用猜的不可以換算
  msg(6, "16:45", "王○○", "月底前把備料清單給我"),
];

const main = async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("❌ 缺 ANTHROPIC_API_KEY"); process.exit(1); }
  if (!process.env.LLM_DEFAULT_MODEL?.trim()) {
    console.error("❌ 沒設 LLM_DEFAULT_MODEL —— 會退回 fallback，量到的不是 prod 用的模型");
    process.exit(5);
  }
  // 讀到的必須是加了拆分規則的那份 prompt，不然下面全部白測
  if (!TWH_TENANT.systemPrompt.includes("一筆記錄只能有一個日期")) {
    console.error("❌ 正式 prompt 裡沒有拆分規則 —— 讀錯檔或還沒改到，停止");
    process.exit(2);
  }
  console.log(`模型：${platformDefaultModel()}\n`);

  const { result } = await analyzeSegment(defaultAnthropicProvider(), "（量測）", MESSAGES, TWH_TENANT);
  const recs = result.records ?? [];

  for (const r of recs) {
    console.log(`· src=${JSON.stringify(r.source_ids)} due_at=${JSON.stringify(r.due_at)} `
      + `due_text=${JSON.stringify(r.due_text)} · ${r.title}`);
  }

  const from1 = recs.filter((r) => (r.source_ids ?? []).includes(1));
  const dates1 = new Set(from1.map((r) => parseDueAt(r.due_at)).filter((d): d is string => !!d));
  const from3 = recs.filter((r) => (r.source_ids ?? []).includes(3));
  const from4 = recs.filter((r) => (r.source_ids ?? []).includes(4));
  const from5 = recs.filter((r) => (r.source_ids ?? []).includes(5));
  const from6 = recs.filter((r) => (r.source_ids ?? []).includes(6));

  const want = ["2026-09-02", "2026-09-04", "2026-09-07", "2026-09-10", "2026-09-16"];
  const got = want.filter((d) => [...dates1].some((x) => x.startsWith(d)));

  const checks: Array<[boolean, string]> = [
    [from1.length >= 5, `#1 拆成多筆（實際 ${from1.length} 筆，至少要 5）`],
    [got.length >= 5, `#1 的日子都各自成一筆：${got.length}/5（缺 ${want.filter((d) => !got.includes(d)).join("、") || "無"}）`],
    [from1.every((r) => (r.source_ids ?? []).includes(1)),
      "拆出來的每一筆都指得回原訊息（R11 可溯源）"],
    [from1.every((r) => (r.due_text ?? "").length <= 12),
      "due_text 只寫自己那一筆的原文，沒把整串日期抄進每一筆"],
    // 對照組 —— 沒有這幾條的話，「全部都拆」也會通過上面
    [recs.filter((r) => (r.source_ids ?? []).includes(2)).length === 1,
      "對照：單一日期的 #2 不可以被拆（實際 "
        + recs.filter((r) => (r.source_ids ?? []).includes(2)).length + " 筆）"],
    [from3.every((r) => !r.due_at || r.due_at.trim() === ""),
      "對照：已完成的 #3 提到兩個日期，但不可以有 due_at"],
    [from3.length <= 1, `對照：已完成的 #3 不可以被拆成多筆（實際 ${from3.length} 筆）`],
    [from4.every((r) => !r.due_at || r.due_at.trim() === ""),
      "對照：「下週三」不可自行換算（R11）"],
    // ⚠️ 分界是「算得出唯一答案」還是「要用猜的」，不是「有沒有相對詞」
    [from5.length > 0 && from5.some((r) => parseDueAt(r.due_at)?.startsWith("2026-09-02")),
      "對照：「明天」算得出唯一答案 → 應換算成 2026-09-02"],
    [from6.every((r) => !r.due_at || r.due_at.trim() === ""),
      "對照：「月底前」要用猜的 → 不可換算"],
  ];

  console.log("\n── 驗收 ──");
  let pass = 0;
  for (const [ok, label] of checks) { console.log(`${ok ? "✅" : "❌"} ${label}`); if (ok) pass++; }
  console.log(`\n${pass}/${checks.length} 通過`);
  process.exit(pass === checks.length ? 0 : 1);
};

void main();
