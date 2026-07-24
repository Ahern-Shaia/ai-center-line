import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getTrips, type TripRow } from "../api";
import { useToast } from "../Toast";

// 我的行程 · 外勤逐段路線里程（員工自看）· 平台 Shell 與 LIFF(?page=trips) 共用同一元件
export default function MyTrips() {
  const [date, setDate] = useState<string>(getTaipeiDate());
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setTrips((await getTrips(date)).trips);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, [date, toast]);
  useEffect(() => { void refresh(); }, [refresh]);

  const displayDate = useMemo(() => formatDay(date), [date]);
  const totalKm = trips.reduce((s, t) => s + (t.distanceM ?? 0), 0) / 1000;

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>我的行程 · {displayDate}</h1>
          <div className="sub">外勤逐段路線里程 · 出發＋到點各打一次卡自動記錄</div>
        </div>
        <div className="hdr-toolbar">
          <div className="hdr-group">
            <label className="hdr-label" htmlFor="trips-date">查看日期</label>
            <input
              id="trips-date"
              type="date"
              className="tf"
              value={date}
              max={getTaipeiDate()}
              onChange={(e) => setDate(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="dm-empty">載入中…</div>
      ) : trips.length === 0 ? (
        <div className="dm-empty">
          這天沒有外勤行程
          <div className="dm-empty-hint">當天有「出發」＋「到點」打卡才會出現逐段行程</div>
        </div>
      ) : (
        <div className="trip-list">
          {trips.map((t, i) => (
            <div key={t.tripId} className="trip-row">
              <div className="trip-idx">第 {i + 1} 段</div>
              <div className="trip-body">
                <div className="trip-dest">{t.destination || "未填地點"}</div>
                <div className="trip-time">{formatTimeHM(t.arrivedAt)} 到點</div>
              </div>
              <div className="trip-km">
                {t.distanceM != null ? `${(t.distanceM / 1000).toFixed(1)} km` : "里程計算中"}
              </div>
            </div>
          ))}
          <div className="trip-total">
            <span>當日合計</span>
            <span>{totalKm.toFixed(1)} km</span>
          </div>
        </div>
      )}
    </div>
  );
}

function getTaipeiDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-TW", { year: "numeric", month: "numeric", day: "numeric", weekday: "long" });
}

function formatTimeHM(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit" });
}
