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
 * 語言切換鈕本來就該顯示**另一個**語言的名字 —— 英文介面上看到「繁體中文」是對的。
 * 這是唯一一個「英文畫面上該有中文」的 UI 字串。
 */
const INTENTIONAL = new Set(["繁體中文"]);

function classify(text) {
  const sure = [];   // A · 命中字典 = 確定漏翻
  const maybe = [];  // B · 有中文但不在字典
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || !CJK.test(line) || INTENTIONAL.has(line)) continue;
    let key = null;
    for (const [val, k] of ZH) {
      if (line.includes(val)) { key = k; break; }
    }
    if (key) sure.push({ line: line.slice(0, 80), key });
    else maybe.push({ line: line.slice(0, 80) });
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

const sure = group((f) => f.where !== "畫面?" && f.where !== "掃描中斷");
const maybe = group((f) => f.where === "畫面?");
const broke = group((f) => f.where === "掃描中斷");

show("❌ A · 確定漏翻（字典裡有翻譯，畫面卻印中文）", sure);
show("❓ B · 有中文但不在字典（資料 or 從沒進字典的硬編字串 —— 人判斷）", maybe);
show("⚠️ 掃描中斷", broke);

console.log(`完整清單：${OUT}/findings.json`);
process.exit(sure.size ? 1 : 0);
