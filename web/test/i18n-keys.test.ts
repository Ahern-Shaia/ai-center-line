/**
 * i18n key 守門 —— 程式碼裡 `tr("x.y")` 用到的 key，字典裡必須有。
 *
 * ⚠️⚠️ 為什麼要有這支：這一類 bug **tsc 全綠、build 全綠**，
 * 只有真的把那個畫面點開才看得到 —— 而畫面上印的是 `common.failed` 這種原始 key。
 * 一週內犯過 4 次，其中一次上了 prod（[[pitfall_text_to_key_render_not_updated]]）。
 * 2026-09-03 寫任務結束功能時又犯一次（`common.failed` 不存在，正確的是 `common.actionFailed`），
 * 所以改成用工具擋，不再靠自己記得。
 *
 * ⚠️ 順便擋反向：zh-TW 有、en 沒有（或反過來）＝ 切語言就會露出中文或 key。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};

/** 從字典檔抽出所有 key（"a.b": "…" 這種行）*/
const dictKeys = (file: string): Set<string> => {
  const src = readFileSync(join(SRC, "i18n", file), "utf8");
  return new Set([...src.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]));
};

const zh = dictKeys("zh-TW.ts");
const en = dictKeys("en.ts");

/**
 * 只抓**字面量** key：`tr("a.b")` / `t("a.b")`。
 * 動態組出來的（`tr(\`perm.${x}\`)`）抓不到，那是這支工具的已知盲點 ——
 * 寫在這裡是為了下次有人看到漏網時，知道不是工具壞了。
 */
const usedKeys = (): Map<string, string> => {
  const found = new Map<string, string>();
  for (const f of walk(SRC)) {
    if (f.includes(`${"i18n"}/`)) continue;          // 字典自己不算使用
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\b(?:tr|t)\(\s*"([a-zA-Z][\w.-]*\.[\w.-]+)"/g)) {
      if (!found.has(m[1])) found.set(m[1], f.slice(SRC.length + 1));
    }
  }
  return found;
};

test("⭐⭐ 程式碼用到的 i18n key，zh-TW 字典裡一定要有", () => {
  const missing = [...usedKeys()].filter(([k]) => !zh.has(k));
  assert.deepEqual(
    missing.map(([k, f]) => `${k}  ← ${f}`), [],
    "這些 key 在畫面上會直接印出 key 本身（tsc 不會報錯）",
  );
});

test("⭐ zh-TW 與 en 的 key 要一一對應（缺的那邊切語言就露餡）", () => {
  const onlyZh = [...zh].filter((k) => !en.has(k));
  const onlyEn = [...en].filter((k) => !zh.has(k));
  assert.deepEqual({ onlyZh, onlyEn }, { onlyZh: [], onlyEn: [] });
});
