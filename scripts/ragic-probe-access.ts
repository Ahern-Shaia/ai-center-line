/**
 * 掃 Ragic 帳號內每個 sheet 的可存取性（HEAD 一頁 limit=1 就退出）
 * 用於評估這把 API key 到底能拉多少張表
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const EXPORT_DIR = resolve(ROOT, ".ragic-export");

function loadEnv() {
  const env: Record<string, string> = {};
  const text = readFileSync(resolve(ROOT, "server/.env"), "utf-8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const BASE_URL = env.RAGIC_BASE_URL || "https://ap16.ragic.com";
const ACCOUNT = env.RAGIC_ACCOUNT || "2026carhouse";
const API_KEY = env.RAGIC_API_KEY;
const REAL_ACCOUNT = "twbraun";

const tree = JSON.parse(readFileSync(resolve(EXPORT_DIR, "_account-tree.json"), "utf-8"));
const acct = tree[REAL_ACCOUNT];

type Row = { tab: string; sheetId: string; sheetName: string; status: string; msg?: string };
const rows: Row[] = [];

async function probe(tabPath: string, sheetId: string, sheetName: string, tabName: string) {
  const url = `${BASE_URL}/${ACCOUNT}${tabPath}/${sheetId}?api&naming=UNDERLINE&limit=1`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${API_KEY}` } });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { rows.push({ tab: tabName, sheetId, sheetName, status: "non-json" }); return; }
    if (json?.status === "ERROR") {
      rows.push({ tab: tabName, sheetId, sheetName, status: `err-${json.code}`, msg: json.msg });
    } else {
      const count = Object.keys(json).filter((k) => /^-?\d+$/.test(k)).length;
      rows.push({ tab: tabName, sheetId, sheetName, status: count > 0 ? "ok" : "empty" });
    }
  } catch (e: any) {
    rows.push({ tab: tabName, sheetId, sheetName, status: "network", msg: e?.message });
  }
}

const tasks: Array<() => Promise<void>> = [];
for (const [tabPath, tabNode] of Object.entries<any>(acct.children)) {
  if (!tabNode.children) continue;
  const normalizedTabPath = tabPath.startsWith("/") ? tabPath : `/${tabPath}`;
  for (const [sheetKey, sheetNode] of Object.entries<any>(tabNode.children)) {
    if (sheetNode.type === "report") continue;
    tasks.push(() => probe(normalizedTabPath, sheetKey, sheetNode.name, tabNode.name));
  }
}

console.log(`探查 ${tasks.length} 個 sheet 的存取性...`);
// 並行 4，減少總時間
const CONC = 4;
let idx = 0;
async function worker() {
  while (idx < tasks.length) {
    const my = idx++;
    if (my % 20 === 0) process.stdout.write(`\r  進度 ${my}/${tasks.length}`);
    await tasks[my]();
    await new Promise((r) => setTimeout(r, 60));
  }
}
Promise.all(Array.from({ length: CONC }, worker)).then(() => {
  console.log(`\r  進度 ${tasks.length}/${tasks.length}  ✅`);
  // 統計
  const by: Record<string, number> = {};
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  console.log("\n═══ 依狀態統計 ═══");
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`);
  const okList = rows.filter((r) => r.status === "ok" || r.status === "empty");
  if (okList.length > 0) {
    console.log(`\n═══ 可存取 sheet (${okList.length}) ═══`);
    for (const r of okList) console.log(`  ${r.status.padEnd(6)} ${r.tab} / ${r.sheetName} (${r.sheetId})`);
  }
  const errList = rows.filter((r) => r.status !== "ok" && r.status !== "empty");
  const errBySample: Record<string, string> = {};
  for (const r of errList) if (!errBySample[r.status] && r.msg) errBySample[r.status] = r.msg;
  console.log("\n═══ 錯誤訊息樣本 ═══");
  for (const [k, v] of Object.entries(errBySample)) console.log(`  [${k}] ${v}`);
});
