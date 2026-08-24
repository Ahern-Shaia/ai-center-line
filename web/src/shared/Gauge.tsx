import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer } from "recharts";

// 全圓 donut gauge（Shop-floor Monitor 風）— 對應合夥人原型的環形視覺。
// 起點正上方（-90°）順時針到 270°；track = --well、fill = 傳入色。
interface Props {
  value: number;         // 0..1
  label: string;
  frac: string;
  color: string;         // 狀態靠 donut 環顏色本身承載
}

/**
 * ⚠️ track 用**該環自己的語意色**淡化，不用中性灰。
 *
 * 0% 時 RadialBar 什麼都不畫，整圈只剩 track ——
 * 中性灰會讓人以為元件沒載入或壞了（prod 截圖實際發生：
 * 「本日核對率 0%」整圈死灰，看起來像還在轉圈）。
 * 染色之後，0 讀起來是「這個環是活的，值就是 0」。
 */
function trackFill(color: string): string {
  return `color-mix(in srgb, ${color} 14%, var(--well))`;
}

export default function Gauge({ value, label, frac, color }: Props) {
  const pct = Math.round(value * 100);
  const data = [{ name: label, value: pct, fill: color }];

  return (
    <div className="gauge-tile">
      <div className="gauge-donut">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={data}
            startAngle={90}
            endAngle={-270}
            innerRadius="78%"
            outerRadius="100%"
            cx="50%"
            cy="50%"
            barSize={10}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar
              dataKey="value"
              cornerRadius={0}
              background={{ fill: trackFill(color) }}
              isAnimationActive
              animationDuration={800}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="gauge-center">
          <div className="gauge-num tnum">{pct}<i>%</i></div>
          <div className="gauge-frac mono">{frac}</div>
        </div>
      </div>
      <div className="gauge-label">{label}</div>
    </div>
  );
}
