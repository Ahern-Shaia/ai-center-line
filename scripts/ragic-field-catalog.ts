/**
 * 把 _field-id-map.json 展成 Excel/CSV 友善的欄位對照表。
 *
 * 產物：
 *   .ragic-export/_field-catalog.csv         單檔 · 所有 sheet 的欄位 · 直接 Excel 篩選
 *   .ragic-export/_field-catalog/{tab}/{sheet}.csv   每 sheet 一份 · 直接對照用
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const EXPORT_DIR = resolve(ROOT, ".ragic-export");

type Manifest = Array<{
  tabPath: string;
  tabName: string;
  sheetId: string;
  sheetName: string;
  status: string;
}>;
type FieldMap = Record<string, string>;
type FieldIdMap = Record<string, { map: FieldMap; issues: string[] }>;

function safeSlug(s: string): string {
  return s.replace(/[\/\\:*?"<>|()]/g, "").replace(/\s+/g, "_");
}

function csvEscape(v: string): string {
  if (v == null) return "";
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function main() {
  const manifest: Manifest = JSON.parse(readFileSync(resolve(EXPORT_DIR, "_manifest.json"), "utf-8"));
  const fieldIdMap: FieldIdMap = JSON.parse(readFileSync(resolve(EXPORT_DIR, "_field-id-map.json"), "utf-8"));

  const perSheetDir = resolve(EXPORT_DIR, "_field-catalog");
  if (!existsSync(perSheetDir)) mkdirSync(perSheetDir, { recursive: true });

  // 產每 sheet 一份 CSV + 累積 all-in-one
  const allRows: string[] = ["﻿tab_name,tab_path,sheet_name,sheet_id,field_name,field_id"];
  let sheetsWritten = 0;
  let fieldsWritten = 0;

  for (const entry of manifest) {
    const key = `${entry.tabPath}/${entry.sheetId}`;
    const mapEntry = fieldIdMap[key];
    if (!mapEntry || Object.keys(mapEntry.map).length === 0) continue;

    // per-sheet CSV
    const perLines = ["﻿field_name,field_id"];
    for (const [name, id] of Object.entries(mapEntry.map)) {
      perLines.push(`${csvEscape(name)},${id}`);
      allRows.push(
        `${csvEscape(entry.tabName)},${csvEscape(entry.tabPath)},${csvEscape(entry.sheetName)},${entry.sheetId},${csvEscape(name)},${id}`,
      );
      fieldsWritten++;
    }
    const tabDir = resolve(perSheetDir, safeSlug(entry.tabName));
    mkdirSync(tabDir, { recursive: true });
    const csvPath = resolve(tabDir, `${entry.sheetId}_${safeSlug(entry.sheetName)}.csv`);
    writeFileSync(csvPath, perLines.join("\n"));
    sheetsWritten++;
  }

  writeFileSync(resolve(EXPORT_DIR, "_field-catalog.csv"), allRows.join("\n"));

  console.log(`✅ 完成`);
  console.log(`  單檔（all-in-one，Excel 開就能篩）：.ragic-export/_field-catalog.csv`);
  console.log(`  每 sheet 一份：.ragic-export/_field-catalog/{tab}/{sheetId}_{name}.csv`);
  console.log(`  sheet 數：${sheetsWritten} · 欄位總數：${fieldsWritten}`);
}

main();
