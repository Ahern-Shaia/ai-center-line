import { useCallback, useEffect, useState } from "react";
import { ApiError, attendancePunch, getTrips, type TripRow } from "../api";
import { useToast } from "../Toast";

// LIFF 外勤打卡（M2）· JWT 已由 main.tsx applyLiffToken 換好
// LIFF 無 getLocation → navigator.geolocation（enableHighAccuracy + timeout · iOS 16.4 需 timeout+重試）
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("此裝置不支援定位")); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
}
function geoErrMsg(e: unknown): string {
  const err = e as GeolocationPositionError;
  if (err?.code === 1) return "定位權限被拒 · 請到手機設定允許 LINE 定位後重試";
  if (err?.code === 2) return "定位取不到 · 請確認已開啟定位服務";
  if (err?.code === 3) return "定位逾時 · 請到空曠處再試一次";
  return e instanceof Error ? e.message : "定位失敗";
}

export default function PunchView() {
  const toast = useToast();
  const [busy, setBusy] = useState<"clock_in" | "arrive_site" | null>(null);
  const [customer, setCustomer] = useState("");
  const [trips, setTrips] = useState<TripRow[]>([]);

  const refresh = useCallback(async () => {
    try { setTrips((await getTrips()).trips); } catch { /* 靜默 · 非核心 */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function punch(type: "clock_in" | "arrive_site") {
    if (busy) return;
    setBusy(type);
    try {
      const pos = await getPosition();
      const { latitude, longitude, accuracy } = pos.coords;
      const res = await attendancePunch({
        punchType: type,
        lat: latitude,
        lng: longitude,
        accuracyM: accuracy,
        customerName: type === "arrive_site" && customer.trim() ? customer.trim() : undefined,
      });
      if (type === "clock_in") {
        toast.show("已開始外勤", "ok");
      } else {
        const km = res.trip?.distanceM != null ? (res.trip.distanceM / 1000).toFixed(1) : null;
        toast.show(km ? `已記錄這一站 · 本段 ${km} km` : "已記錄這一站", "ok");
        setCustomer("");
      }
      void refresh();
      // 可疑旗標由後端靜默記錄供主管複核 · 不提示員工
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : geoErrMsg(e), "danger");
    } finally {
      setBusy(null);
    }
  }

  const totalKm = trips.reduce((s, t) => s + (t.distanceM ?? 0), 0) / 1000;

  return (
    <div className="liff-wrap">
      <h2 className="liff-h">外勤打卡</h2>
      {/* 文案用員工視角：出門按一次「開始外勤」，之後每到一個地方按「記錄這一站」。
          原本「出發／到點」是資料模型用語，且暗示每段要成對，與實際操作不符。 */}
      <p className="liff-sub">出門時按一次「開始外勤」，之後每到一個地方就按「記錄這一站」，系統會自動算出各段路程。</p>

      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="punch-cust">這一站是哪裡？（選填）</label>
        <input id="punch-cust" className="tf" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="例：福特斗六廠" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        <button className="btn btn-primary" style={{ padding: 16, fontSize: 16 }} onClick={() => void punch("arrive_site")} disabled={busy !== null}>
          {busy === "arrive_site" ? "定位中…" : "記錄這一站"}
        </button>
        <button className="btn" style={{ padding: 12, fontSize: 14 }} onClick={() => void punch("clock_in")} disabled={busy !== null}>
          {busy === "clock_in" ? "定位中…" : "開始外勤（出門時按一次）"}
        </button>
      </div>

      <div className="liff-groups-hd">今日移動紀錄</div>
      {trips.length === 0 ? (
        <div className="dm-empty" style={{ padding: "16px 0" }}>
          今天還沒有移動紀錄
          <div className="dm-empty-hint">按「開始外勤」後，每到一個地方按「記錄這一站」，就會出現各段路程</div>
        </div>
      ) : (
        <>
          {trips.map((t, i) => (
            <div key={t.tripId} className="liff-group">
              <span>第 {i + 1} 段</span>
              <span className="liff-pct">{t.distanceM != null ? `${(t.distanceM / 1000).toFixed(1)} km` : "里程計算中"}</span>
            </div>
          ))}
          <div className="liff-group primary" style={{ marginTop: 2 }}>
            <span>今日合計</span>
            <span className="liff-pct">{totalKm.toFixed(1)} km</span>
          </div>
        </>
      )}
    </div>
  );
}
