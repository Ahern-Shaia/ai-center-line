import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
const errs = []; p.on("console", m => m.type()==="error" && errs.push(m.text()));
p.on("response", r => { if (r.status()>=400) errs.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
await p.goto("https://ai-center-line-demo.onrender.com", { waitUntil: "networkidle" });
await p.fill('input[type="email"]', "admin@aiproot.demo");
await p.fill('input[type="password"]', "demo123");
await p.click('button[type="submit"]'); await p.waitForTimeout(5000);

const items = await p.$$eval(".sb-link span:first-of-type", e=>e.map(x=>x.textContent.trim()));
console.log("① aiproot 側欄:", items.length, "項 · 智慧檢索", items.includes("智慧檢索"), "· 知識庫", items.includes("知識庫"));

await p.click('.sb-link:has-text("任務看板")'); await p.waitForTimeout(6000);
const all = await p.$$eval(".kb-card", e=>e.map(x=>x.innerText.replace(/\n/g," ").slice(0,30)));
console.log("② 看板卡片", all.length, "張:", all.slice(0,10).join(" / "));
const cols = await p.$$eval("[class*=kb-col] h3, [class*=kb-col] .kb-col-hd, .kb-col-title", e=>e.map(x=>x.textContent.trim())).catch(()=>[]);
console.log("   欄位:", cols.join(" | ") || "(抓不到)");
const card = await p.$('.kb-card:has-text("中區維修")');
if (card) {
  await card.click(); await p.waitForTimeout(2500);
  const tg = await p.$('button:has-text("對照原始訊息")');
  if (tg) { await tg.click(); await p.waitForTimeout(6000); }
  const msgs = await p.$$eval(".ts-msg", e=>e.length).catch(()=>0);
  const imgs = await p.$$eval(".ts-msg img.tm-thumb", e=>e.length).catch(()=>0);
  const loaded = await p.$$eval(".ts-msg img.tm-thumb", e=>e.filter(x=>x.naturalWidth>0).length).catch(()=>0);
  const failed = await p.$$eval(".tm-thumb-failed", e=>e.length).catch(()=>0);
  const txt = await p.$$eval(".ts-msg", e=>e.map(x=>x.innerText.replace(/\n/g," ")).join(" | ")).catch(()=>"");
  console.log(`   訊息 ${msgs} 則 · 圖片元素 ${imgs} · 真的載到 ${loaded} · 失敗 ${failed}`);
  console.log("   還有 [照片] 文字嗎:", txt.includes("[照片]"));
  await p.screenshot({ path: "/tmp/prod-inline.png", fullPage: true });
}
const e=[...new Set(errs)].filter(x=>!/favicon|analytics/i.test(x));
console.log("errors:", e.slice(0,4).join(" / ") || "(無)");
await b.close();
