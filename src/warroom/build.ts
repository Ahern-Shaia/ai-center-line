import fs from "node:fs";
import path from "node:path";
import { computeAggregate, pct } from "./aggregate.js";
import { renderAiproot, renderGroupOwner, renderTenantAdmin, renderTenantAdminV8 } from "./render.js";
import type { AiprootData, WarRoomData } from "./types.js";

// 戰情室資料綁定：讀 tickets 資料 → 計算聚合指標 → 渲染四層角色視圖。
// 三個角色視圖皆由同一份資料驅動；數字皆計算而非硬編（委員鐵律）。
const AS_OF = "2026-07-03T08:12:00";
const OUT_DIR = "output";

function main(): void {
  const data = JSON.parse(
    fs.readFileSync("data/taiwanhomecare-warroom.json", "utf8"),
  ) as WarRoomData;
  const aiproot = JSON.parse(
    fs.readFileSync("data/aiproot-overview.json", "utf8"),
  ) as AiprootData;
  const agg = computeAggregate(data, AS_OF);

  console.log(`\n=== ${data.tenant_name} 戰情室聚合（by tickets, as of ${AS_OF}）===`);
  console.log(`本日簽核完成率  ${pct(agg.signoff_rate)}%  （已簽核群組 ${agg.signed_groups} ÷ 6）`);
  console.log(`六群組健康度    ${pct(agg.health_rate)}%  （綠燈群組 ${agg.green_groups} ÷ 6）`);
  console.log(`今日 AI 高信心   ${pct(agg.high_conf_ratio)}%  （high ${agg.high_conf_num} ÷ 已標 ${agg.high_conf_den}）`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outputs: [string, string][] = [
    ["warroom-tenant_admin.html", renderTenantAdmin(data, agg)],
    ["warroom-tenant_admin-v8.html", renderTenantAdminV8(data, agg)],
    ["warroom-aiproot_admin.html", renderAiproot(aiproot, agg)],
    ["warroom-group_owner-D2.html", renderGroupOwner(data, agg, "D2")],
  ];
  for (const [name, html] of outputs) {
    const p = path.join(OUT_DIR, name);
    fs.writeFileSync(p, html);
    console.log(`→ ${p}`);
  }
}

main();
