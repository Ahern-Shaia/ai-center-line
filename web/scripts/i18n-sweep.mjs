#!/usr/bin/env node
/**
 * 切成英文後，把每一頁「真的畫出來的字」掃一遍，找還在的中文。
 *
 * ⚠️⚠️ **為什麼非要真的渲染不可 —— 靜態 grep 抓不到這四種：**
 *   1. `document.title`（不是 JSX，守門測試掃不到；而且 effect 少放 locale 依賴時
 *      切語言根本不重跑）
 *   2. 字典裡**有**翻譯、但渲染端沒包 `tr()`（原文照樣印出來）
 *   3. 只有展開 / 有資料時才出現的字
 *   4. 後端回來的中文（訊息、狀態、錯誤）
 *
 * ⚠️ 它掃的是 `innerText`（人看得到的），不是原始碼 ——
 *    註解與內嵌 JSON 裡的中文不會誤報。
 *
 * ══ 怎麼分辨「漏翻」與「資料」 ═════════════════════════════
 * 光看「有沒有中文字」會把人名、部門名、demo 工單內容全報成漏翻，
 * 報告一長就沒人看，等於沒做。這裡改成兩個桶：
 *
 *   A（確定漏翻）畫面上的字**命中 zh-TW.ts 的某個翻譯值**
 *                → 那句話有翻譯卻印出中文＝渲染端沒過 tr()。直接給出 key。
 *   B（待判斷）  有中文但不在字典裡 → 可能是資料，也可能是**從沒進字典的硬編字串**。
 *                人看一眼就能分，所以照印不隱藏。
 *
 * ⛔ 不要為了讓報告變短而把 B 桶關掉 —— 「硬編中文」正是落在 B。
 *
 * 用法：
 *   1) 起本機環境（server 與 web 都要）
 *        cd server && PORT=3010 npm run start
 *        cd web && API_TARGET=http://localhost:3010 npx vite
 *   2) cd web && npm run i18n:sweep
 *      cd web && npm run i18n:sweep -- --shot   # 順便把每頁截圖存到 web/output/i18n-sweep/
 *
 * ⚠️ 這支放在 web/ 底下不是 repo 根的 scripts/ —— ESM 照**檔案位置**解析依賴，
 *    放在根目錄會找不到 web/node_modules 的 playwright。
 *
 * ⚠️ 本機前置：`owner-d2` 在 seed 裡是 must_change_password=true，會卡在
 *    「首次登入 · 請設定新密碼」。跑之前先清掉（只動本機 dev DB）：
 *      update users set must_change_password=false
 *       where email='owner-d2@taiwanhomecare.demo';
 *
 * 離開時的 exit code：0 = A 桶為空；1 = 有確定漏翻。
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const WEB = process.env.SWEEP_WEB ?? "http://localhost:5173";
const SHOT = process.argv.includes("--shot");
const OUT = "output/i18n-sweep";
const CJK = /[㐀-䶿一-鿿]/;

const SB_ITEM = ".sb-link";   // 側欄可點頁面（.sb-group 是可收合的分類標題）

/** 這些帳號合起來看得到所有側欄頁面 */
const ACCOUNTS = [
  { email: "admin@aiproot.demo", label: "aiproot_admin" },
  { email: "gm@taiwanhomecare.demo", label: "tenant_admin" },
  { email: "owner-d2@taiwanhomecare.demo", label: "group_owner" },
];
const PASSWORD = "demo123";

// ── 字典 ────────────────────────────────────────────────
/**
 * 直接把 zh-TW.ts 當文字讀，抓 `"key": "值"`。
 * 不 import 是因為它是 TS，而這支是純 node 跑的。
 */
function loadZh() {
  const src = readFileSync(new URL("../src/i18n/zh-TW.ts", import.meta.url), "utf8");
  const map = new Map();
  for (const m of src.matchAll(/"([\w.\-]+)":\s*"((?:[^"\\]|\\.)*)"/g)) {
    const val = m[2].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
    // 太短的值（「是」「否」「天」）會到處誤命中，人名裡也有
    if (val.length >= 3 && CJK.test(val)) map.set(val, m[1]);
  }
  return map;
}
const ZH = loadZh();

/**
 * ⭐ 平台專用頁 —— **2026-08-29 用戶裁定：維持中文，不接英文。**
 *
 * 判準跟 08-28「智慧聯網戰情室那格不必兌現英文」同一條：
 * **看那個落地頁誰在用**，不是「有沒有被翻譯」。
 * 那些頁只有 aiproot 帳號進得去，而 aiproot 這邊全是中文語系。
 *
 * ⛔ 不要「順手把它們也翻一翻」—— 那是 100+ 行文案 ×2，加上日後每次改都要
 *    維護兩份。要改這個裁定得由人改這裡。
 *
 * ⚠️ 判斷方式**不用手維護頁面名單**，而是看「這條是用誰的帳號掃到的」：
 *    以 aiproot 身分看到的東西，就是 aiproot 才看得到的畫面。
 *    第一版寫死了 9 個頁面名，結果 `Permissions` 出事 ——
 *    **側欄有兩個項目都叫 Permissions**（平台的 nav.rolesMgmt 與
 *    租戶的 nav.rolePermissions），用標籤當 key 會把兩頁混成一頁。
 *
 * ⚠️ 代價（已知、可接受）：某頁租戶看得到，但那句中文只在
 *    「只有 aiproot 才觸發得到的狀態」下出現時，會被歸到平台段。
 *    真的擔心就多跑一輪租戶帳號並展開那個狀態。
 */
const PLATFORM_ACCOUNT = "aiproot_admin";

/**
 * 語言切換鈕本來就該顯示**另一個**語言的名字 —— 英文介面上看到「繁體中文」是對的。
 * 這是唯一一個「英文畫面上該有中文」的 UI 字串。
 */
const INTENTIONAL = new Set(["繁體中文"]);

/**
 * 已知的「資料值剛好等於字典文案」碰撞 —— 本機 seed 造成的，不是漏翻。
 *
 *   · tickets.category = "報工日報"，而 category.daily_report 的中文也是「報工日報」
 *   · tickets.summary  = "處理中一"，而 recordStatus.in_progress 是「處理中」
 *
 * ⛔ 加東西進來的門檻：**你已經去資料庫查過、確認畫面上那個字來自某一列資料**。
 *    「看起來像資料」不算 —— 這份清單一旦變成「讓它閉嘴」的地方，
 *    這支工具就沒有用了（而它存在的理由正是我沒辦法靠眼睛看完所有頁面）。
 *
 * ⚠️ 只影響是否算失敗（exit code），這些行仍然會印在 B 桶裡。
 *    一支永遠紅的檢查等於沒有檢查。
 */
const DATA_COLLISION = new Set(["報工日報", "處理中一", "待辦一", "維修工單", "改裝進度"]);

function classify(text) {
  const sure = [];   // A · 命中字典 = 確定漏翻
  const maybe = [];  // B · 有中文但不在字典
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || !CJK.test(line) || INTENTIONAL.has(line)) continue;
    /**
     * ⚠️ 用「包含」比對會誤判。示範知識卡的內文裡有「低信心」三個字，
     *    就被歸成「wr.conf.low 漏翻」—— 那是資料不是介面。
     *    要求**整行相符，或字典值涵蓋這行大半**，A 桶才站得住。
     *    比不上的照樣進 B 桶，一行都不會被吃掉。
     */
    let key = null;
    for (const [val, k] of ZH) {
      if (line === val || (line.includes(val) && val.length >= line.length * 0.6)) { key = k; break; }
    }
    if (key && !DATA_COLLISION.has(line)) sure.push({ line: line.slice(0, 80), key });
    else maybe.push({ line: line.slice(0, 80), key });
  }
  return { sure, maybe };
}

// ── 操作 ────────────────────────────────────────────────
async function login(page, email) {
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  // ⚠️ 等 .sb-link 不是等 aside —— 外殼會先畫出來，這時點下去的頁面還沒 mount
  await page.waitForSelector(SB_ITEM, { timeout: 25000 }).catch(async () => {
    const seen = await page.evaluate(() => document.body.innerText.replace(/\n/g, " | ").slice(0, 200));
    throw new Error(`${email} 登入後沒出現側欄。畫面上是：${seen}`);
  });
  await page.waitForTimeout(1200);
}

async function pickLocale(page, name) {
  await page.click(".user-btn");
  await page.waitForTimeout(400);
  await page.getByRole("menuitem", { name }).click({ timeout: 5000 });
  await page.waitForTimeout(900);
}

/**
 * 切到英文 —— 而且要**從 UI 切**、並且從中文切過去。
 *
 * ⚠️ 兩個都不能省：
 *   · 不能只在 localStorage 塞 "en"：登入回應會用伺服器存的 `users.locale`
 *     覆蓋本機值（那是對的行為，偏好要跨裝置）。
 *   · 不能假設起點是中文：**這支腳本自己會把 users.locale 改成 en**，
 *     第二次跑起點就是英文，「切換」什麼都沒做也會全綠。
 *     所以先切回中文當基準，再切英文。
 */
async function switchToEnglish(page) {
  if ((await page.evaluate(() => document.documentElement.lang)).startsWith("en")) {
    await pickLocale(page, /繁體中文/);
  }
  const before = await page.evaluate(() => document.documentElement.lang);
  if (before.startsWith("en")) throw new Error("切不回中文，無法建立基準");
  const titleZh = await page.title();

  await pickLocale(page, /English/);
  const after = await page.evaluate(() => document.documentElement.lang);
  if (!after.startsWith("en")) throw new Error(`切英文沒生效（lang=${after}）`);
  return { titleZh, titleEn: await page.title() };
}

// ── 主流程 ──────────────────────────────────────────────
const findings = [];
const scanned = new Set();
const add = (who, pg, where, o) => findings.push({ who, page: pg, where, ...o });

const browser = await chromium.launch();
if (SHOT) mkdirSync(OUT, { recursive: true });

for (const acct of ACCOUNTS) {
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => localStorage.setItem("aiproot.locale", "en"));
    const page = await ctx.newPage();
    const jsErrors = [];
    page.on("pageerror", (e) => jsErrors.push(e.message));

    // ① 登入頁（只驗一次就夠，三個帳號看到的是同一頁）
    if (acct === ACCOUNTS[0]) {
      await page.goto(WEB, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(900);
      const t = await page.evaluate(() => ({ title: document.title, text: document.body.innerText }));
      const c = classify(t.text);
      for (const x of c.sure) add("-", "login", "畫面", x);
      for (const x of c.maybe) add("-", "login", "畫面?", x);
      if (CJK.test(t.title)) add("-", "login", "document.title", { line: t.title });
    }

    await login(page, acct.email);
    const { titleZh, titleEn } = await switchToEnglish(page);

    /**
     * ⚠️ 標題要**停在原地切**才驗得到 —— 一換頁 effect 就重跑，bug 自己把證據蓋掉。
     *
     * ⚠️ 而且不能只問「英文模式下標題有沒有中文」。2026-08-28 實際踩到的是**反方向**：
     *    effect 依賴少放 locale → 標題卡在載入當下那個語言，
     *    中文介面上顯示 "Overview · aiproot War Room"。
     *    比對切換前後有沒有變，兩個方向都抓得到。
     */
    if (titleZh === titleEn) {
      add(acct.label, "（切換當下）", "document.title 沒跟著語言變",
        { line: `切換前後都是「${titleZh}」—— 標題留在舊語言，要換頁才會更新` });
    }

    /**
     * ⚠️ 側欄分類**預設是全開的**。第一版在這裡「先展開所有分類」，
     *    結果每個 .sb-group 都被點了一下 → 全部收起來 → 18 頁只掃到 5 頁。
     *    而報告看起來仍然像正常跑完（memory: green-because-empty）。
     *
     * ⚠️ 也不可以照 index 逐一點：換頁後側欄會重畫，nth[i] 指到的已經不是原本那項。
     *    改成先把名字收齊，每次**用名字重新找**。
     */
    const collect = async () => page.$$eval(SB_ITEM, (els) =>
      els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 28)));
    let labels = await collect();
    // 真的有收合的分類才展開（展開後項目會變多）
    for (const g of await page.$$(".sb-group")) {
      await g.click().catch(() => undefined);
      await page.waitForTimeout(250);
      const now = await collect();
      if (now.length > labels.length) labels = now;
      else await g.click().catch(() => undefined);   // 點錯方向就點回去
    }
    labels = [...new Set(await collect())];

    for (const name of labels) {
      const link = page.locator(SB_ITEM, { hasText: name }).first();
      await link.click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      scanned.add(name);

      const snap = await page.evaluate(() => ({ title: document.title, text: document.body.innerText }));
      const c = classify(snap.text);
      for (const x of c.sure) add(acct.label, name, "畫面", x);
      for (const x of c.maybe) add(acct.label, name, "畫面?", x);
      if (CJK.test(snap.title)) add(acct.label, name, "document.title", { line: snap.title });

      if (SHOT) {
        await page.screenshot({ path: `${OUT}/${acct.label}-${name.replace(/[^\w一-鿿]/g, "_")}.png` });
      }
    }

    if (jsErrors.length) add(acct.label, "-", "JS 錯誤", { line: jsErrors[0].slice(0, 120) });
    await ctx.close();
  } catch (e) {
    // ⚠️ 不可以 rethrow —— 第 3 個帳號掛掉就把前 2 個掃到的漏翻全丟了，
    //    而畫面上只會看到一行 stack trace，看起來像「沒問題」。
    add(acct.label, "-", "掃描中斷", { line: String(e.message).slice(0, 180) });
    console.error(`⚠️ ${acct.label} 掃到一半中斷：${String(e.message).slice(0, 180)}`);
  }
}
await browser.close();

// ── 報告 ────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));

console.log(`掃過 ${scanned.size} 個頁面：${[...scanned].join("、")}\n`);
if (scanned.size < 15) {
  console.log("⚠️ 掃到的頁面偏少 —— 先確認是不是側欄沒展開／帳號權限不足，"
    + "不要把這當成「都過了」\n");
}

const group = (pred) => {
  const m = new Map();
  for (const f of findings.filter(pred)) {
    const k = `${f.page} · ${f.where}`;
    if (!m.has(k)) m.set(k, new Map());
    m.get(k).set(f.line, f.key ?? "");
  }
  return m;
};
const show = (title, m) => {
  if (!m.size) return;
  console.log(`${title}\n`);
  for (const [k, lines] of [...m].sort()) {
    console.log(`── ${k}`);
    for (const [line, key] of [...lines].slice(0, 8)) {
      console.log(`     ${line}${key ? `   ← ${key}` : ""}`);
    }
    if (lines.size > 8) console.log(`     …還有 ${lines.size - 8} 行`);
  }
  console.log("");
};

const client = (f) => f.who !== PLATFORM_ACCOUNT;
const sure = group((f) => client(f) && f.where !== "畫面?" && f.where !== "掃描中斷");
const maybe = group((f) => client(f) && f.where === "畫面?");
const plat = group((f) => !client(f));
const broke = group((f) => f.where === "掃描中斷");

/**
 * ⚠️ A 桶會有少量誤報，而且**修不掉**：有些資料的值剛好等於字典裡的文案。
 *    例：`tickets.category` 存的就是「報工日報」四個字，
 *    而 `category.daily_report` 的中文翻譯也是「報工日報」。
 *    分不出來是渲染端沒過 tr()，還是資料本來就長這樣。
 *    看到 A 桶的項目，先問一句「這是介面文字還是某一列資料」。
 */
show("❌ A · 確定漏翻（字典裡有翻譯，畫面卻印中文）", sure);
show("❓ B · 有中文但不在字典（資料 or 從沒進字典的硬編字串 —— 人判斷）", maybe);
show("➖ 平台專用頁 · 2026-08-29 裁定維持中文（照列不照修）", plat);
show("⚠️ 掃描中斷", broke);

console.log(`完整清單：${OUT}/findings.json`);
// ⚠️ 只有客戶方看得到的頁面算失敗 —— 平台頁的中文是刻意的，
//    讓它一直紅，這支就會被當成「反正都會紅」而沒人看。
process.exit(sure.size ? 1 : 0);
