/**
 * 刪掉 aitode 指定 sheet 的所有記錄（丟 recycle bin）
 * 用法：tsx scripts/ragic-delete-sheet.ts /shared-data/25
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const text = readFileSync(resolve(ROOT, "server/.env"), "utf-8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2];
  }
  return env;
}
const env = loadEnv();
const BASE_URL = (env.RAGIC_TEST_BASE_URL || "").replace(/\/+$/, "");
const ACCOUNT = env.RAGIC_TEST_ACCOUNT;
const API_KEY = env.RAGIC_TEST_API_KEY;

const path = process.argv[2];
if (!path) {
  console.error("用法：tsx scripts/ragic-delete-sheet.ts /shared-data/25");
  process.exit(1);
}

async function main() {
  const H = { Authorization: `Basic ${API_KEY}` };
  console.log(`🗑  掃 ${ACCOUNT}${path} 的所有記錄...`);
  const all: string[] = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${BASE_URL}/${ACCOUNT}${path}?api&limit=1000&offset=${offset}`, { headers: H });
    const j = await res.json();
    const ids = Object.keys(j).filter((k) => /^-?\d+$/.test(k));
    if (ids.length === 0) break;
    all.push(...ids);
    if (ids.length < 1000) break;
    offset += 1000;
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`   共 ${all.length} 筆待刪`);
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < all.length; i++) {
    const id = all[i];
    try {
      const res = await fetch(`${BASE_URL}/${ACCOUNT}${path}/${id}?api`, { method: "DELETE", headers: H });
      const j = await res.json();
      if (j.msg?.includes("recycle") || res.ok) ok++;
      else fail++;
    } catch {
      fail++;
    }
    if ((i + 1) % 50 === 0) process.stdout.write(`\r   進度 ${i + 1}/${all.length} (ok=${ok} fail=${fail})`);
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`\n✅ 完成：ok=${ok} fail=${fail}`);
}
main().catch(console.error);
