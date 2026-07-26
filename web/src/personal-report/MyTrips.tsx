import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getMapTileConfig, getTrips, type PunchRow, type TripRow } from "../api";
import { useToast } from "../Toast";

const TripMap = lazy(() => import("./TripMap"));

// 我的行程 · 外勤逐段路線里程（員工自看）· 平台 Shell 與 LIFF(?page=trips) 共用同一元件
// 三層依據：地圖折線 + 打卡時間軸/段數自明 + 每段方法透明（見 attendance-mileage-transparency.md）
export default function MyTrips() {
  const [date, setDate] = useState<string>(getTaipeiDate());
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [punches, setPunches] = useState<PunchRow[]>([]);
  const [tile, setTile] = useState<{ tileProvider: string; tileApiKey: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [openTrip, setOpenTrip] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => { getMapTileConfig().then(setTile).catch(() => setTile({ tileProvider: "osm", tileApiKey: null })); }, []);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await getTrips(d);
      setTrips(res.trips);
      setPunches(res.punches);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : "載入失敗", "danger");
      setTrips([]); setPunches([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { void load(date); }, [date, load]);

  const displayDate = useMemo(() => formatDay(date), [date]);
  // 合計：道路里程優先，取不到時用直線距離頂替（並標示），避免顯示成 0 km 誤導
  const totalKm = trips.reduce((s, t) => s + (t.distanceM ?? t.straightDistanceM ?? 0), 0) / 1000;
  const hasEstimated = trips.some((t) => t.routeProvider === "straight_fallback" || (t.distanceM == null && t.straightDistanceM != null));
  const hasGeo = punches.some((p) => p.lat != null && p.lng != null);

  return (
    <div className="pane">
      <div className="pane-hdr">
        <div>
          <h1>我的行程 · {displayDate}</h1>
          <div className="sub">外勤各段路程 · 依打卡自動記錄 · 數字皆可對照下方地圖與打卡紀錄</div>
        </div>
        <div className="hdr-toolbar">
          <div className="hdr-group">
            <label className="hdr-label" htmlFor="trips-date">查看日期</label>
            <input id="trips-date" type="date" className="tf" value={date} max={getTaipeiDate()}
              onChange={(e) => setDate(e.target.value)} disabled={loading} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="dm-empty">載入中…</div>
      ) : trips.length === 0 && punches.length === 0 ? (
        <div className="dm-empty">
          這天沒有外勤行程
          <div className="dm-empty-hint">當天按過「開始外勤」與「記錄這一站」才會出現各段路程</div>
        </div>
      ) : (
        <>
          {hasGeo && (
            <Suspense fallback={<div className="trip-map trip-map-loading">地圖載入中…</div>}>
              <TripMap punches={punches} trips={trips} tile={tile ?? { tileProvider: "osm", tileApiKey: null }} />
            </Suspense>
          )}

          {/* 打卡時間軸 + 段數自明 */}
          <div className="trip-tl-hd">打卡時間軸</div>
          <div className="trip-tl">
            {punches.map((p) => (
              <div key={p.punchId} className="trip-tl-row">
                <span className="trip-tl-time">{formatTimeHM(p.punchedAt)}</span>
                <span className={`trip-tl-badge ${p.punchType === "clock_in" ? "start" : "arrive"}`}>
                  {p.punchType === "clock_in" ? "開始外勤" : "抵達"}
                </span>
                <span className="trip-tl-place">{p.customerName || p.address || "（未填地點）"}</span>
              </div>
            ))}
          </div>
          <div className="trip-tl-foot">共 {punches.length} 個打卡點 · {trips.length} 段里程（少一段通常是漏打了一次卡）</div>

          {/* 逐段里程 · 點開看依據 */}
          <div className="trip-seg-hd">逐段里程</div>
          <div className="trip-list">
            {trips.map((t, i) => {
              const open = openTrip === t.tripId;
              const roadKm = t.distanceM != null ? (t.distanceM / 1000).toFixed(1) : null;
              const straightKm = t.straightDistanceM != null ? (t.straightDistanceM / 1000).toFixed(1) : null;
              return (
                <div key={t.tripId}>
                  <button className="trip-row clickable" onClick={() => setOpenTrip(open ? null : t.tripId)}>
                    <span className="trip-idx">第 {i + 1} 段</span>
                    <span className="trip-body">
                      <span className="trip-dest">{t.destination || "未填地點"}</span>
                      <span className="trip-time">{formatTimeHM(t.arrivedAt)} 抵達 · 點開看依據</span>
                    </span>
                    {t.routeProvider === "same_location" ? (
                      <span className="trip-km" style={{ textAlign: "right" }}>
                        0.0 km
                        <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-3)", fontFamily: "var(--sans)" }}>
                          原地打卡
                        </span>
                      </span>
                    ) : t.routeProvider === "straight_fallback" ? (
                      // 防中斷：道路路線取不到時退直線 · 明確標示來源，不假裝是行駛距離
                      <span className="trip-km" style={{ textAlign: "right" }}>
                        {roadKm ?? straightKm ?? "—"} km
                        <span style={{ display: "block", fontSize: 10.5, color: "var(--warn)", fontFamily: "var(--sans)" }}>
                          直線估算
                        </span>
                      </span>
                    ) : roadKm != null ? (
                      <span className="trip-km">{roadKm} km</span>
                    ) : (
                      <span className="trip-km" style={{ textAlign: "right" }}>
                        {straightKm != null ? `直線 ${straightKm} km` : "—"}
                        <span style={{ display: "block", fontSize: 10.5, color: "var(--warn)", fontFamily: "var(--sans)" }}>
                          道路里程未取得
                        </span>
                      </span>
                    )}
                  </button>
                  {open && (
                    <div className="trip-detail">
                      <div className="trip-detail-row"><span>起點時間</span><span>{formatTimeHM(t.departedAt)}{t.fromAddress ? ` · ${t.fromAddress}` : ""}</span></div>
                      <div className="trip-detail-row"><span>抵達時間</span><span>{formatTimeHM(t.arrivedAt)}{t.toAddress ? ` · ${t.toAddress}` : ""}</span></div>
                      <div className="trip-detail-row"><span>道路里程</span><span>{roadKm != null ? `${roadKm} km` : "未取得"}</span></div>
                      <div className="trip-detail-row"><span>直線距離</span><span>{straightKm != null ? `${straightKm} km` : "—"}</span></div>
                      <div className="trip-method">
                        {t.routeProvider === "same_location"
                          ? <>這兩次打卡在<b>同一位置</b>（未移動，或距離在 GPS 誤差內），因此沒有里程。</>
                          : t.routeProvider === "straight_fallback"
                          ? <>本段當時<b>取不到道路路線</b>（地圖服務未回應），先以兩點<b>直線距離</b>計算、地圖以虛線示意。待地圖服務恢復後，管理員可執行補算升級為實際道路里程。</>
                          : roadKm != null
                          ? <>依你的兩次打卡位置、走實際道路路線計算
                              {t.routeProvider?.endsWith(":walk")
                                ? "（此段距離短，採步行路線）"
                                : t.routeProvider ? `（${t.routeProvider}）` : ""}
                              。地圖上該段折線即此里程的依據。</>
                          : <>本段<b>道路路線暫時取不到</b>（地圖服務未回應），上方顯示的是兩點<b>直線距離</b>、地圖以虛線示意，非實際行駛距離。請聯繫管理員檢查地圖服務設定。</>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="trip-total">
              <span>當日合計{hasEstimated && <span style={{ fontSize: 11, fontWeight: 400, color: "var(--warn)" }}>（部分為直線估算）</span>}</span>
              <span>{totalKm.toFixed(1)} km</span>
            </div>
          </div>
        </>
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
