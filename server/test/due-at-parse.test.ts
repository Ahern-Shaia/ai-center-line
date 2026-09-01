/**
 * `due_at` 解析 —— 這一層擋的是「模型亂寫會不會弄垮整批材料化」。
 *
 * ⚠️ 這支不用打 API、不用 DB —— 純函式。
 *    但它守的是兩個 P0：整批交易掛掉、以及時區差 8 小時。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDueAt } from "../src/warroom-task-board/due-at.js";

test("⭐⭐ 時區：沒帶時區的字串一律當台北時間，不可以被當成 UTC", () => {
  // FMEA F-7。模型回的是 "2026-09-08T10:00"，沒有時區。
  // 交給 new Date() 猜會被當 UTC → 早 8 小時 → 使用者在錯的時間出現在錯的地方。
  const got = parseDueAt("2026-09-08T10:00");
  assert.equal(got, "2026-09-08T10:00:00+08:00");
  // 換算成絕對時間再確認一次（光比字串可能被格式騙過）
  assert.equal(Date.parse(got!), Date.parse("2026-09-08T02:00:00Z"),
    "台北 10:00 應該等於 UTC 02:00 —— 差 8 小時就是時區搞錯了");
});

test("⭐ 只有日期 → 當天 00:00（台北）· 整天事件", () => {
  // OQ-CAL-4：只有日期沒時間就當整天事件，不假裝知道幾點。
  assert.equal(parseDueAt("2026-09-03"), "2026-09-03T00:00:00+08:00");
});

test("⭐⭐ 看不懂的一律回 null —— 寧可這筆沒日期，也不能讓整批材料化掛掉", () => {
  // due_at 是**模型產生的字串**。直接丟進 timestamptz 欄位，
  // 一個爛值就會讓整批交易失敗 —— 那一批連一張卡都進不去。
  for (const bad of [
    "", "   ", "下週三", "月底前", "8/24", "2026/09/08", "next Wednesday",
    "2026-13-01",        // 月份 13
    "2026-09-32",        // 日 32
    "2026-09-08T25:00",  // 時 25
    "2026-09-08T10:70",  // 分 70
    "2026-02-30",        // 2 月 30 日 —— Date.parse 會「好心」正規化成 3/2，必須擋掉
    null, undefined, 12345, {}, [],
  ]) {
    assert.equal(parseDueAt(bad as unknown), null, `這個值應該被擋掉：${JSON.stringify(bad)}`);
  }
});

test("⭐ 2 月 30 日不可以被正規化成 3 月 2 日", () => {
  // 這是最陰的一個：Date.parse("2026-02-30T00:00:00+08:00") **不會** NaN，
  // 它會回 3/2。只驗 NaN 的話會放它過去，然後使用者在錯的日子赴約。
  assert.equal(parseDueAt("2026-02-30"), null);
  assert.equal(parseDueAt("2026-02-28"), "2026-02-28T00:00:00+08:00", "正常的 2 月日期要過");
});

test("秒數可有可無 · 空白分隔也接受", () => {
  assert.equal(parseDueAt("2026-09-08T10:00:00"), "2026-09-08T10:00:00+08:00");
  assert.equal(parseDueAt("2026-09-08 10:00"), "2026-09-08T10:00:00+08:00");
  assert.equal(parseDueAt("  2026-09-08T10:00  "), "2026-09-08T10:00:00+08:00");
});
