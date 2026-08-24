// 側欄名稱一致性 · 2026-08-24
//
// ⭐⭐ 這支測的是**一種反覆發生的漏改**，不是某個功能。
//     2026-08-24 一天之內同一個 bug 犯了三次：
//       ① 側欄改名，頁內 <h1> 沒改（通訊管道 vs LINE 群組）
//       ② 修①時漏掉 App.tsx 那份手抄的 PAGE_TITLE（麵包屑與瀏覽器分頁）
//       ③ 修②時又漏掉 5 處**指路文字**（「到『通訊管道』把各群分派進來」）
//     ③ 最傷：客戶照著那句話去側欄找，找不到那個項目。
//
//     跟 0069 那個「角色名三處不一致」是同一類。改名的成本從來不在改字，
//     在**找齊所有提到它的地方**。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// ⚠️ 用 fileURLToPath，不要用 .pathname —— 本專案路徑含中文（創業），
//    .pathname 會回 URL-encoded 的 %E5%89%B5%E6%A5%AD，readdirSync 直接 ENOENT。
//    （AGENTS.md「本專案踩坑」記過同一類：中文路徑會讓推導路徑的腳本算錯。）
const WEB = fileURLToPath(new URL("../../web/src/", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx?|ts)$/.test(f) ? [p] : [];
  });
}

/** 去掉註解 —— 註解裡提到舊名字是說明歷史，不是 bug */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// 改過名的項目：舊名字不可以再出現在**使用者看得到的字串**裡。
// `renamedFrom` 是唯一的例外 —— 那正是拿來告訴使用者「它以前叫這個」。
const RETIRED: Array<{ old: string; now: string }> = [
  { old: "通訊管道", now: "LINE 群組" },
  { old: "定時任務設定", now: "分析排程" },
  { old: "素材看板", now: "素材" },
];

test("⭐⭐ 改過名的項目 · 舊名字不可以留在使用者看得到的字串裡", () => {
  const bad: string[] = [];
  for (const f of walk(WEB)) {
    const code = codeOnly(readFileSync(f, "utf8"));
    for (const { old, now } of RETIRED) {
      for (const line of code.split("\n")) {
        if (!line.includes(old)) continue;
        if (line.includes("renamedFrom")) continue;   // 刻意保留的改名提示
        bad.push(`${f.replace(WEB, "")} · 「${old}」應為「${now}」\n      ${line.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(bad, [],
    `舊名字還留在畫面上 —— 指路文字寫錯的話，客戶照著找會找不到：\n  ${bad.join("\n  ")}`);
});

test("⭐⭐ 側欄標籤與頁面標題必須同名（PAGE_TITLE 不可手抄第二份）", () => {
  const app = readFileSync(join(WEB, "App.tsx"), "utf8");
  // App.tsx 應該展開 Shell 的 NAV_TITLE，而不是自己列一份側欄頁的標題
  assert.match(app, /\.\.\.NAV_TITLE/,
    "PAGE_TITLE 要從 Shell 的 NAV 推導 —— 手抄第二份就是下次改名漏掉的地方");

  const shell = readFileSync(join(WEB, "Shell.tsx"), "utf8");
  const navKeys = [...shell.matchAll(/key: "([^"]+)", label: "([^"]+)"/g)].map((m) => m[1]!);
  const block = app.slice(app.indexOf("const PAGE_TITLE"), app.indexOf("\n};", app.indexOf("const PAGE_TITLE")));
  const dup = [...block.matchAll(/"?([\w-]+)"?:\s*"/g)].map((m) => m[1]!).filter((k) => navKeys.includes(k));
  assert.deepEqual(dup, [],
    `這些頁已經在側欄有名字，不該在 PAGE_TITLE 再寫一次：${dup.join(", ")}`);
});
