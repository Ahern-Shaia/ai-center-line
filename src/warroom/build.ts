import fs from "node:fs";
import path from "node:path";
import { computeAggregate, pct } from "./aggregate.js";
import { renderGroupOwner } from "./render.js";
import type { WarRoomData } from "./types.js";

// 戰情室資料綁定：讀 tickets 資料 → 計算聚合指標 → 渲染角色視圖。
// 資料層對應 pipeline 的 tickets 輸出（合夥人 spec §4.5），數字皆由此計算，不硬編。
const AS_OF = "2026-07-03T08:12:00";
const DATA_PATH = process.argv[2] ?? "data/taiwanhomecare-warroom.json";
const OUT_DIR = "output";

function main(): void {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as WarRoomData;
  const agg = computeAggregate(data, AS_OF);

  console.log(`\n=== ${data.tenant_name} 戰情室聚合（by tickets, as of ${AS_OF}）===`);
  console.log(
    `本日簽核完成率  ${pct(agg.signoff_rate)}%  （已簽核群組 ${agg.signed_groups} ÷ 6）`,
  );
  console.log(
    `六群組健康度    ${pct(agg.health_rate)}%  （綠燈群組 ${agg.green_groups} ÷ 6）`,
  );
  console.log(
    `今日 AI 高信心   ${pct(agg.high_conf_ratio)}%  （high ${agg.high_conf_num} ÷ 已標 ${agg.high_conf_den}）`,
  );
  console.log("群組健康度：");
  for (const g of agg.groups) {
    const light = g.health === "green" ? "🟢" : g.health === "yellow" ? "🟡" : "🔴";
    console.log(
      `  ${light} ${g.department.name}（${g.department.ragic_table}）` +
        ` 今日 ${g.today_total} 筆・high ${g.high_count}・${g.signed_off ? "已簽核" : "待簽核"}`,
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // group_owner 視角：預設渲染售後服務（D2，含低信心攔截示範）
  const deptId = process.argv[3] ?? "D2";
  const html = renderGroupOwner(data, agg, deptId);
  const outPath = path.join(OUT_DIR, `warroom-group_owner-${deptId}.html`);
  fs.writeFileSync(outPath, html);
  console.log(`\n→ 已渲染 group_owner 視角（${deptId}）：${outPath}`);
}

main();
