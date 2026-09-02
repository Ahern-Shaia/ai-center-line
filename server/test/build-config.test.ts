/**
 * 建置設定的護欄。
 *
 * 起因：2026-09-02 把 test / scripts 加進 tsconfig.json 的 include 做型別檢查，
 *      而 tsconfig.build.json **繼承**了那個 include —— 正式 build 去編譯 test/，
 *      它們在 rootDir 之外，tsc 報 TS6059，**prod build 直接失敗**。
 *
 * ⚠️⚠️ 本機沒抓到的原因值得記著：我跑的是 `npx tsc --noEmit`（吃 tsconfig.json）
 *    和 `npm test`，**沒跑 `npm run build`** —— 而那才是 Render 執行的指令。
 *    「全綠」的清單裡少了真正會上線的那一步。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (f: string) => readFileSync(join(root, f), "utf8");
/** tsconfig 允許註解，JSON.parse 不吃 —— 先剝掉 */
const parse = (f: string) =>
  JSON.parse(read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")) as {
    include?: string[]; compilerOptions?: { rootDir?: string };
  };

test("⭐⭐ tsconfig.build.json 必須自己寫 include，不可以繼承", () => {
  const build = parse("tsconfig.build.json");
  assert.ok(Array.isArray(build.include),
    "build 設定沒有自己的 include —— 會繼承 tsconfig.json 的（含 test/scripts），"
    + "然後 prod build 因為 rootDir 而失敗（TS6059）");
  assert.deepEqual(build.include, ["src"],
    "build 只能編譯 src。test/scripts 進來就會踩 rootDir");
});

test("⭐ 型別檢查仍要涵蓋 test 與 scripts（那是它們被納入的目的）", () => {
  const base = parse("tsconfig.json");
  for (const dir of ["src", "scripts", "test"]) {
    assert.ok(base.include?.includes(dir),
      `tsconfig.json 的 include 少了 ${dir} —— 那裡的型別錯誤會靜默累積`);
  }
});
