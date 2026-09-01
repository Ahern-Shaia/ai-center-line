/**
 * 客戶的真實員工姓名不可以進版控。
 *
 * 起因：2026-09-01 我畫 mockup 時直接用了客戶私訊的原文（車型／車號／三個人名）。
 *      修掉之後順手掃全 repo，發現**先前就有 28 個檔案、141 處**含真實姓名 ——
 *      而這個 repo 是 **public**。其中最要緊的兩處：
 *        · `web/public/handbook.html`（SVG 插圖裡）—— 公開網址上線中，而且是交付給客戶的手冊
 *        · `server/src/personal-daily-report/personal-daily-report.controller.ts` 的註解
 *
 * ⚠️⚠️ **這支測試本身不可以寫出那些名字** —— 那等於把它們又放回 repo。
 *    所以存的是 SHA-256 的前 16 碼：**單向、不可還原**，但足以回答
 *    「這個檔案裡有沒有出現某個已知的名字」。
 *
 * ⚠️ 這只擋「以後」。已經 push 的仍然在 git 歷史裡，公開可讀 ——
 *    要真正關掉曝光只有把 repo 轉 private（或改寫歷史）。
 *
 * 加新名字的方法（不要把明文貼進來）：
 *   node -e "console.log(require('crypto').createHash('sha256').update('姓名').digest('hex').slice(0,16))"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** 已知客戶員工姓名的 sha256 前 16 碼 · 明文不留在 repo 裡 */
const BANNED = new Set([
  "15c4152b6235c85a", "8b46b638fd694b4a", "0f5db2eb446a9133",
  "1f36228db5b2cc44", "78e627f5778cc30d", "71d361ee6fd9936f",
  "e90c9f7997e1620d", "44fde654f5b7bfee", "38a1c0ee125a58c4",
  "e42e5767aa6ad0fc", "2aba5dd8596b2dc0",
]);

const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/**
 * 從文字裡切出「可能是名字」的候選。
 *
 * ⚠️⚠️ 中文**必須用滑動視窗**，不可以用 `/[一-鿿]{2,4}/g` 直接切詞。
 *    那個寫法是貪婪比對：「顧問蘭萱組長」會切成「顧問蘭萱」「組長」，
 *    **切不出中間那個 2 字的名字** —— 我第一版就是這樣寫的，
 *    反向驗證（把真名放回去）時測試照樣綠，才發現它是裝飾品。
 */
function candidates(text: string): Set<string> {
  const out = new Set<string>();
  for (const run of text.match(/[一-鿿]+/g) ?? []) {
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i + len <= run.length; i++) out.add(run.slice(i, i + len));
    }
  }
  for (const m of text.matchAll(/\b[A-Z][a-z]{2,11}\b/g)) out.add(m[0]);
  return out;
}

test("⭐⭐ 版控裡不可以有客戶的真實員工姓名（repo 是 public）", () => {
  const root = join(fileURLToPath(new URL("../..", import.meta.url)));
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean);

  const hits: string[] = [];
  for (const f of files) {
    // 二進位／圖片跳過
    if (/\.(png|jpe?g|gif|ico|pdf|docx?|xlsx?|zip|woff2?)$/i.test(f)) continue;
    let text: string;
    try { text = readFileSync(join(root, f), "utf8"); } catch { continue; }
    // 這支測試自己存的是雜湊，不會命中；但排掉比較不會誤會
    if (f.endsWith("no-real-customer-names.test.ts")) continue;
    for (const c of candidates(text)) {
      if (BANNED.has(h(c))) { hits.push(f); break; }
    }
  }

  assert.deepEqual(hits, [],
    "這些檔案含客戶的真實員工姓名，而 repo 是 public：\n"
    + hits.map((f) => `  ${f}`).join("\n")
    + "\n\n改成假名（王○○ / 林○○ / 蔡○○ 這種）。"
    + "⚠️ 只換檔案不夠 —— 已經 push 的還在 git 歷史裡。");
});

test("⭐ 雜湊比對本身要能抓到東西（不然這支測試是永遠綠的裝飾品）", () => {
  // ⚠️ 沒有這一段的話，BANNED 打錯字、candidates() 切錯詞，
  //    測試都會安靜地過 —— 綠燈的原因是「什麼都沒比對到」。
  //    這裡用一個**已知會命中**的樣本反向確認機制是活的。
  const sample = candidates("報告人 Cathy 已完成");
  assert.ok([...sample].some((c) => BANNED.has(h(c))),
    "比對機制壞了：拿一個已知的名字進來也抓不到");
  // ⚠️ 這一條才是重點：名字**夾在一長串中文中間**時也要抓得到
  //    （第一版的貪婪切詞在這裡會漏掉）
  const buried = candidates("顧問蘭萱組長已於今日完成核對");
  assert.ok([...buried].some((c) => BANNED.has(h(c))),
    "夾在長串中文裡的名字抓不到 —— 切詞方式有問題，這支測試會變成裝飾品");
  const clean = candidates("報告人 王○○ 已完成");
  assert.ok(![...clean].some((c) => BANNED.has(h(c))),
    "假名不該被判定成真名");
});
