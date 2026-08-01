import Spinner from "../shared/Spinner";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getMapTileConfig, getSession, getTrips, relabelPunch, type PunchRow, type TripRow } from "../api";
import { useToast } from "../Toast";
import { SAME_LOCATION_LABEL, SAME_LOCATION_NEXT, SAME_LOCATION_REASON, SAME_LOCATION_WHY } from "../shared/mileageCopy";

const TripMap = lazy(() => import("./TripMap"));

// 我的行程 · 外勤逐段路線里程（員工自看）· 平台 Shell 與 LIFF(?page=trips) 共用同一元件
// 三層依據：地圖折線 + 打卡時間軸/段數自明 + 每段方法透明（見 attendance-mileage-transparency.md）
export default function MyTrips() {
  const [date, setDate] = useState<string>(getTaipeiDate());
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [punches, setPunches] = useState<PunchRow[]>([]);
  const [tile, setTile] = useState<{ tileProvider: string; tileApiKey: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openTrip, setOpenTrip] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => { getMapTileConfig().then(setTile).catch(() => setTile({ tileProvider: "osm", tileApiKey: null })); }, []);

  // quiet：補填地點後重抓，不要整頁閃「載入中」
  const load = useCallback(async (d: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await getTrips(d);
      setTrips(res.trips);
      setPunches(res.punches);
      setLoadError(null);
    } catch (err) {
      // 載入失敗不可偽裝成「這天沒有外勤行程」——使用者會以為打卡沒記錄到，
      // 實際上是讀取出錯（toast 會消失，空狀態卻會一直留在那誤導人）。
      const msg = err instanceof ApiError ? err.message : "載入失敗";
      toast.show(msg, "danger");
      if (!quiet) { setTrips([]); setPunches([]); setLoadError(msg); }
    } finally {
      if (!quiet) setLoading(false);
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
        <Spinner block />
      ) : loadError ? (
        <div className="dm-empty">
          讀取失敗
          <div className="dm-empty-hint">{loadError}</div>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => void load(date)}>重新載入</button>
        </div>
      ) : trips.length === 0 && punches.length === 0 ? (
        <div className="dm-empty">
          這天沒有外勤行程
          <div className="dm-empty-hint">當天按過「開始外勤」與「記錄這一站」才會出現各段路程</div>
          {/* 打卡走 LINE 綁定的員工身分，平台登入可能是另一組帳號——
              同一個人有兩個帳號時，這裡會「明明打了卡卻查無資料」，把身分印出來一眼就看得出來 */}
          <div className="dm-empty-hint" style={{ marginTop: 8 }}>
            目前查詢身分：{whoami() ?? "（未知）"}
            <br />打卡是記在 LINE 綁定的那個員工帳號上；若你用另一組帳號登入平台，這裡會看不到。
          </div>
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
              <PunchRowItem key={p.punchId} punch={p} onSaved={() => void load(date, true)} />
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
                          {SAME_LOCATION_LABEL}
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
                          ? <><b>為什麼距離是 0？</b><br />{SAME_LOCATION_WHY}<br />{SAME_LOCATION_REASON}<br /><b>{SAME_LOCATION_NEXT}</b></>
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

// 打卡一列 · 地點名稱可事後補填/修正。
// 為什麼可以改：地點名稱是「給人看的標籤」，座標/時間/里程才是證據（那些一律不可改）。
// 起因：客戶回報「有填地點卻沒出現」——打卡當下沒填成功時，事後補得回來就不會變成爭議。
function PunchRowItem({ punch, onSaved }: { punch: PunchRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const filled = punch.customerName?.trim() ?? "";

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const next = value.trim();
      await relabelPunch(punch.punchId, next || null);
      toast.show(next ? "地點已更新" : "已清除地點", "ok");
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "更新失敗", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="trip-tl-row">
      <span className="trip-tl-time">{formatTimeHM(punch.punchedAt)}</span>
      <span className={`trip-tl-badge ${punch.punchType === "clock_in" ? "start" : "arrive"}`}>
        {punch.punchType === "clock_in" ? "開始外勤" : "抵達"}
      </span>
      {editing ? (
        <span className="trip-tl-edit">
          <input
            className="tf" autoFocus placeholder="例：光華商場" value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
          />
          <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "儲存中…" : "儲存"}
          </button>
          <button className="btn btn-sm" onClick={() => setEditing(false)} disabled={saving}>取消</button>
        </span>
      ) : (
        <button
          className={`trip-tl-place editable${filled ? "" : " empty"}`}
          onClick={() => { setValue(filled); setEditing(true); }}
        >
          {filled || punch.address || "＋ 補填地點"}
        </button>
      )}
    </div>
  );
}

// 目前這個 JWT 是誰（LIFF 綁定身分 vs 平台登入帳號可能不同）
function whoami(): string | null {
  return getSession()?.email ?? null;
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
