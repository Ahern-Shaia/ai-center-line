/**
 * Ragic 全量匯出腳本
 *
 * 用法：
 *   tsx scripts/ragic-export.ts                # 全量
 *   tsx scripts/ragic-export.ts --sample       # 只跑 3 個代表性 sheet 驗證
 *   tsx scripts/ragic-export.ts --tab 訂單作業  # 只跑指定 tab
 *   tsx scripts/ragic-export.ts --dry-run      # 只列出計畫，不真的下載
 *
 * env（讀 server/.env）：
 *   RAGIC_BASE_URL  RAGIC_ACCOUNT  RAGIC_API_KEY
 *
 * 輸出：
 *   .ragic-export/_account-tree.json         帳號結構樹（已由 probe 產生）
 *   .ragic-export/_manifest.json             sheet 清單（tab/name/id/status/records）
 *   .ragic-export/_summary.json              執行統計（成功/失敗/access-denied）
 *   .ragic-export/{tab_path}/{sheetId}.json  每張 sheet 的原始 JSON
 *   .ragic-export/{tab_path}/{sheetId}.csv   對應 CSV（供 Ragic UI 匯入）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const EXPORT_DIR = resolve(ROOT, ".ragic-export");

function loadEnv(): Record<string, string> {
  const envPath = resolve(ROOT, "server/.env");
  const env: Record<string, string> = {};
  if (!existsSync(envPath)) throw new Error(`找不到 ${envPath}`);
  const text = readFileSync(envPath, "utf-8");
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
if (!API_KEY) throw new Error("RAGIC_API_KEY 未設定");

const REAL_ACCOUNT = "twbraun"; // 探查後確認的真實帳號名（doc 上寫的 2026carhouse 是別名或錯的）

// CLI flags
const args = process.argv.slice(2);
const SAMPLE_ONLY = args.includes("--sample");
const DRY_RUN = args.includes("--dry-run");
const TAB_FILTER = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;

// -------- account tree 解析 --------

type SheetEntry = {
  tabPath: string; // e.g. "/order-operation"
  tabName: string; // e.g. "訂單作業"
  sheetId: string; // e.g. "11"
  sheetName: string;
  type: "sheet" | "report";
  reportId?: number;
};

function parseAccountTree(tree: any): SheetEntry[] {
  const acct = tree[REAL_ACCOUNT] ?? Object.values(tree)[0];
  if (!acct?.children) throw new Error("account tree 結構異常");
  const entries: SheetEntry[] = [];
  for (const [tabPath, tabNode] of Object.entries<any>(acct.children)) {
    // tabPath 可能是 "Report" 或 "/order-operation"；tabNode.children 才是實際 sheets
    const tabName = tabNode.name ?? tabPath;
    const normalizedTabPath = tabPath.startsWith("/") ? tabPath : `/${tabPath}`;
    if (!tabNode.children) continue;
    for (const [sheetKey, sheetNode] of Object.entries<any>(tabNode.children)) {
      const type = sheetNode.type === "report" ? "report" : "sheet";
      entries.push({
        tabPath: normalizedTabPath,
        tabName,
        sheetId: type === "report" ? String(sheetNode.reportId ?? sheetKey) : sheetKey,
        sheetName: sheetNode.name ?? sheetKey,
        type,
        reportId: sheetNode.reportId,
      });
    }
  }
  return entries;
}

// -------- 下載 & 分頁 --------

const AUTH_HEADER = { Authorization: `Basic ${API_KEY}` };

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type FetchResult =
  | { status: "ok"; records: any[]; pages: number }
  | { status: "empty"; records: [] }
  | { status: "access-denied"; message: string }
  | { status: "error"; message: string };

async function fetchSheet(entry: SheetEntry): Promise<FetchResult> {
  if (entry.type === "report") {
    // reports 不走此 API；先記錄跳過（後續可用 xlsx 端點另處理）
    return { status: "error", message: "report 型別暫不支援 API 匯出" };
  }
  const records: any[] = [];
  const LIMIT = 1000;
  let offset = 0;
  let pages = 0;
  while (true) {
    const url = `${BASE_URL}/${ACCOUNT}${entry.tabPath}/${entry.sheetId}?api&naming=UNDERLINE&limit=${LIMIT}&offset=${offset}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: AUTH_HEADER });
    } catch (e: any) {
      return { status: "error", message: `network: ${e?.message ?? e}` };
    }
    if (res.status === 403) {
      // Ragic IP 保護觸發 → 立刻中斷，避免加深封鎖
      throw new Error(
        `Ragic 403 IP block（HTML 頁）— 已停止批次。等 5-10 分鐘 IP 解封再重跑。`,
      );
    }
    if (!res.ok) {
      return { status: "error", message: `HTTP ${res.status}` };
    }
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return { status: "error", message: `non-JSON body (${text.slice(0, 100)})` };
    }
    if (json?.status === "ERROR") {
      if (json.code === 106) return { status: "access-denied", message: json.msg };
      return { status: "error", message: `Ragic ERROR code=${json.code} ${json.msg}` };
    }
    // Ragic 回傳格式：{ "1": {...}, "2": {...}, ... } — key = record id
    const batch = Object.entries(json)
      .filter(([k]) => /^-?\d+$/.test(k))
      .map(([k, v]: [string, any]) => ({ _ragic_id: k, ...v }));
    records.push(...batch);
    pages++;
    if (batch.length < LIMIT) break;
    offset += LIMIT;
    await sleep(500); // 分頁間 rate limit
    if (pages > 100) {
      return { status: "error", message: `pagination overflow > 100 pages` };
    }
  }
  if (records.length === 0) return { status: "empty", records: [] };
  return { status: "ok", records, pages };
}

// -------- JSON → CSV --------

function toCsv(records: any[]): string {
  if (records.length === 0) return "";
  // 蒐集所有欄位（union of keys），保序：以第一筆順序為主，缺的補在後面
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    for (const k of Object.keys(rec)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  const escape = (v: any): string => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      s = `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [keys.join(",")];
  for (const rec of records) {
    lines.push(keys.map((k) => escape(rec[k])).join(","));
  }
  return "﻿" + lines.join("\n"); // BOM 確保 Excel 讀中文不亂碼
}

// -------- 主流程 --------

function safeSlug(s: string): string {
  return s.replace(/[\/\\:*?"<>|]/g, "_").replace(/\s+/g, "_");
}

async function main() {
  if (!existsSync(EXPORT_DIR)) mkdirSync(EXPORT_DIR, { recursive: true });
  const treePath = resolve(EXPORT_DIR, "_account-tree.json");
  if (!existsSync(treePath)) {
    console.error(`❌ 找不到 ${treePath}；請先跑 probe`);
    process.exit(1);
  }
  const tree = JSON.parse(readFileSync(treePath, "utf-8"));
  let entries = parseAccountTree(tree);

  if (TAB_FILTER) {
    entries = entries.filter(
      (e) => e.tabPath.includes(TAB_FILTER) || e.tabName.includes(TAB_FILTER),
    );
  }
  if (SAMPLE_ONLY) {
    // 3 個代表性 sheet：一個核心（分析表）、一個共用主檔（人員）、一個 CRM
    const picks = [
      entries.find((e) => e.sheetName.includes("分析表")),
      entries.find((e) => e.sheetName.includes("人員資料設定")),
      entries.find((e) => e.sheetName.includes("客戶資料設定")),
    ].filter(Boolean) as SheetEntry[];
    entries = picks;
  }

  console.log(`📋 目標 sheet 數：${entries.length}${DRY_RUN ? "（dry-run）" : ""}`);

  const manifest: Array<
    SheetEntry & { status: string; records?: number; message?: string; outputJson?: string; outputCsv?: string }
  > = [];
  const stats = { ok: 0, empty: 0, accessDenied: 0, error: 0, skipped: 0, totalRecords: 0 };
  const startAt = new Date().toISOString();

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const label = `[${i + 1}/${entries.length}] ${e.tabName} / ${e.sheetName} (${e.tabPath}/${e.sheetId})`;
    if (DRY_RUN) {
      console.log(`  · ${label}`);
      manifest.push({ ...e, status: "dry-run" });
      continue;
    }
    if (e.type === "report") {
      console.log(`  ⏭️  ${label} — report 跳過`);
      manifest.push({ ...e, status: "skipped-report", message: "report 型別暫不支援" });
      stats.skipped++;
      continue;
    }
    process.stdout.write(`  · ${label}... `);
    const result = await fetchSheet(e);
    const relDir = safeSlug(e.tabPath.replace(/^\//, "")) || "root";
    const dir = resolve(EXPORT_DIR, relDir);
    mkdirSync(dir, { recursive: true });
    const baseName = `${e.sheetId}_${safeSlug(e.sheetName)}`;

    if (result.status === "ok") {
      const jsonPath = resolve(dir, `${baseName}.json`);
      const csvPath = resolve(dir, `${baseName}.csv`);
      writeFileSync(jsonPath, JSON.stringify(result.records, null, 2));
      writeFileSync(csvPath, toCsv(result.records));
      console.log(`✅ ${result.records.length} 筆（${result.pages} 頁）`);
      manifest.push({
        ...e,
        status: "ok",
        records: result.records.length,
        outputJson: `.ragic-export/${relDir}/${baseName}.json`,
        outputCsv: `.ragic-export/${relDir}/${baseName}.csv`,
      });
      stats.ok++;
      stats.totalRecords += result.records.length;
    } else if (result.status === "empty") {
      console.log(`⚪ 0 筆（空表）`);
      manifest.push({ ...e, status: "empty", records: 0 });
      stats.empty++;
    } else if (result.status === "access-denied") {
      console.log(`🔒 access-denied`);
      manifest.push({ ...e, status: "access-denied", message: result.message });
      stats.accessDenied++;
    } else {
      console.log(`❌ ${result.message}`);
      manifest.push({ ...e, status: "error", message: result.message });
      stats.error++;
    }
    await sleep(700); // sheet 間 rate limit（~1.4 req/s，避開 Ragic IP 保護）
  }

  const summary = {
    startAt,
    endAt: new Date().toISOString(),
    account: REAL_ACCOUNT,
    baseUrl: BASE_URL,
    apiKeyOwner: "sandy@braun.com.tw",
    stats,
    filters: { sampleOnly: SAMPLE_ONLY, tabFilter: TAB_FILTER, dryRun: DRY_RUN },
  };
  writeFileSync(resolve(EXPORT_DIR, "_manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(resolve(EXPORT_DIR, "_summary.json"), JSON.stringify(summary, null, 2));

  console.log(`\n═══ 完成 ═══`);
  console.log(`  ✅ 有資料：${stats.ok}（共 ${stats.totalRecords} 筆）`);
  console.log(`  ⚪ 空表：  ${stats.empty}`);
  console.log(`  🔒 無權限：${stats.accessDenied}`);
  console.log(`  ⏭️  跳過：  ${stats.skipped}`);
  console.log(`  ❌ 錯誤：  ${stats.error}`);
  console.log(`\n  manifest: .ragic-export/_manifest.json`);
  console.log(`  summary:  .ragic-export/_summary.json`);
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
