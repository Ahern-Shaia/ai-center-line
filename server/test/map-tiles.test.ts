// 地圖圖磚 provider 守門
//
// ⚠️ 2026-08-28 實機踩到：CARTO 的免費 basemap 改政策了 ——
//    現在**回 HTTP 200、圖也載得出來，但把「API KEY REQUIRED」印在圖上**。
//    不是 4xx、不是網路錯誤、Leaflet 不會 onerror ——
//    **前端完全察覺不到，只有人看螢幕才發現**。
//    這種「靜默降級」沒有測試就永遠不會被發現，所以釘住 provider。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const WEB = fileURLToPath(new URL("../../web/src/", import.meta.url));

test("⭐⭐ 不可再用 CARTO 的無金鑰 basemap（會回 200 但圖上印著 API KEY REQUIRED）", () => {
  const bad: string[] = [];
  for (const f of walk(WEB)) {
    const src = readFileSync(f, "utf8");
    // 註解裡提到它是說明歷史，不算
    for (const line of src.split("\n")) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (/cartocdn\.com/.test(line)) bad.push(`${f.split("/web/src/")[1]}  ${line.trim().slice(0, 70)}`);
    }
  }
  assert.deepEqual(bad, [], `這些地方還在用 CARTO 無金鑰圖磚：\n${bad.join("\n")}`);
});

test("⭐ 有地圖的頁面要有免金鑰的 fallback provider", () => {
  // MapTiler 那條需要租戶自己設 key（map-config）。沒設 key 的租戶必須還是看得到地圖。
  const maps = walk(WEB).filter((f) => readFileSync(f, "utf8").includes("<TileLayer"));
  assert.ok(maps.length >= 2, `只找到 ${maps.length} 個地圖元件，掃描可能失效了`);
  for (const f of maps) {
    assert.match(readFileSync(f, "utf8"), /tile\.openstreetmap\.org/,
      `${f.split("/web/src/")[1]} 沒有免金鑰的 OSM fallback —— 沒設 MapTiler key 的租戶會看到空白地圖`);
  }
});
