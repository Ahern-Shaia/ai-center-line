import { useCallback, useEffect, useRef, useState } from "react";
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
  const custRef = useRef<HTMLInputElement>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [punchCount, setPunchCount] = useState<number | null>(null);   // null = 尚未載入

  const refresh = useCallback(async () => {
    try {
      const res = await getTrips();
      setTrips(res.trips);
      setPunchCount(res.punches.length);
    } catch { /* 靜默 · 非核心 */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function punch(type: "clock_in" | "arrive_site") {
    if (busy) return;
    setBusy(type);
    // 以 input 的 DOM 實際值為準，不只信 React state：
    // iOS 中文輸入法「組字中」直接點按鈕時，onChange 可能還沒送出最後一段文字 → state 是空的、地點就漏了。
    const typed = (custRef.current?.value ?? customer).trim();
    try {
      const pos = await getPosition();
      const { latitude, longitude, accuracy } = pos.coords;
      const res = await attendancePunch({
        punchType: type,
        lat: latitude,
        lng: longitude,
        accuracyM: accuracy,
        customerName: type === "arrive_site" && typed ? typed : undefined,
      });
      // 樂觀更新：打完立刻切成「記錄這一站」，不必等 refresh 回來（避免按鈕短暫停在舊狀態）
      setPunchCount((n) => (n ?? 0) + 1);
      if (type === "clock_in") {
        toast.show("已開始外勤", "ok");
      } else {
        // 原地打卡若照報「本段 0.0 km」，使用者會讀成「沒記錄到」→ 直接說明是沒移動
        const km = res.trip?.distanceM != null ? (res.trip.distanceM / 1000).toFixed(1) : null;
        const base = res.trip?.routeProvider === "same_location"
          ? "已記錄這一站 · 與上一站同位置（未移動）"
          : km ? `已記錄這一站 · 本段 ${km} km` : "已記錄這一站";
        // 沒填地點不擋打卡（打卡有時效、地點沒有），但要讓他知道還補得回來
        toast.show(typed ? base : `${base} · 未填地點，可到「我的行程」補填`, "ok");
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

  const totalKm = trips.reduce((s, t) => s + (t.distanceM ?? t.straightDistanceM ?? 0), 0) / 1000;
  const allSameLocation = trips.length > 0 && trips.every((t) => t.routeProvider === "same_location");
  const loadingState = punchCount === null;          // 尚未知道今天狀態 → 先不給按鈕，避免閃動誤按
  const notStarted = punchCount === 0;               // 今天還沒任何打卡 → 只給「開始外勤」

  return (
    <div className="liff-wrap">
      <h2 className="liff-h">外勤打卡</h2>
      {/* 防呆：一次只給一顆按鈕。今天還沒打卡 → 只能「開始外勤」；已開始 → 只出現「記錄這一站」。
          兩顆並列時小白容易按錯（原本「出發／到點」也是資料模型用語，非員工視角）。 */}
      <p className="liff-sub">
        {notStarted
          ? "出門時按一下「開始外勤」，之後每到一個地方再記錄一次，系統會自動算出各段路程。"
          : "每到一個地方就按一下，系統會自動算出從上一站到這裡的路程。"}
      </p>

      {/* 地點欄只在「記錄這一站」階段才有意義（開始外勤不需填地點）*/}
      {!notStarted && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="punch-cust">這一站是哪裡？（選填）</label>
          <input id="punch-cust" ref={custRef} className="tf" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="例：福特斗六廠" />
          <div className="dm-empty-hint" style={{ marginTop: 4 }}>沒填也沒關係 · 之後可到「我的行程」補填</div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        {loadingState ? (
          <button className="btn" style={{ width: "100%", padding: 16, fontSize: 16 }} disabled>載入中…</button>
        ) : notStarted ? (
          <button className="btn btn-primary" style={{ width: "100%", padding: 16, fontSize: 16 }}
            onClick={() => void punch("clock_in")} disabled={busy !== null}>
            {busy === "clock_in" ? "定位中…" : "開始外勤"}
          </button>
        ) : (
          <button className="btn btn-primary" style={{ width: "100%", padding: 16, fontSize: 16 }}
            onClick={() => void punch("arrive_site")} disabled={busy !== null}>
            {busy === "arrive_site" ? "定位中…" : "記錄這一站"}
          </button>
        )}
      </div>

      <div className="liff-groups-hd">今日移動紀錄</div>
      {trips.length === 0 ? (
        <div className="dm-empty" style={{ padding: "16px 0" }}>
          今天還沒有移動紀錄
          <div className="dm-empty-hint">
            {notStarted
              ? "按上方「開始外勤」開始今天的行程"
              : "已開始外勤 · 到下一個地方時按「記錄這一站」，就會出現路程"}
          </div>
        </div>
      ) : (
        <>
          {trips.map((t, i) => (
            <div key={t.tripId} className="liff-group">
              <span>
                第 {i + 1} 段
                {/* 沒標「原地打卡」的話，站在同一個地方測試會看到一排 0.0，看起來像壞掉 */}
                {t.routeProvider === "same_location" && <span className="liff-note"> · 原地打卡</span>}
              </span>
              <span className="liff-pct">{t.distanceM != null ? `${(t.distanceM / 1000).toFixed(1)} km` : "里程計算中"}</span>
            </div>
          ))}
          <div className="liff-group primary" style={{ marginTop: 2 }}>
            <span>今日合計</span>
            <span className="liff-pct">{totalKm.toFixed(1)} km</span>
          </div>
          {allSameLocation && (
            <div className="dm-empty-hint" style={{ marginTop: 8 }}>
              目前每一段都是在同一個位置打的（未移動），所以距離是 0。
              走到別的地點再按一次「記錄這一站」，就會算出實際路程。
            </div>
          )}
        </>
      )}
    </div>
  );
}
