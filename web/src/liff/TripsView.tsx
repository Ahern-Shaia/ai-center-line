import { useCallback, useEffect, useState } from "react";
import { getTrips, type TripRow } from "../api";

// LIFF 我的行程（員工自看）· 選日期查當天逐段外勤行程 · JWT 已由 main.tsx 換好
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function hhmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function TripsView() {
  const [date, setDate] = useState(todayStr());
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try { setTrips((await getTrips(d)).trips); }
    catch { setTrips([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(date); }, [date, load]);

  const totalKm = trips.reduce((s, t) => s + (t.distanceM ?? 0), 0) / 1000;

  return (
    <div className="liff-wrap">
      <h2 className="liff-h">我的行程</h2>
      <p className="liff-sub">選日期查看當天外勤逐段行程與里程。</p>

      <div className="field" style={{ marginBottom: 16 }}>
        <label htmlFor="trips-date">日期</label>
        <input
          id="trips-date"
          className="tf"
          type="date"
          value={date}
          max={todayStr()}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="dm-empty" style={{ padding: "16px 0" }}>載入中…</div>
      ) : trips.length === 0 ? (
        <div className="dm-empty" style={{ padding: "16px 0" }}>
          這天沒有外勤行程
          <div className="dm-empty-hint">當天有「出發」＋「到點」打卡才會出現逐段行程</div>
        </div>
      ) : (
        <>
          {trips.map((t, i) => (
            <div
              key={t.tripId}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line, #eef0f4)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--muted, #64748b)", marginBottom: 2 }}>第 {i + 1} 段</div>
                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.destination || "未填地點"}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted, #64748b)", marginTop: 2 }}>{hhmm(t.arrivedAt)} 到點</div>
              </div>
              <span className="liff-pct" style={{ whiteSpace: "nowrap" }}>
                {t.distanceM != null ? `${(t.distanceM / 1000).toFixed(1)} km` : "里程計算中"}
              </span>
            </div>
          ))}
          <div className="liff-group primary" style={{ marginTop: 10 }}>
            <span>當日合計</span>
            <span className="liff-pct">{totalKm.toFixed(1)} km</span>
          </div>
        </>
      )}
    </div>
  );
}
