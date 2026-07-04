import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer } from "recharts";

// 全圓 donut gauge（Shop-floor Monitor 風）— 對應合夥人原型的環形視覺。
// 起點正上方（-90°）順時針到 270°；track = --well、fill = 傳入色。
interface Props {
  value: number;         // 0..1
  label: string;
  frac: string;
  color: string;         // 狀態靠 donut 環顏色本身承載
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
              background={{ fill: "var(--well)" }}
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
