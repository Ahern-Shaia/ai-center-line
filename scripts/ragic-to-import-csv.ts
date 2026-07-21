/**
 * 將 .ragic-export/{tab}/*.json 轉成 Ragic UI 可直接匯入的乾淨 CSV。
 *
 * 過濾規則（去掉這些欄，避免 Ragic UI 建 sheet 時被當成資料欄位）：
 *   _ragic_id、_ragicId、_star、_dataTimestamp、_seq
 *   _index_title_、_index_、_index_calDates_、_index_calDates2_ ...等 _index_ 開頭
 *   _subtable_XXXXXXX（子表巢狀資料，用戶決定不匯入，日後另處理）
 *
 * 輸出結構：
 *   .ragic-export/_import/{tabSlug}/{sheetName}.csv
 *   .ragic-export/_import/_index.md      匯入順序建議 + tab 對照表
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const EXPORT_DIR = resolve(ROOT, ".ragic-export");
const OUT_DIR = resolve(EXPORT_DIR, "_import");

const SYSTEM_COL_EXACT = new Set([
  "_ragic_id",
  "_ragicId",
  "_star",
  "_dataTimestamp",
  "_seq",
]);
const SYSTEM_COL_PREFIX = ["_index_", "_subtable_"];

function isSystemColumn(name: string): boolean {
  if (SYSTEM_COL_EXACT.has(name)) return true;
  for (const p of SYSTEM_COL_PREFIX) if (name.startsWith(p)) return true;
  return false;
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCleanCsv(records: any[]): { csv: string; keptCols: string[]; strippedCols: string[] } {
  if (records.length === 0) return { csv: "", keptCols: [], strippedCols: [] };
  const seen = new Set<string>();
  const order: string[] = [];
  for (const rec of records) {
    for (const k of Object.keys(rec)) {
      if (!seen.has(k)) {
        seen.add(k);
        order.push(k);
      }
    }
  }
  const keptCols = order.filter((k) => !isSystemColumn(k));
  const strippedCols = order.filter((k) => isSystemColumn(k));
  const lines = ["﻿" + keptCols.join(",")]; // BOM 讓 Excel/Ragic 讀中文不亂碼
  for (const rec of records) {
    lines.push(keptCols.map((k) => csvEscape(rec[k])).join(","));
  }
  return { csv: lines.join("\n"), keptCols, strippedCols };
}

// 匯入順序建議（tab 層級；同 tab 內主檔優先）
// 依「外鍵在 CSV 匯入時 Ragic 抓不到 → 只當文字欄」的限制，仍建議先主檔後憑單，之後手動綁參照時比對得上
const TAB_IMPORT_ORDER: Array<{ tab: string; note: string }> = [
  { tab: "共用資料(正航)", note: "全部先進：人員/客戶/廠商/產品/部門/幣別/類別" },
  { tab: "會計科目", note: "科目、銀行、開戶行" },
  { tab: "Ragic系統管理", note: "使用者、群組、公司設定" },
  { tab: "訂單作業", note: "報價/訂購/採購/請購/詢價憑單" },
  { tab: "庫存管理", note: "進貨/銷貨/進退/銷退" },
  { tab: "帳款管理", note: "收款/付款/發票" },
  { tab: "生產管理", note: "製令/領退/入庫/BOM" },
  { tab: "客服單據", note: "TB-P71 維修保養單北中南" },
  { tab: "客服管理", note: "問題大類/小類/服務方式" },
  { tab: "台灣福祉", note: "TB-P09 車輛履歷、動態看板等（多為空）" },
  { tab: "品保相關", note: "TB-T04 檢驗紀錄、QRQC" },
  { tab: "盤點作業", note: "盤點紀錄" },
  { tab: "CRM", note: "生產履歷查詢、業務日報" },
  { tab: "報工及車輛調度(Line)", note: "生產調度計畫表（LINE 通知相關）" },
];

function tabSlug(tabName: string): string {
  return tabName.replace(/[\/\\:*?"<>|()]/g, "").replace(/\s+/g, "_");
}

function sheetSlug(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, "_").replace(/\s+/g, "_");
}

type Manifest = Array<{
  tabPath: string;
  tabName: string;
  sheetId: string;
  sheetName: string;
  status: string;
  records?: number;
  outputJson?: string;
}>;

function main() {
  const manifest: Manifest = JSON.parse(readFileSync(resolve(EXPORT_DIR, "_manifest.json"), "utf-8"));
  const okEntries = manifest.filter((m) => m.status === "ok" && m.records && m.records > 0);
  console.log(`📋 待轉檔 sheet：${okEntries.length} 張`);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const perTab: Record<string, Array<{ sheetName: string; records: number; csvPath: string; strippedCols: string[] }>> = {};
  let totalRecords = 0;
  let totalStripped = 0;

  for (const entry of okEntries) {
    if (!entry.outputJson) continue;
    const jsonPath = resolve(ROOT, entry.outputJson);
    if (!existsSync(jsonPath)) {
      console.warn(`  ⚠️  找不到 ${entry.outputJson}`);
      continue;
    }
    const records = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const { csv, keptCols, strippedCols } = toCleanCsv(records);
    const tabDir = resolve(OUT_DIR, tabSlug(entry.tabName));
    mkdirSync(tabDir, { recursive: true });
    const csvName = `${sheetSlug(entry.sheetName)}.csv`;
    writeFileSync(resolve(tabDir, csvName), csv);
    perTab[entry.tabName] ??= [];
    perTab[entry.tabName].push({
      sheetName: entry.sheetName,
      records: records.length,
      csvPath: `_import/${tabSlug(entry.tabName)}/${csvName}`,
      strippedCols,
    });
    totalRecords += records.length;
    totalStripped += strippedCols.length;
    process.stdout.write(
      `  ✅ ${entry.tabName} / ${entry.sheetName}: ${records.length} 筆、留 ${keptCols.length} 欄` +
        (strippedCols.length ? ` (去掉 ${strippedCols.length} 系統欄)` : "") +
        "\n",
    );
  }

  // 產匯入指引 markdown
  const md: string[] = [];
  md.push("# Ragic 測試環境匯入指引\n");
  md.push(`> 產生時間：${new Date().toISOString()}`);
  md.push(`> 來源：客戶 Ragic（帳號 twbraun / 2026carhouse）匯出、去掉 Ragic 系統欄與 subtable 後的乾淨 CSV`);
  md.push(`> 檔案數：${okEntries.length} 張 sheet，共 ${totalRecords.toLocaleString()} 筆`);
  md.push("");
  md.push("## 操作方式（Ragic UI）\n");
  md.push("1. 進入你司測試 Ragic 帳號");
  md.push("2. 依下方**建議順序**逐 tab 建立 → 每張 sheet：");
  md.push("   - 點右上「建立新 Sheet」→「從 Excel / CSV 建立」");
  md.push("   - 選對應 tab 底下的 `.csv` 檔");
  md.push("   - Ragic 會自動偵測欄位、建 sheet + 匯入資料");
  md.push("3. **建 sheet 後手動調整**：");
  md.push("   - 日期欄：改為「日期」型（Ragic 匯入時預設當文字）");
  md.push("   - 客戶 / 廠商 / 產品編號等欄位：改為「從另一 sheet 選擇」的參照欄");
  md.push("   - 下拉：型別、單位等改為「下拉」");
  md.push("   - 公式欄：Ragic 匯入時不自帶公式，要重設");
  md.push("");
  md.push("## 建議匯入順序\n");
  md.push("| 順序 | Tab | 說明 |\n|---|---|---|");
  const knownTabs = new Set(TAB_IMPORT_ORDER.map((o) => o.tab));
  let seq = 1;
  for (const { tab, note } of TAB_IMPORT_ORDER) {
    if (perTab[tab]) md.push(`| ${seq++} | ${tab} | ${note} |`);
  }
  for (const tab of Object.keys(perTab)) {
    if (!knownTabs.has(tab)) md.push(`| ${seq++} | ${tab} | （未列在推薦順序，最後匯入即可） |`);
  }
  md.push("");
  md.push("## 各 Tab 檔案清單\n");
  const orderedTabs = [
    ...TAB_IMPORT_ORDER.map((o) => o.tab).filter((t) => perTab[t]),
    ...Object.keys(perTab).filter((t) => !knownTabs.has(t)),
  ];
  for (const tab of orderedTabs) {
    const sheets = perTab[tab];
    if (!sheets) continue;
    const sumR = sheets.reduce((s, x) => s + x.records, 0);
    md.push(`### ${tab}（${sheets.length} 張、${sumR.toLocaleString()} 筆）\n`);
    md.push("| Sheet | 筆數 | CSV |");
    md.push("|---|--:|---|");
    for (const s of sheets.sort((a, b) => b.records - a.records)) {
      md.push(`| ${s.sheetName} | ${s.records.toLocaleString()} | \`${s.csvPath}\` |`);
    }
    md.push("");
  }
  md.push("## 已被去掉的系統欄與 subtable\n");
  md.push(`共去掉 ${totalStripped} 個系統欄位次（去重的欄位名見下）：\n`);
  const allStripped = new Set<string>();
  for (const list of Object.values(perTab)) for (const s of list) for (const c of s.strippedCols) allStripped.add(c);
  md.push("```");
  md.push([...allStripped].sort().join("\n"));
  md.push("```");
  md.push("");
  md.push("**subtable 資料處理**：目前這一輪不匯入。日後若要重建主表 ↔ 子表關聯，可另寫 script parse `_subtable_*` 欄的 JSON string 後透過 API POST 進 Ragic。");

  writeFileSync(resolve(OUT_DIR, "_index.md"), md.join("\n"));

  console.log(`\n═══ 完成 ═══`);
  console.log(`  📦 CSV：       ${okEntries.length} 張`);
  console.log(`  🔢 總筆數：    ${totalRecords.toLocaleString()}`);
  console.log(`  🧹 去掉系統欄： ${totalStripped} 欄位次`);
  console.log(`  📝 匯入指引：  .ragic-export/_import/_index.md`);
}

main();
