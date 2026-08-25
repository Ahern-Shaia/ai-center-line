// 分類命名 · 2026-08-24 台灣福祉畫面出現 production_meeting / document_control
//
// ⭐⭐ 根因不是「模型亂造」，是**我們餵給它的範例全是英文**：
//     registry 空的時候 `loadKnownCategories` 回 `{slug, name: slug}`，
//     於是 prompt 裡是 `- daily_report (daily_report)` 一整排英文識別字，
//     模型照著樣板造新分類，自然生出英文 slug，然後直接印在客戶畫面上。
//
//     中文對照表當時**只存在於前端** `web/src/shared/categoryLabel.ts` ——
//     而模型看得到的是後端這一份。這支測試釘住兩邊一致。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_NAMES } from "../src/conversation-analysis/pipeline/schemas.js";

test("⭐⭐ 每個內建分類都要有中文名 —— 漏一個，模型就會看到英文樣板", () => {
  for (const slug of DEFAULT_CATEGORIES) {
    const name = DEFAULT_CATEGORY_NAMES[slug];
    assert.ok(name, `分類「${slug}」沒有中文名`);
    assert.ok(
      !/^[a-z0-9_-]+$/i.test(name),
      `分類「${slug}」的「中文名」是 ${name} —— 那還是英文識別字`,
    );
  }
});

test("⭐⭐ 後端的中文名要跟前端 categoryLabel.ts 一致（兩份漂移過一次）", () => {
  // 跨了後端／前端那道最常漂移的邊界。純資料常數，用正則取出來夠可靠。
  const src = readFileSync(new URL("../../web/src/shared/categoryLabel.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("CATEGORY_LABEL"), src.indexOf("};", src.indexOf("CATEGORY_LABEL")));

  const web: Record<string, string> = {};
  for (const m of body.matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)) web[m[1]!] = m[2]!;

  for (const slug of DEFAULT_CATEGORIES) {
    assert.equal(
      DEFAULT_CATEGORY_NAMES[slug], web[slug],
      `「${slug}」後端叫「${DEFAULT_CATEGORY_NAMES[slug]}」、前端叫「${web[slug]}」—— 兩邊要同時改`,
    );
  }
});

test("⭐ prompt 要明講新分類用繁體中文（否則模型照英文樣板造）", () => {
  const src = readFileSync(new URL("../src/conversation-analysis/pipeline/classify.ts", import.meta.url), "utf8");
  assert.match(src, /必須用繁體中文/, "少了這句，模型會照著英文 slug 的樣板命名");
  assert.match(src, /不可以用英文或拼音/, "要明確禁止，不能只說「建議」");
});

// ── 會議分類（2026-08-25 · 台灣福祉 ⑧）────────────────────────
// ⭐ 加分類**一定要一起給判別軸** —— schemas.ts 自己的註解就寫了：
//    「只加清單不給判別軸，模型會在邊界上亂猜」。
//    這裡守住那條軸沒有被後續改 prompt 弄丟。

test("⭐⭐ meeting 的判別軸必須是「有主題就歸主題」，不是優先分類", () => {
  const src = readFileSync(
    new URL("../src/conversation-analysis/pipeline/tenant-twh.ts", import.meta.url), "utf8");
  assert.match(src, /有主題就歸主題/,
    "少了這條軸，會議上談的維保會被歸成 meeting —— 之後要找維保就找不到它");
  assert.match(src, /不可以因為它在會議上被提到就改歸 meeting/,
    "要明確禁止，不能只說「優先」");
  assert.match(src, /談不出單一主題/, "要講清楚 meeting 的適用時機");
});

test("⭐ meeting 在內建清單裡 · 不在的話模型會再造一個英文 slug", () => {
  assert.ok(DEFAULT_CATEGORIES.includes("meeting" as never),
    "production_meeting 當初就是因為內建清單沒有會議才被造出來的");
  assert.equal(DEFAULT_CATEGORY_NAMES.meeting, "會議記錄");
});
