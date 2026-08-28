// 員工自選主要群（v3 · 2026-08-28）· 安全邊界與一致性守門
//
// 背景：v2 寫死「不接受 primaryGroupId · 系統推斷比人工可靠」。
// 實例推翻了它 —— 有員工發言最多的部門群不是他真正歸屬的部門。
// 「發言最多」量到的是**社交活躍度**，不是**組織歸屬**。
//
// ⚠️ 這是 @Public() 端點。開放自選最大的風險是：
//    任何人都能把自己塞進任一部門。所以驗證邊界必須釘死。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SVC = read("../src/employee-binding/employee-binding.service.ts");

test("⭐⭐ 自選的群必須是「他自己發過言」的 —— @Public 端點的安全邊界", () => {
  const block = SVC.slice(SVC.indexOf("args.primaryGroupId"), SVC.indexOf("const primaryDept"));
  for (const [what, re] of [
    ["限定同一個 bot", /lm\.bot_id = \$\{args\.botId\}/],
    ["限定是他本人發的", /lm\.sender_line_id = \$\{args\.lineUserId\}/],
    ["限定是他選的那個群", /lm\.group_id = \$\{args\.primaryGroupId\}/],
    ["限定近 30 天", /interval '30 days'/],
  ] as const) {
    assert.match(block, re, `自選驗證少了「${what}」—— 少任何一條都能把自己塞進別的部門`);
  }
});

test("⭐⭐ 自選只能選「已分派部門且是部門群」的群", () => {
  const block = SVC.slice(SVC.indexOf("args.primaryGroupId"), SVC.indexOf("const primaryDept"));
  assert.match(block, /lg\.department_id IS NOT NULL/, "沒擋未分派部門的群 → 選了也推不出部門");
  assert.match(block, /lg\.group_type = 'department'/,
    "沒擋非部門群 → 產出會歸到一個不存在的組織單位（0068 那條註解）");
});

test("⭐⭐ 驗證失敗要丟錯，不可以靜默退回自動推斷", () => {
  const block = SVC.slice(SVC.indexOf("chosen = ok.rows[0]"), SVC.indexOf("const primaryDept"));
  assert.match(block, /if \(!chosen\) throw new BadRequestException/,
    "靜默退回的話，使用者以為自己選好了，系統卻用別的答案");
});

test("⭐⭐ 自選要寫 department_source='manual'（0052：手動優先，永不被自動推導覆寫）", () => {
  assert.match(SVC, /\$\{chosen \? "manual" : "auto"\}/,
    "寫成 'auto' 的話，下一次自動推導會把員工自己選的答案蓋掉");
  assert.match(SVC, /INSERT INTO users\s*\n\s*\(tenant_id, email, display_name, department_id, department_source,/,
    "INSERT 沒帶 department_source 欄位");
});

test("⭐ prefill 的 selectable 判準必須與 service 的驗證條件一致", () => {
  // 兩邊不一致的話：畫面上可選的群推不出部門（或反過來），使用者選了卻沒效果。
  const PRE = read("../src/employee-binding/liff-prefill.service.ts");
  assert.match(PRE, /selectable: !!r\.department_id && r\.group_type === "department"/,
    "prefill 的 selectable 條件跟 service 的驗證條件對不上");
});

test("⭐ 前端要把選擇送出去（不然選了也是白選）", () => {
  const view = read("../../web/src/liff/BindingView.tsx");
  assert.match(view, /primaryGroupId: pick \?\? undefined/, "BindingView 沒把 pick 送出去");
  const api = read("../../web/src/api.ts");
  assert.match(api, /liffCompleteBinding[\s\S]{0,300}primaryGroupId\?: string/, "api 的型別沒有 primaryGroupId");
});

test("⭐ 預設選第一個「選得了部門」的群，不是第一個群", () => {
  // groups[0] 可能是未分派部門或公告群 —— 那種當預設會讓提示寫出一個空部門。
  const view = read("../../web/src/liff/BindingView.tsx");
  assert.match(view, /firstSelectable = groups\.findIndex\(\(g\) => g\.selectable !== false\)/,
    "預設值直接用 groups[0]，沒有跳過選不了的群");
});
