import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, attendancePunch, getTrips, type TripRow , getMyMonthAttendance, getPlaceSuggestions, type MyMonthSummary, type PlaceSuggestion } from "../api";
import { useToast } from "../Toast";
import { SAME_LOCATION_LABEL, SAME_LOCATION_NEXT, SAME_LOCATION_REASON, SAME_LOCATION_WHY } from "../shared/mileageCopy";
import { t } from "../i18n";
import { useT } from "../i18n/useT";

// LIFF 外勤打卡（M2）· JWT 已由 main.tsx applyLiffToken 換好
// LIFF 無 getLocation → navigator.geolocation（enableHighAccuracy + timeout · iOS 16.4 需 timeout+重試）
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error(t("pv.noGeo"))); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
}
function geoErrMsg(e: unknown): string {
  const err = e as GeolocationPositionError;
  if (err?.code === 1) return t("pv.geoDenied");
  if (err?.code === 2) return t("pv.geoUnavailable");
  if (err?.code === 3) return t("pv.geoTimeout");
  return e instanceof Error ? e.message : t("pv.geoFailed");
}

export default function PunchView() {
  const tr = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<"clock_in" | "arrive_site" | null>(null);
  const [customer, setCustomer] = useState("");
  const custRef = useRef<HTMLInputElement>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [punchCount, setPunchCount] = useState<number | null>(null);   // null = 尚未載入
  // 同仁自己的本月數字 · 里程本來就在算，只是從來沒給他看過（4FR §7 價值對等）
  const [month, setMonth] = useState<MyMonthSummary | null>(null);
  // 去過的地方 · 選單是加速不是限制 —— 打字照樣可以送出（FMEA F-3）
  const [places, setPlaces] = useState<PlaceSuggestion[]>([]);
  const [showPlaces, setShowPlaces] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await getTrips();
      setTrips(res.trips);
      setPunchCount(res.punches.length);
    } catch { /* 靜默 · 非核心 */ }
    try { setMonth(await getMyMonthAttendance()); } catch { /* 靜默 · 非核心 */ }
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
        toast.show(tr("pv.started"), "ok");
      } else {
        // 原地打卡若照報「本段 0.0 km」，使用者會讀成「沒記錄到」→ 直接說明是沒移動
        const km = res.trip?.distanceM != null ? (res.trip.distanceM / 1000).toFixed(1) : null;
        const base = res.trip?.routeProvider === "same_location"
          ? tr("pv.loggedSame")
          : km ? tr("pv.loggedKm", { km }) : tr("pv.logged");
        // 沒填地點不擋打卡（打卡有時效、地點沒有），但要讓他知道還補得回來
        toast.show(typed ? base : `${base} · ${tr("pv.noPlaceHint")}`, "ok");
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
  // 只要有任一段是原地就說明（不必全部都是）——使用者看到其中一段 0 就會開始懷疑
  const hasSameLocation = trips.some((t) => t.routeProvider === "same_location");
  const loadingState = punchCount === null;          // 尚未知道今天狀態 → 先不給按鈕，避免閃動誤按
  const notStarted = punchCount === 0;               // 今天還沒任何打卡 → 只給「開始外勤」

  return (
    <div className="liff-wrap">
      <h2 className="liff-h">{tr("liff.punch")}</h2>
      {/* 防呆：一次只給一顆按鈕。今天還沒打卡 → 只能「開始外勤」；已開始 → 只出現「記錄這一站」。
          兩顆並列時小白容易按錯（原本「出發／到點」也是資料模型用語，非員工視角）。 */}
      <p className="liff-sub">
        {notStarted
          ? tr("pv.introNew")
          : tr("pv.introOngoing")}
      </p>

      {/* 地點欄只在「記錄這一站」階段才有意義（開始外勤不需填地點）*/}
      {!notStarted && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="punch-cust">{tr("pv.whereLabel")}</label>
          <input
            id="punch-cust" ref={custRef} className="tf" value={customer}
            onChange={(e) => {
              setCustomer(e.target.value);
              setShowPlaces(true);
              void getPlaceSuggestions(e.target.value).then((r) => setPlaces(r.places)).catch(() => setPlaces([]));
            }}
            onFocus={() => {
              setShowPlaces(true);
              void getPlaceSuggestions(customer).then((r) => setPlaces(r.places)).catch(() => setPlaces([]));
            }}
            placeholder={tr("pv.wherePh")}
            autoComplete="off"
          />
          {showPlaces && places.length > 0 && (
            <div className="place-menu">
              {places.map((p) => (
                <button
                  key={p.name} type="button" className="place-item"
                  onClick={() => { setCustomer(p.name); setShowPlaces(false); }}
                >
                  <span className="place-name">{p.name}</span>
                  <span className="place-meta">{tr("pv.visitedN", { n: p.times })}</span>
                </button>
              ))}
              <div className="place-foot">{tr("pv.typeAnyway")}</div>
            </div>
          )}
          <div className="dm-empty-hint" style={{ marginTop: 4 }}>{tr("pv.optionalHint")}</div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        {loadingState ? (
          <button className="btn" style={{ width: "100%", padding: 16, fontSize: 16 }} disabled>{tr("common.loading")}</button>
        ) : notStarted ? (
          <button className="btn btn-primary" style={{ width: "100%", padding: 16, fontSize: 16 }}
            onClick={() => void punch("clock_in")} disabled={busy !== null}>
            {busy === "clock_in" ? tr("pv.locating") : tr("pv.startTrip")}
          </button>
        ) : (
          <button className="btn btn-primary" style={{ width: "100%", padding: 16, fontSize: 16 }}
            onClick={() => void punch("arrive_site")} disabled={busy !== null}>
            {busy === "arrive_site" ? tr("pv.locating") : tr("pv.logStop")}
          </button>
        )}
      </div>

      {/* 你自己的數字 —— 不跟別人比，也不給別人看（FMEA F-6） */}
      {month && month.trips > 0 && (
        <div className="my-month">
          <div className="my-month-hd">{tr("pv.thisMonth")}</div>
          <div className="my-month-row">
            <div className="my-month-cell"><b>{month.trips}</b><span>{tr("pv.unitTrips")}</span></div>
            <div className="my-month-cell"><b>{month.km}</b><span>{tr("pv.unitKm")}</span></div>
            <div className="my-month-cell"><b>{month.outDays}</b><span>{tr("pv.unitDays")}</span></div>
          </div>
          {month.topPlace && (
            <div className="my-month-top">{tr("pv.topPlace", { place: month.topPlace, n: month.topPlaceCount })}</div>
          )}
        </div>
      )}

      <div className="liff-groups-hd">{tr("pv.todayLog")}</div>
      {trips.length === 0 ? (
        <div className="dm-empty" style={{ padding: "16px 0" }}>
          {tr("pv.noLogYet")}
          <div className="dm-empty-hint">
            {notStarted
              ? tr("pv.noLogHintNew")
              : tr("pv.noLogHintOngoing")}
          </div>
        </div>
      ) : (
        <>
          {trips.map((t, i) => (
            <div key={t.tripId} className="liff-group">
              <span>
                {tr("mt.segN", { n: i + 1 })}
                {/* 沒標「原地打卡」的話，站在同一個地方測試會看到一排 0.0，看起來像壞掉 */}
                {t.routeProvider === "same_location" && <span className="liff-note"> · {SAME_LOCATION_LABEL()}</span>}
              </span>
              <span className="liff-pct">{t.distanceM != null ? `${(t.distanceM / 1000).toFixed(1)} km` : tr("pv.calculating")}</span>
            </div>
          ))}
          <div className="liff-group primary" style={{ marginTop: 2 }}>
            <span>{tr("pv.dayTotal")}</span>
            <span className="liff-pct">{totalKm.toFixed(1)} km</span>
          </div>
          {hasSameLocation && (
            <div className="liff-explain">
              <b>{tr("mt.whyZero")}</b>
              <div>{SAME_LOCATION_WHY()}</div>
              <div>{SAME_LOCATION_REASON()}</div>
              <div><b>{SAME_LOCATION_NEXT()}</b></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
