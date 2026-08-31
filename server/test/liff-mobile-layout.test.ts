/**
 * LIFF 手機版版面的硬規則。
 *
 * 起因：2026-08-31 台灣福祉回報「手機送不出日報，只能改用電腦」，
 *       原話「超過手機頁面，就無法送出給主管了」「螢幕沒辦法下滑」，多人同症狀。
 *
 * ⚠️ 這些規則都是**看程式碼才發現、看畫面看不出來**的：
 *    在沒有瀏海／home indicator 的桌機瀏覽器上，env(safe-area-inset-*) 一律回 0，
 *    所以少補 safe-area 的畫面在開發機上**完全正常**。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

test("⭐⭐ viewport-fit=cover 的頁面，貼底元件必須補 safe-area-inset-bottom", () => {
  // liff.html 宣告 viewport-fit=cover ＝ 內容延伸到螢幕最邊緣（含 home indicator 那一條）。
  // 貼在 bottom:0 的送出條若不補 inset，會壓在螢幕底部的系統手勢區上 ——
  // iPhone 是 home indicator，**Android 是手勢導覽列**（2026-08-31 回報的機型
  // 三星 A55 正是 Android）。條子被蓋住＝按不到，而且從那一區往上滑
  // 會被系統判定成返回/主畫面手勢＝「螢幕沒辦法下滑」。
  const html = read("../../web/liff.html");
  const css = read("../../web/src/styles.css");

  if (!/viewport-fit\s*=\s*cover/.test(html)) return;   // 哪天不用 cover 了，這條自動失效

  const foot = css.slice(css.indexOf(".pdr-foot { position:fixed"));
  assert.ok(foot.length > 0, "找不到 .pdr-foot 的固定定位規則");
  assert.match(
    foot.slice(0, 500),
    /padding-bottom:\s*max\([^)]*env\(safe-area-inset-bottom\)/,
    "送出條沒有補 env(safe-area-inset-bottom) —— 在 iPhone 上會被 home indicator 壓住。"
    + "⚠️ 這在桌機瀏覽器上看不出來（env() 回 0）。",
  );
});

test("⭐⭐ 送出條要 fixed 不要 sticky —— sticky 得先捲得動才有用", () => {
  // 客戶的症狀是「捲不動」＋「按不到送出」。
  // sticky 依賴捲動；fixed 不依賴 —— 就算捲動因為某個原因壞掉，鈕仍然在畫面上。
  // 兩件事刻意拆開：捲不動的根因還沒找到（Chromium／WebKit 桌機引擎都重現不了），
  // 但「送不出去」不該等那個結論。
  // ⚠️ 要比對的是**宣告**，不是散文。第一版直接掃整段原文，結果被自己的
  //    註解絆倒 —— 註解裡寫著「修正前 position:sticky」當紀錄，測試就紅了。
  //    先把 /* ... *\/ 註解拿掉再檢查。
  const css = read("../../web/src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const i = css.indexOf(".pdr-foot { position:");
  assert.ok(i > 0, "找不到 .pdr-foot 的定位宣告");
  const block = css.slice(i, i + 600);
  assert.match(block, /^\.pdr-foot \{ position:fixed/, "送出條被改回 sticky 了");
  assert.doesNotMatch(block.split(".pdr-pane")[0], /position:sticky/, "送出條不可以是 sticky");
});

test("⭐ 送出條改 fixed 之後，內容尾端要留出它的高度", () => {
  // fixed 不佔流內高度 —— 不補 padding，最後一項永遠被壓在條子底下，
  // 而那一項常常正是使用者要改的那一項。
  const css = read("../../web/src/styles.css");
  assert.match(css, /\.pdr-pane \{ padding-bottom:calc\(96px \+ env\(safe-area-inset-bottom\)\)/,
    ".pdr-pane 沒有留出送出條的高度");
  const tsx = read("../../web/src/personal-report/MyDailyReport.tsx");
  assert.match(tsx, /className="pane pdr-pane"/,
    "MyDailyReport 的根節點沒掛 .pdr-pane —— CSS 寫了也沒有作用");
});

test("⭐ LIFF 頁不可以被 body 的 height:100% 鎖住", () => {
  // `html, body, #root { height:100% }` 是為了讓 app shell 的 .app{min-height:100%}
  // 解析得出來。但 LIFF 的根節點是 #liff-root，**不在那條鏈上** ——
  // 那條規則在 LIFF 頁只會把 body 框成一個視窗高、再讓內容整個溢出去
  // （2026-08-31 實測：內容 1291px、body 664px）。
  //
  // ⚠️ 這不是已證實的原因，是移除一個在這頁沒有作用的限制。
  const html = read("../../web/liff.html");
  const css = read("../../web/src/styles.css");
  assert.match(html, /<html[^>]*class="[^"]*liff-page/, "liff.html 的 <html> 少了 liff-page class");
  assert.match(css, /html\.liff-page, html\.liff-page body \{ height:auto/,
    "styles.css 少了 LIFF 頁的 body 高度解鎖");
});
