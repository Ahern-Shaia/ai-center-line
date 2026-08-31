/**
 * 個人日報的可溯源（R11）—— 逐層釘住。
 *
 * 起因：2026-08-31 客戶問「今天 4 個行程，2 跟 4 同單位、維修項目也一樣，
 *      系統會合併在一起，可以分別顯示嗎？」
 *      查下去發現個人日報的項目**沒有 source_ids** ——
 *      我們沒有任何辦法查出某一項到底併了哪幾則訊息，只能請客戶截圖。
 *      任務卡（`records.source_ids`）一直有做，個人日報漏了。
 *
 * ⚠️⚠️ 這種「加一個欄位」最常見的壞法是**在某一層掉了**，而且每一層都
 *    tsc 綠、build 綠、畫面不會報錯，只是那個欄位靜靜地變成 undefined
 *    （memory: trace-whole-path-not-first-omission）。
 *    所以這裡**逐層 assert**，不是只驗第一處。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const SERVICE = "../src/personal-daily-report/personal-daily-report.service.ts";
const REPO = "../src/personal-daily-report/personal-daily-report.repository.ts";

test("⭐⭐ R11：個人日報的每一項都要能回溯到原始訊息（逐層都不可以掉）", () => {
  const svc = read(SERVICE);
  const repo = read(REPO);
  const api = read("../../web/src/api.ts");
  const ui = read("../../web/src/personal-report/MyDailyReport.tsx");

  // ① LLM schema：模型要回得出來
  assert.match(svc, /source_ids:\s*z\.array\(z\.number\(\)\)/,
    "① LLM schema 沒有 source_ids —— 模型根本不會回這個欄位");

  // ② prompt：schema 有欄位但沒交代要填，模型會給空陣列
  assert.match(svc, /source_ids/,
    "② prompt 沒提到 source_ids");
  assert.ok(svc.includes("每則訊息前面都有編號"),
    "② prompt 沒說訊息有編號 —— 模型無從指認是哪一則");

  // ③ blob 真的有編號。沒有 #N 的話 ②的說明是騙人的
  assert.match(svc, /`#\$\{i \+ 1\}/,
    "③ 送進去的訊息沒有 #N 編號");

  // ④ 序號 → message_id。存序號事後對不回去（那組序號只在那次呼叫裡有意義）
  assert.match(svc, /sourceMessageIds:/,
    "④ aiItems 沒有把 source_ids 轉成 sourceMessageIds —— 這一層掉了就整條斷");
  assert.match(svc, /rows\[n - 1\]\.message_id/,
    "④ 沒有把序號換成 message_id");

  // ⑤ 儲存用的型別
  assert.match(repo, /sourceMessageIds\?:\s*string\[\]/,
    "⑤ PersonalDailyReportItem 少了 sourceMessageIds");

  // ⑥ 前端型別（ai_items 是 jsonb 原樣回傳，型別沒加就讀不到）
  assert.match(api, /sourceMessageIds\?:\s*string\[\]/,
    "⑥ web/src/api.ts 的型別少了 sourceMessageIds");

  // ⑦ 畫面真的有用它 —— 前六層都對但沒渲染的話，使用者仍然看不到
  assert.match(ui, /item\.sourceMessageIds/,
    "⑦ MyDailyReport 沒有讀 sourceMessageIds —— 存了但畫面上看不到，等於沒做");
  assert.match(ui, /dayMessages/,
    "⑦ ItemCard 沒收到當天訊息，沒辦法把 message_id 換回看得懂的原文");
});

test("⭐ source_ids 不可以寫成 nullable —— 會吃掉 Anthropic 的 union 額度", () => {
  // 2026-08-31 實測：上限數的是產生出來的 JSON Schema 裡的 anyOf/enum，
  // z.array 不計入、不可空欄位 0 成本（scripts/probe-union-limit.ts）。
  // 寫成 .nullable() 就白白吃掉一格 —— 而預設的 factory_report 模板只剩 1 格。
  const svc = read(SERVICE);
  assert.doesNotMatch(svc, /source_ids:\s*z\.array\(z\.number\(\)\)\.nullable\(\)/,
    "source_ids 不要 nullable · 抽不到給 [] 即可");
});

test("⭐ 舊日報沒有這個欄位 —— 前端要能接受 undefined", () => {
  // 2026-08-31 之前產生的 ai_items 裡沒有 sourceMessageIds。
  // 直接 .map() 會炸；畫面必須是「沒有來源就不顯示那一塊」，不是空殼或紅字。
  const ui = read("../../web/src/personal-report/MyDailyReport.tsx");
  assert.match(ui, /item\.sourceMessageIds \?\? \[\]/,
    "沒有對 undefined 做保護 —— 舊日報會炸");
  assert.match(ui, /srcMsgs\.length > 0 &&/,
    "沒有『沒有來源就整塊不顯示』的判斷");
});

test("⭐ i18n 字串裡不可以寫 markdown —— JSX 不會渲染，會原樣印出星號", () => {
  // 2026-08-31 實測踩到：我把 "由 {n} 則訊息**合併**而成" 寫進字典，
  // 畫面上就真的印出兩顆星號。DOM 測試會過（字串有出現），**只有看畫面才發現**。
  const bad: string[] = [];
  for (const f of ["../../web/src/i18n/zh-TW.ts", "../../web/src/i18n/en.ts"]) {
    for (const m of read(f).matchAll(/^\s*"([\w.\-]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) {
      // **粗體** 與 __底線__ 是最常誤用的兩種；`code` 在文案裡也不會被渲染
      if (/\*\*[^*]+\*\*|__[^_]+__/.test(m[2])) bad.push(`${m[1]} = ${m[2].slice(0, 50)}`);
    }
  }
  assert.deepEqual(bad, [], `這些 i18n 字串裡有 markdown 粗體（畫面會原樣印出）：\n${bad.join("\n")}`);
});
