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

test("⭐⭐ 對話框要有高度上限 + 內部捲動 —— 否則長內容會把按鈕擠出畫面", () => {
  // 2026-08-31 客戶（三星 A55）：「送出日報要按兩次，
  // 第二次的預覽要轉用電腦才看得到按鈕」。
  // 送出確認框裡塞的是**完整的日報預覽**（那天 6 項），對話框高 822px、
  // 視窗只有 780px，而 scrim 是 align-items:center → 上下都溢出，
  // 底部的「確定送出」被切掉；scrim 又是 position:fixed 把背景鎖住，捲也捲不到。
  //
  // 實測：修正前 確定鈕距畫面底 **-1px**（在視窗外）→ 修正後 +36px。
  //
  // ⭐ 只要對話框內容是「不定長度」（列表、預覽、長文），
  //    就一定要 max-height + 內部捲動。桌機視窗高，永遠測不出來。
  const css = read("../../web/src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");

  const modal = css.slice(css.indexOf(".cd-modal {"), css.indexOf(".cd-modal[data-exiting]"));
  assert.match(modal, /max-height:\s*calc\(100dvh/,
    ".cd-modal 沒有 max-height —— 長內容會把按鈕推出畫面。⚠️ 要用 dvh，"
    + "手機瀏覽器的 vh 不扣瀏覽器列，會算得比實際可視區高");
  assert.match(modal, /display:flex;\s*flex-direction:column/,
    ".cd-modal 不是 flex column —— 內部捲動撐不起來");

  const body = css.slice(css.indexOf(".cd-body {"), css.indexOf(".cd-body {") + 260);
  assert.match(body, /overflow-y:\s*auto/, ".cd-body 沒有捲動");
  assert.match(body, /min-height:\s*0/,
    ".cd-body 少了 min-height:0 —— flex 子項預設 min-height:auto，"
    + "不加就縮不下去，overflow 也不會生效（捲軸出不來，內容照樣溢出）");

  const actions = css.slice(css.indexOf(".cd-actions {"), css.indexOf(".cd-actions {") + 200);
  assert.match(actions, /flex:\s*none/,
    ".cd-actions 沒有 flex:none —— 內容再長也不可以把按鈕擠掉");
});

test("⭐ 對話框的 scrim 也要閃開系統手勢區", () => {
  // 同 .pdr-foot 那個坑：liff.html 是 viewport-fit=cover，
  // 不補 inset 的話對話框底部會壓在手機的手勢列上。桌機 env() 回 0，看不出來。
  const css = read("../../web/src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const scrim = css.slice(css.indexOf(".cd-scrim {"), css.indexOf(".cd-scrim[data-exiting]"));
  assert.match(scrim, /padding-bottom:\s*max\([^)]*env\(safe-area-inset-bottom\)/,
    ".cd-scrim 沒有補 safe-area-inset-bottom");
});

test("⭐⭐ 權限管理版面：flex:1 不可以跟 max-height 同時存在", () => {
  // 2026-09-01 用戶回報「權限管理 · 點擊儲存變更 前端問題」。
  // `.rm-perms-scroll` 同時寫了 flex:1（撐滿）與 max-height:60vh（封頂）——
  // 兩者互斥，而 `.rm-layout` 只給 min-height，於是：
  //   1568×1418  面板 1376、內容只填到 1209 → **底下 167px 死白**，
  //              「儲存變更」浮在半空中
  //   1280×700   面板被 60vh 撐超過視窗 → **儲存變更整顆在畫面外**（筆電尺寸！）
  // 修正後三種視窗高度都是死白 1px（border）、按鈕都在畫面內。
  //
  // ⚠️ `.rm-*` 是**平台頁與租戶頁共用**的 class，改這裡兩邊都要驗。
  const css = read("../../web/src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");

  const scroll = css.slice(css.indexOf(".rm-perms-scroll {"), css.indexOf(".rm-perms-scroll {") + 220);
  assert.doesNotMatch(scroll, /max-height/,
    ".rm-perms-scroll 又出現 max-height —— 它有 flex:1，兩者互斥，"
    + "會造成死白（高視窗）或按鈕跑到畫面外（矮視窗）");
  assert.match(scroll, /min-height:\s*0/,
    ".rm-perms-scroll 少了 min-height:0 —— flex 子項縮不下去，overflow 不生效");

  // ⚠️ 要抓**基礎規則**，不是 media query 裡的覆寫。
  //    第一版用 indexOf(".rm-layout {") 抓到的是手機版那條
  //    （`.rm-layout { grid-template-columns:1fr !important; }`），
  //    測試就紅得莫名其妙 —— 而且順帶讓我發現有**兩處** media 覆寫要一起改。
  const base = css.indexOf(".rm-layout { display:grid");
  assert.ok(base > 0, "找不到 .rm-layout 的基礎規則");
  const layout = css.slice(base, base + 220);
  assert.match(layout, /height:\s*max\(/,
    ".rm-layout 要給**確定高度**（不是 min-height），flex 才算得出剩餘空間");
  assert.doesNotMatch(layout, /min-height:\s*calc/,
    ".rm-layout 用 min-height 的話子項的 flex:1 沒有可分配的高度");
});

test("⭐⭐ 權限快取必須 stale-while-revalidate —— 不可以「有快取就不打 API」", () => {
  // 2026-09-01 用戶回報「配置權限沒生效」：
  // 總經理在權限管理把員工加了 4 項權限、存檔成功（角色清單數字也變了），
  // 員工那邊側欄完全沒變 —— **連重新整理都沒用**。
  //
  // 舊版：`if (cached.size === 0) void refresh()` ← 只有快取空的時候才打 API。
  // 而快取在 localStorage、TTL 5 分鐘，重新整理活得好好的
  // → 最多要等 5 分鐘。伺服器端其實有清快取，卡住的是前端。
  //
  // 實測（塞一份還沒過期的過時快取後重新整理）：
  //   修正前  側欄剩 2 項 · API 呼叫 **0 次**
  //   修正後  側欄回到 8 項 · API 呼叫 2 次
  //
  // ⭐ 快取的用意是「載入時先畫出東西、不要閃爍」，不是「不要打 API」。
  // ⚠️ 先去掉註解再比對 —— 我在註解裡引用了舊寫法當說明，
  //    直接掃原文會比對到自己的散文（本 session 第二次犯，同 .rm-layout 那支）。
  const src = read("../../web/src/permission/PermissionContext.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /if\s*\(\s*cached\.size\s*===\s*0\s*\)\s*void refresh\(\)/,
    "又變回「有快取就不打 API」—— 改權限後對方要等 TTL 過期才生效，重新整理也沒用");
  // 換身分／載入時一定要重新驗證
  const eff = src.slice(src.indexOf("setPermissions(readCache(identity))"), src.indexOf("setPermissions(readCache(identity))") + 200);
  assert.match(eff, /void refresh\(\);/,
    "載入時沒有無條件重新驗證");
  // 分頁取得焦點時也驗一次 —— 這才兌現得了「改完立即生效」那句文案
  assert.match(src, /visibilitychange/,
    "沒有在分頁重新取得焦點時重驗 —— 兩個視窗並排改權限的情境不會即時生效");
  assert.match(src, /30_000|30000/,
    "focus 重驗沒有節流 —— 頻繁切分頁會打爆 API");
});

test("⭐⭐ 公司名稱要由伺服器給 —— 不可以在前端硬編 tenant_id 對照表", () => {
  // 2026-09-01：Shell.tsx 原本硬編兩筆 tenant_id → 名稱，對不到就顯示佔位字
  // 「客戶方」。第三個租戶開始一律顯示「客戶方」。
  //
  // ⚠️⚠️ 那個佔位字造成過**實際的誤判**：排查「權限沒生效」時，
  //    我看到員工端寫「客戶方」、管理端寫「aiproot」，就據此判斷
  //    「這是兩家不同的客戶」—— 用一個 fallback 文字當證據，判斷錯誤。
  const shell = read("../../web/src/Shell.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(shell, /const TENANT_NAME\s*:\s*Record/,
    "又出現硬編的 tenant_id → 名稱對照表");
  assert.doesNotMatch(shell, /"77777777-0000-0000-0000-000000000001"/,
    "Shell.tsx 裡不該有寫死的 tenant_id");
  assert.match(shell, /session\.tenantName \?\?/,
    "沒有用伺服器給的 tenantName（要保留 ?? 保底，首次載入前是 null）");
});

test("⭐⭐ getTenantName 不可以用 withAuthLookup —— tenants 沒有那條 policy", () => {
  // ⚠️ 我第一版就是寫成 withAuthLookup，結果 tenantName **永遠是 null 而且不報錯**。
  //    withAuthLookup 只設 app.auth_lookup='1'，那是給 users 的 p_users_auth 用的；
  //    tenants 的 policy 要 app.current_tenant / app.actor_role / app_is_platform_ops。
  //    典型的 RLS 靜默回 0（memory: rls-silent-zero）——
  //    是因為測試**斷言了實際值**才抓到，只驗「沒報錯」的話會過。
  // ⚠️ 先去註解，而且只切到**這個函式的結尾** ——
  //    固定長度的 slice 會跨到下一個函式的說明（getLocale 的註解就提到 withAuthLookup），
  //    測試就紅得莫名其妙。本 session 第三次踩到「守門比對到散文」。
  const svc = read("../src/permission/permission.service.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const i = svc.indexOf("async getTenantName(");
  assert.ok(i > 0, "找不到 getTenantName");
  const end = svc.indexOf("\n  }", i);
  const body = svc.slice(i, end > 0 ? end : i + 400);
  assert.match(body, /currentTx\(\)/, "getTenantName 要用 currentTx（controller 內有租戶上下文）");
  assert.doesNotMatch(body, /withAuthLookup/, "withAuthLookup 讀不到 tenants，會靜默回 null");

  const ctrl = read("../src/permission/permission.controller.ts");
  assert.match(ctrl, /tenantName/, "/me/permissions 沒有回傳 tenantName");
  const api = read("../../web/src/api.ts");
  assert.match(api, /tenantName: string \| null;/, "前端 Session 少了 tenantName");
});

test("⭐⭐ due_at / due_text 不可以寫成 nullable —— 會撞 Anthropic 的 16 union 上限", () => {
  // 2026-09-01 實測（scripts/probe-union-limit.ts · 打真實 API）：
  //   現況（兩欄不可空）    15  ✅
  //   把那兩欄改成可空      17  ❌ 400 too many parameters with union types
  // 預設模板 factory_report 只剩 1 格，改成 nullable 直接超過。
  //
  // ⭐ 壞掉的不是行事曆功能，是**客戶每天的對話分析整條 pipeline**，
  //    而錯誤只在 server log 裡（FMEA F-9，P0）。
  //
  // R11 的紀律沒有放寬：抽不到給 ""，不換算。已實測 5/5
  // （scripts/probe-due-nonnullable.ts）＋ L1 回歸 11/11
  // （scripts/probe-l1-regression.ts，含「既有欄位沒退步」那幾條）。
  const src = read("../src/conversation-analysis/pipeline/schemas.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(src, /due_at:\s*z\.string\(\),/, "schema 少了 due_at");
  assert.match(src, /due_text:\s*z\.string\(\),/, "schema 少了 due_text");
  assert.doesNotMatch(src, /due_at:\s*z\.string\(\)\.nullable\(\)/,
    "due_at 被改成 nullable —— 會讓 factory_report 從 15 變 16、下一個加欄位的人就爆");
  assert.doesNotMatch(src, /due_text:\s*z\.string\(\)\.nullable\(\)/, "due_text 被改成 nullable");

  // prompt 也要交代 —— schema 有欄位但沒說怎麼填，模型會亂填或全空
  const prompt = read("../src/conversation-analysis/pipeline/tenant-twh.ts");
  assert.match(prompt, /due_at/, "system prompt 沒交代 due_at 怎麼填");
  assert.ok(prompt.includes("絕對不可以自己換算或臆測"),
    "prompt 少了「不可換算」那條 —— 算錯日期會讓人在錯的日子赴約（FMEA F-1 · P0）");
});
