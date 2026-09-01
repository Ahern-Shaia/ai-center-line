/**
 * 決策用探測：`due_at` 設成**不可空**（抽不到給 `""`），模型會乖乖照做嗎？
 *
 * 背景：2026-09-01 量到 Anthropic 的 16 union 上限數的是產生出來的 JSON Schema 裡的
 *      anyOf/enum，**不可空欄位是 0 成本**（scripts/probe-union-limit.ts）。
 *      所以「兩個新欄位都不可空」= 15 = 跟現況一樣，
 *      `factory_report` 根本不必瘦身（省下改 4 處顯示點 + 哨兵值 -1 的風險）。
 *
 * ⚠️ 但這個省法有一個前提要驗：**R11 是「抽不到一律 null，禁止臆測」**。
 *    改成不可空之後，模型會不會為了「一定要填」而**編一個日期出來**？
 *    那比沒有這個功能更糟 —— 使用者會在錯的日子出現在錯的地方（FMEA F-1，P0）。
 *
 * ⭐ 這是型別檢查與單元測試**都驗不到**的東西：它是模型行為，不是型別。
 *
 * ⚠️ 這支會進公開 repo —— 測試資料一律**假名化**（車型／車號／人名都不可以是真的）。
 *
 * 用法：
 *   cd server && npx tsx --env-file=../.env scripts/probe-due-nonnullable.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const MODEL = process.env.LLM_DEFAULT_MODEL?.trim() || "claude-opus-4-7";

const Schema = z.object({
  items: z.array(z.object({
    time: z.string().nullable(),
    title: z.string(),
    detail: z.string().nullable(),
    followup: z.string().nullable(),
    source_ids: z.array(z.number()),
    /** ISO 日期或日期時間；**抽不到給空字串**，不可為 null（省 union 額度） */
    due_at: z.string(),
    /** 原文寫法（「下週三」「月底前」）；沒有就給空字串 */
    due_text: z.string(),
  })),
});

const PROMPT = `你是專業日報整理助手。把員工當日私訊整理成結構化日報。

每則訊息前面都有編號「#N」。每一項都必須填 source_ids。

關於 due_at / due_text —— **這兩欄是給行事曆用的，填錯比留空更糟**：
· due_at：訊息裡有明確講到「未來要做這件事」的日期時，填 ISO 格式（YYYY-MM-DD 或 YYYY-MM-DDTHH:mm）。
· due_text：填原文的寫法（例：「8/24 14:00」「下週三」「月底前」）。
· ⚠️ **沒有講到未來日期就兩欄都填空字串 ""**。
· ⚠️ **絕對不可以自己換算或臆測**。「下週三」不知道是幾號就 due_at 填 ""、due_text 填「下週三」。
· ⚠️ 訊息在描述**已經做完的事**（不是未來的安排）時，也是兩欄都填 ""。

輸出 JSON：
{ "items": [ { "time": "08:30", "title": "…", "detail": "…", "followup": null,
               "source_ids": [1], "due_at": "", "due_text": "" } ] }`;

/** 每個案例都標好「正確答案應該是什麼」 */
const CASES: Array<{ name: string; msg: string; expectDue: "有" | "空"; why: string }> = [
  { name: "明確未來日期＋時間", expectDue: "有", why: "這正是客戶的情境",
    msg: "○○廂型車對開門(VW#XXXXX)-北部港區看實車 ⏎ 8/24 14:00 王○○、林○○、陳○○ ⏎ 任務：PE確認料件" },
  { name: "只有日期沒時間", expectDue: "有", why: "應該是整天事件",
    msg: "9/3 送 ○○樣車回原廠" },
  { name: "純粹今天做完的事", expectDue: "空", why: "已完成，不是未來安排 —— 最容易被誤填",
    msg: "桃園仁愛之家升降機電路檢修完成，手煞車微動開關未釋放，收費600元" },
  { name: "模糊時間詞", expectDue: "空", why: "R11：不可換算「下週三」",
    msg: "下週三要再跟客戶確認斜坡板規格" },
  { name: "完全沒有時間資訊", expectDue: "空", why: "最基本的情況",
    msg: "跟 陳○○ 討論備料組物料清單的耗損率計算方式" },
];

const main = async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 沒有 ANTHROPIC_API_KEY —— 停止");
    process.exit(1);
  }
  const unions = (JSON.stringify(zodOutputFormat(Schema)).match(/"anyOf"|"oneOf"|"enum"/g) ?? []).length;
  console.log(`模型：${MODEL} · 這個 schema 的 union 數：${unions}\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let pass = 0;
  for (const c of CASES) {
    const res = await client.messages.parse({
      model: MODEL, max_tokens: 2000,
      system: [{ type: "text", text: PROMPT }],
      messages: [{ role: "user", content: `員工姓名：測試員\n日期：2026-08-31\n\n以下是 1 則訊息：\n#1 [16:29] ${c.msg}` }],
      output_config: { format: zodOutputFormat(Schema) },
    });
    const items = (res.parsed_output as z.infer<typeof Schema>).items;
    const due = items.map((i) => i.due_at).filter((d) => d && d.trim() !== "");
    const txt = items.map((i) => i.due_text).filter((d) => d && d.trim() !== "");
    const got: "有" | "空" = due.length > 0 ? "有" : "空";
    const ok = got === c.expectDue;
    if (ok) pass++;
    console.log(`${ok ? "✅" : "❌"} ${c.name.padEnd(12)} 期望=${c.expectDue}  實際=${got}`);
    console.log(`     due_at=${JSON.stringify(due)}  due_text=${JSON.stringify(txt)}`);
    console.log(`     （${c.why}）`);
  }
  console.log(`\n── ${pass}/${CASES.length} 通過 ──`);
  console.log(pass === CASES.length
    ? "✅ 不可空 + 空字串可行 → **不需要瘦身 factory_report**，M1 可以跳過"
    : "❌ 模型會臆測或漏填 → 維持 due_at 可空，`factory_report` 得先瘦身（原 OQ-CAL-11 裁定）");
  process.exit(pass === CASES.length ? 0 : 1);
};

void main();
