// Push 後的 prod smoke（唯讀 · 不改任何資料）
import { chromium } from "playwright";

const WEB = "https://ai-center-line-demo.onrender.com";
const API = "https://ai-center-line.onrender.com";
const EMAIL = process.argv[2];
const PASS = process.argv[3];

const health = await (await fetch(`${API}/health`)).json();
console.log("① /health:", JSON.stringify(health));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
page.on("response", (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url().replace(API, "")}`); });

await page.goto(WEB, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASS);
await page.click('button[type="submit"]');
await page.waitForTimeout(5000);

const groups = await page.$$eval(".sb-group-btn span:first-child", (e) => e.map((x) => x.textContent.trim()));
const items = await page.$$eval(".sb-link span:first-of-type", (e) => e.map((x) => x.textContent.trim()));
console.log("② 分組:", groups.join(" | ") || "(空 · 可能沒登入成功)");
console.log("   項目:", items.join(" · ") || "(空)");

// 逐頁點過去 · 只讀不寫
const bad = [];
for (const label of items) {
  await page.click(`.sb-link:has-text("${label}")`).catch(() => {});
  await page.waitForTimeout(1600);
  const h1 = await page.$eval("h1", (e) => e.textContent.trim()).catch(() => null);
  if (!h1) bad.push(label);
}
console.log("③ 開不起來的頁:", bad.join(", ") || "(無)");

// 群組回話開關存在嗎
await page.click('.sb-link:has-text("通訊管道")').catch(() => {});
await page.waitForTimeout(2200);
const heads = await page.$$eval("thead th", (e) => e.map((x) => x.textContent.trim()));
console.log("④ LINE 群組表頭:", heads.join(" | ") || "(讀不到)");

await page.screenshot({ path: "/tmp/prod-smoke.png", fullPage: true });
const uniq = [...new Set(errs)].filter((e) => !/favicon|analytics/i.test(e));
console.log("\n⑤ 錯誤:", uniq.length ? uniq.slice(0, 8).join("\n     ") : "(無)");
await browser.close();
