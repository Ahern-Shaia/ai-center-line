/**
 * Ragic API bulk import：把 .ragic-export/{tab}/*.json 的資料 POST 到 aitode 對應 sheet
 *
 * 兩階段：
 *   Phase 1 Discovery — 對每張 aitode sheet 建 name↔id 對照表（marker POST + GET）
 *   Phase 2 Import — 用對照表把客戶記錄轉成 aitode field-ID payload，逐筆 POST
 *
 * 用法：
 *   tsx scripts/ragic-api-import.ts --sheet /shared-data/25          # 試灌單張
 *   tsx scripts/ragic-api-import.ts --phase discovery                # 只跑 name↔id 探測
 *   tsx scripts/ragic-api-import.ts --dry-run --sheet /shared-data/25 # 預覽不動 API
 *   tsx scripts/ragic-api-import.ts                                  # 全量（先 discovery 再 import）
 *   tsx scripts/ragic-api-import.ts --resume                         # 從 progress 續跑
 *
 * 環境變數（server/.env）：
 *   RAGIC_TEST_BASE_URL / RAGIC_TEST_ACCOUNT / RAGIC_TEST_API_KEY
 *
 * 產物：
 *   .ragic-export/_field-id-map.json   {sheet_path: {name: id}, ...}
 *   .ragic-export/_import-log.jsonl    每筆 POST 結果（append-only）
 *   .ragic-export/_import-progress.json 上次跑到哪，續跑用
 *   .ragic-export/_import-report.md    人看的統計報告
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const EXPORT_DIR = resolve(ROOT, ".ragic-export");

function loadEnv(): Record<string, string> {
  const envPath = resolve(ROOT, "server/.env");
  const env: Record<string, string> = {};
  const text = readFileSync(envPath, "utf-8");
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
if (!BASE_URL || !ACCOUNT || !API_KEY) {
  console.error("❌ RAGIC_TEST_BASE_URL / RAGIC_TEST_ACCOUNT / RAGIC_TEST_API_KEY 都要設定");
  process.exit(1);
}
const AUTH = { Authorization: `Basic ${API_KEY}` };

// CLI
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const getFlag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const SHEET_FILTER = getFlag("--sheet"); // e.g. "/shared-data/25"
const PHASE = getFlag("--phase") ?? "all"; // discovery | import | all
const DRY_RUN = flag("--dry-run");
const RESUME = flag("--resume");

// 系統欄位（來源客戶資料中要跳過）
const SYSTEM_COL_EXACT = new Set(["_ragic_id", "_ragicId", "_star", "_dataTimestamp", "_seq"]);
const SYSTEM_COL_PREFIX = ["_index_", "_subtable_"];
function isSystemCol(name: string): boolean {
  if (SYSTEM_COL_EXACT.has(name)) return true;
  for (const p of SYSTEM_COL_PREFIX) if (name.startsWith(p)) return true;
  return false;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// -------- 核心 HTTP helper --------

async function ragicPostForm(path: string, data: Record<string, string>): Promise<any> {
  const url = `${BASE_URL}/${ACCOUNT}${path}?api`;
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) body.append(k, v);
  const res = await fetch(url, { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (res.status === 403) throw new Error("Ragic 403 IP block（暫停腳本，等 5-10 分鐘）");
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response: ${text.slice(0, 200)}`);
  }
}

async function ragicGet(path: string): Promise<any> {
  const url = `${BASE_URL}/${ACCOUNT}${path}?api`;
  const res = await fetch(url, { headers: AUTH });
  if (res.status === 403) throw new Error("Ragic 403 IP block");
  const text = await res.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function ragicDelete(path: string): Promise<any> {
  const url = `${BASE_URL}/${ACCOUNT}${path}?api`;
  const res = await fetch(url, { method: "DELETE", headers: AUTH });
  if (res.status === 403) throw new Error("Ragic 403 IP block");
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// -------- Phase 1: Discovery (name ↔ id) --------

type FieldMap = Record<string, string>; // name -> id

function extractRecord(getResp: any, ragicId: number | string): any {
  return getResp[String(ragicId)] ?? getResp[ragicId] ?? Object.values(getResp)[0] ?? {};
}

async function discoverFieldMap(sheetPath: string): Promise<{ map: FieldMap; issues: string[] }> {
  const issues: string[] = [];

  // Step 1: 建 probe record（先試空 POST；被必填擋就記錄）
  const step1 = await ragicPostForm(sheetPath, {});
  if (step1.status === "ERROR") throw new Error(`Sheet ${sheetPath} 不存在: ${step1.msg}`);
  if (step1.status === "INVALID") {
    issues.push(`INVALID on empty POST（可能有必填欄）: ${step1.msg}`);
  }
  const recordId: number | string | null = step1.ragicId ?? null;
  const allIds: string[] = step1?.data
    ? Object.keys(step1.data).filter((k) => /^\d+$/.test(k))
    : [];
  if (recordId == null || allIds.length === 0) {
    issues.push("拿不到 probe record 或欄位列表，略過");
    return { map: {}, issues };
  }
  await sleep(400);

  const map: FieldMap = {};

  // Pass A: TEXT marker（MRK{id}）
  const passA: Record<string, string> = {};
  for (const id of allIds) passA[id] = `MRK${id}`;
  await ragicPostForm(`${sheetPath}/${recordId}`, passA);
  await sleep(400);
  const respA = await ragicGet(`${sheetPath}/${recordId}`);
  const recA = extractRecord(respA, recordId);
  for (const [name, value] of Object.entries(recA)) {
    if (isSystemCol(name)) continue;
    const m = String(value).match(/^MRK(\d+)$/);
    if (m) map[name] = m[1];
  }

  // Pass B: DATE marker for unmapped
  const mappedIds = () => new Set(Object.values(map));
  let unmapped = allIds.filter((id) => !mappedIds().has(id));
  if (unmapped.length > 0) {
    const passB: Record<string, string> = {};
    // 用 2001/01/01 .. 03/22（涵蓋 81 個欄位；超過則 reset year）
    let dayIdx = 0;
    for (const id of unmapped) {
      const y = 2001 + Math.floor(dayIdx / 340);
      const dayOfYear = dayIdx % 340;
      const m = Math.floor(dayOfYear / 28) + 1;
      const d = (dayOfYear % 28) + 1;
      passB[id] = `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
      dayIdx++;
    }
    await sleep(400);
    await ragicPostForm(`${sheetPath}/${recordId}`, passB);
    await sleep(400);
    const respB = await ragicGet(`${sheetPath}/${recordId}`);
    const recB = extractRecord(respB, recordId);
    // 對每個仍未 mapped 的 id，找 value 等於預期日期的 name
    const idToExpected = new Map(Object.entries(passB));
    for (const id of unmapped) {
      const expected = idToExpected.get(id)!;
      for (const [name, value] of Object.entries(recB)) {
        if (isSystemCol(name) || map[name]) continue;
        const norm = String(value).replace(/-/g, "/");
        if (norm === expected) {
          map[name] = id;
          break;
        }
      }
    }
  }

  // Pass C: NUMERIC marker for still-unmapped
  unmapped = allIds.filter((id) => !mappedIds().has(id));
  if (unmapped.length > 0) {
    const passC: Record<string, string> = {};
    let n = 90000001;
    for (const id of unmapped) passC[id] = String(n++);
    await sleep(400);
    await ragicPostForm(`${sheetPath}/${recordId}`, passC);
    await sleep(400);
    const respC = await ragicGet(`${sheetPath}/${recordId}`);
    const recC = extractRecord(respC, recordId);
    const idToExpected = new Map(Object.entries(passC));
    for (const id of unmapped) {
      const expected = idToExpected.get(id)!;
      for (const [name, value] of Object.entries(recC)) {
        if (isSystemCol(name) || map[name]) continue;
        if (String(value).replace(/[,\s]/g, "") === expected) {
          map[name] = id;
          break;
        }
      }
    }
  }

  // 仍然 unmapped：可能是下拉、圖片、必須指定範圍值的欄
  unmapped = allIds.filter((id) => !mappedIds().has(id));
  if (unmapped.length > 0) issues.push(`3 輪 marker 後仍未對照: ${unmapped.join(", ")}`);
  await sleep(400);

  // Cleanup: DELETE probe record
  try {
    await ragicDelete(`${sheetPath}/${recordId}`);
  } catch (e: any) {
    issues.push(`probe record 刪除失敗: ${e?.message ?? e}`);
  }

  return { map, issues };
}

// -------- Phase 2: Import --------

type SheetJob = {
  tabPath: string; // e.g. "/shared-data"
  tabName: string;
  sheetId: string;
  sheetName: string;
  outputJson?: string;
  records: number;
};

async function importSheet(job: SheetJob, fieldMap: FieldMap) {
  const jsonPath = resolve(ROOT, job.outputJson!);
  const records: any[] = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const targetPath = `${job.tabPath}/${job.sheetId}`;
  console.log(`  ▶ ${job.tabName} / ${job.sheetName} (${records.length} 筆 → ${targetPath})`);

  let ok = 0;
  let skipped = 0;
  let invalid = 0;
  let error = 0;
  const nameCols = new Set(Object.keys(fieldMap));

  const logPath = resolve(EXPORT_DIR, "_import-log.jsonl");

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    // 轉 payload: name → id
    const payload: Record<string, string> = {};
    let filledCount = 0;
    for (const [name, val] of Object.entries(rec)) {
      if (isSystemCol(name)) continue;
      if (!nameCols.has(name)) continue; // 客戶側有但 aitode 沒有的欄位就略過
      if (val === null || val === undefined || val === "") continue;
      const id = fieldMap[name];
      const s = typeof val === "string" ? val : typeof val === "object" ? JSON.stringify(val) : String(val);
      payload[id] = s;
      filledCount++;
    }
    if (filledCount === 0) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      if (i < 3) console.log(`    [${i + 1}] dry-run payload keys: ${Object.keys(payload).join(", ")}`);
      ok++;
      continue;
    }

    try {
      const resp = await ragicPostForm(targetPath, payload);
      if (resp.status === "SUCCESS") {
        ok++;
      } else if (resp.status === "INVALID") {
        invalid++;
        appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), sheet: targetPath, i, status: "INVALID", msg: resp.msg }) + "\n");
      } else {
        error++;
        appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), sheet: targetPath, i, status: "ERROR", resp }) + "\n");
      }
    } catch (e: any) {
      error++;
      appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), sheet: targetPath, i, status: "EXCEPTION", err: String(e?.message ?? e) }) + "\n");
      if (String(e?.message).includes("403")) throw e; // IP block → 中斷
    }
    if ((i + 1) % 50 === 0) console.log(`    …${i + 1}/${records.length} (ok=${ok} invalid=${invalid} err=${error})`);
    await sleep(700);
  }
  console.log(`  ✅ 完成 ${targetPath}: ok=${ok} invalid=${invalid} error=${error} skipped=${skipped}`);
  return { ok, invalid, error, skipped };
}

// -------- 主流程 --------

async function main() {
  if (!existsSync(EXPORT_DIR)) mkdirSync(EXPORT_DIR, { recursive: true });
  const manifest: SheetJob[] = JSON.parse(readFileSync(resolve(EXPORT_DIR, "_manifest.json"), "utf-8"));
  let jobs = manifest.filter((m: any) => m.status === "ok" && m.records && m.records > 0);
  if (SHEET_FILTER) {
    jobs = jobs.filter((j) => `${j.tabPath}/${j.sheetId}` === SHEET_FILTER);
    if (jobs.length === 0) {
      console.error(`❌ 找不到 sheet: ${SHEET_FILTER}`);
      process.exit(1);
    }
  }
  console.log(`📋 目標 sheet：${jobs.length}${DRY_RUN ? "（dry-run）" : ""}`);

  const mapPath = resolve(EXPORT_DIR, "_field-id-map.json");
  const allMaps: Record<string, { map: FieldMap; issues: string[] }> =
    existsSync(mapPath) && RESUME ? JSON.parse(readFileSync(mapPath, "utf-8")) : {};

  // Phase 1
  if (PHASE === "discovery" || PHASE === "all") {
    console.log(`\n═══ Phase 1: Discovery ═══`);
    for (const job of jobs) {
      const key = `${job.tabPath}/${job.sheetId}`;
      if (allMaps[key] && Object.keys(allMaps[key].map).length > 0) {
        console.log(`  ⏭️  ${job.tabName} / ${job.sheetName} (${key}) 已在快取 ${Object.keys(allMaps[key].map).length} 欄`);
        continue;
      }
      try {
        if (DRY_RUN) {
          console.log(`  · dry-run: 會探 ${key}`);
          continue;
        }
        const { map, issues } = await discoverFieldMap(key);
        allMaps[key] = { map, issues };
        writeFileSync(mapPath, JSON.stringify(allMaps, null, 2));
        console.log(`  ✅ ${job.tabName} / ${job.sheetName}: ${Object.keys(map).length} 欄對照${issues.length ? " ⚠️ " + issues.join("; ") : ""}`);
      } catch (e: any) {
        console.error(`  ❌ ${key}: ${e?.message ?? e}`);
        allMaps[key] = { map: {}, issues: [`探測失敗: ${String(e?.message ?? e)}`] };
        writeFileSync(mapPath, JSON.stringify(allMaps, null, 2));
        if (String(e?.message).includes("403")) {
          console.error("💥 IP block，中斷");
          process.exit(1);
        }
      }
      await sleep(500);
    }
  }

  // Phase 2
  if (PHASE === "import" || PHASE === "all") {
    console.log(`\n═══ Phase 2: Import ═══`);
    const totals = { ok: 0, invalid: 0, error: 0, skipped: 0 };
    for (const job of jobs) {
      const key = `${job.tabPath}/${job.sheetId}`;
      const entry = allMaps[key];
      if (!entry || Object.keys(entry.map).length === 0) {
        console.log(`  ⏭️  ${key}: 無對照表，略過`);
        continue;
      }
      const r = await importSheet(job, entry.map);
      totals.ok += r.ok;
      totals.invalid += r.invalid;
      totals.error += r.error;
      totals.skipped += r.skipped;
    }
    console.log(`\n═══ 完成 ═══`);
    console.log(`  ✅ ok=${totals.ok}  ⚠️ invalid=${totals.invalid}  ❌ error=${totals.error}  ⏭ skipped=${totals.skipped}`);
  }
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
