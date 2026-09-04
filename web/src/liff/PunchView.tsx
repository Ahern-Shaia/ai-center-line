import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, attendancePunch, annotatePunch, getTrips, type TripRow , getMyMonthAttendance,
  getAttendanceState, getPlaceSuggestions, type MyMonthSummary, type PlaceSuggestion,
  type PunchType } from "../api";

/** GET /attendance/state 的回傳 · 狀態的唯一來源 */
type AttendanceState = Awaited<ReturnType<typeof getAttendanceState>>;
type TripsResponse = Awaited<ReturnType<typeof getTrips>>;
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

/** 主按鈕的文案 · 帶狀態（客戶要「多一顆按鈕」，我們給的是「文案講清楚現在是什麼」）*/
const PRIMARY_LABEL: Record<string, string> = {
  not_started: "pv.startTrip",
  moving: "pv.stateMoving",
  at_site: "pv.stateAtSite",
  ended: "pv.resumeDay",
};

export default function PunchView() {
  const tr = useT();
  const toast = useToast();
  /**
   * 剛打完的那一筆 · 顯示備註框用（punch-note-to-report M3）。
   * ⚠️ 打卡**已經成功**才會有值 —— 備註是第二個獨立動作，
   *    寫不寫、寫失敗，都不影響已經成立的打卡（F-1 · P0）。
   */
  const [justPunched, setJustPunched] = useState<{ punchId: string; place: string } | null>(null);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [busy, setBusy] = useState<PunchType | null>(null);
  // ⚠️ 狀態由後端給（GET /attendance/state），**不要**再用 punches.length 推 ——
  //    加了 depart_site 之後那個推法會錯，而且錯法是安靜的：
  //    按鈕顯示成別的動作，人照按，資料就歪了（doc §7.1）。
  const [trip, setTrip] = useState<AttendanceState | null>(null);
  const [showFix, setShowFix] = useState(false);
  const [customer, setCustomer] = useState("");
  const custRef = useRef<HTMLInputElement>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);
  // 逐趟任務時間（停留）· 跟 trips（移動）是相反的區間，別混用
  const [stays, setStays] = useState<TripsResponse["stays"]>([]);
  const [staySummary, setStaySummary] = useState<TripsResponse["staySummary"] | null>(null);
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
      setStays(res.stays ?? []);
      setStaySummary(res.staySummary ?? null);
      setPunchCount(res.punches.length);
    } catch { /* 靜默 · 非核心 */ }
    // ⚠️ 這個**不可以**靜默失敗：拿不到狀態就不知道該顯示哪顆按鈕，
    //    寧可讓按鈕停在載入中，也不要顯示一顆可能是錯的動作。
    try { setTrip(await getAttendanceState()); } catch { setTrip(null); }
    try { setMonth(await getMyMonthAttendance()); } catch { /* 靜默 · 非核心 */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function punch(type: PunchType) {
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
      // 備註框：三種打卡都給（OQ-PNR-1）—— 限制型別會在 depart_site 上線那天壞掉
      setJustPunched({ punchId: res.punchId, place: typed || tr("pv.thisStop") });
      setNote("");
      if (type === "clock_in") {
        toast.show(tr("pv.started"), "ok");
      } else if (type === "depart_site") {
        toast.show(tr("pv.departed"), "ok");
      } else if (type === "clock_out") {
        toast.show(tr("pv.dayEnded"), "ok");
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
  // ⚠️ 一律從後端狀態導出，不要再看 punchCount ——
  //    兩個來源會漂移，而漂移的症狀是「畫面說 A、後端擋成 B」。
  const notStarted = trip?.state === "not_started";
  // 地點欄只有在「下一步是抵達」時才有意義（出發／離站都不需要填地點）
  const askPlace = trip?.primaryAction === "arrive_site";
  // 上一次打卡的地點與停留時間（at_site 時顯示 · §4.2）
  // ⚠️ 用 destination（那一段的目的地名稱）。
  //    TripRow.departedAt / arrivedAt 是**移動**的起訖（A→B 在路上多久），
  //    不是停留的起訖 —— 同名異義，拿錯會算出完全不同的東西（doc §5-bis.1）。
  const lastPlace = trips.length ? (trips[trips.length - 1].destination ?? null) : null;
  const stayedMin = trip?.state === "at_site" && trip.lastPunch
    ? Math.max(0, Math.round((Date.now() - Date.parse(trip.lastPunch.at)) / 60_000))
    : null;

  async function saveNote() {
    if (!justPunched || savingNote) return;
    setSavingNote(true);
    try {
      await annotatePunch(justPunched.punchId, note.trim());
      toast.show(tr("pv.noteSaved"), "ok");
      setJustPunched(null);
    } catch (e) {
      // ⚠️ 這裡失敗**不影響已經成立的打卡** —— 訊息要講清楚，
      //    否則使用者會以為打卡也失敗了而重打一次（F-1 · P0）。
      toast.show(e instanceof ApiError ? e.message : tr("pv.noteFailed"), "danger");
    } finally {
      setSavingNote(false);
    }
  }

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

      {/* 地點欄只在「下一步是抵達」時才有意義 —— 出發與離站都不需要填地點 */}
      {askPlace && (
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

      {/* 主按鈕永遠只有一顆（doc §4.2）——
          畫面依狀態決定它是什麼，使用者不必判斷「現在該按哪一個」。
          ⚠️ 這不是省事，是刻意的：多一次點擊可以，多一次選擇不行。 */}
      <div style={{ marginBottom: 20 }}>
        {!trip ? (
          <button className="btn" style={{ width: "100%", padding: 16, fontSize: 16 }} disabled>{tr("common.loading")}</button>
        ) : trip.state === "ended" ? (
          <>
            <div className="liff-card" style={{ marginBottom: 10, textAlign: "center" }}>
              <b>{tr("pv.endedHd")}</b>
              <div className="dm-empty-hint" style={{ marginTop: 4 }}>
                {tr("pv.stops", { n: String(trips.length) })} · {totalKm.toFixed(1)} km
              </div>
            </div>
            {/* 下午又被叫出去是常態 —— 沒這條路他只能等明天，或去補一筆假的 */}
            <button className="btn" style={{ width: "100%", padding: 12 }}
              onClick={() => void punch("clock_in")} disabled={busy !== null}>
              {busy ? tr("pv.locating") : tr("pv.resumeDay")}
            </button>
          </>
        ) : (
          <>
            {trip.state === "at_site" && trip.lastPunch && (
              <div className="dm-empty-hint" style={{ marginBottom: 8, textAlign: "center" }}>
                {tr("pv.atSiteNow")}{lastPlace ? `〈${lastPlace}〉` : ""}
                {stayedMin != null && ` · ${tr("pv.stayedFor", { min: String(stayedMin) })}`}
              </div>
            )}
            <button className="btn btn-primary" style={{ width: "100%", padding: 16, fontSize: 16 }}
              onClick={() => trip.primaryAction && void punch(trip.primaryAction)}
              disabled={busy !== null || !trip.primaryAction}>
              {busy ? tr("pv.locating") : tr(PRIMARY_LABEL[trip.state])}
            </button>
            {/* 「今日行程結束」永遠是次要位階 —— 逃生門不是常用鍵，
                但任何狀態都摸得到（正是業務說的「除非你按今天行程已結束」）*/}
            {trip.allowedActions.includes("clock_out") && (
              <button className="dl-card-toggle" style={{ display: "block", margin: "10px auto 0" }}
                onClick={() => void punch("clock_out")} disabled={busy !== null}>
                {tr("pv.endDay")}
              </button>
            )}
            {/* 單鍵的代價是「狀態錯了沒得救」（§5-bis.2.3）。
                ⚠️ 這裡只放**非破壞性**的那一個：補記錄離開。
                   「我根本沒到這一站，是按錯的」會刪掉打卡記錄 ——
                   出勤是計酬與稽核用的資料，沒有時限的刪除等於證據力歸零，
                   那題是 OQ-TSM-13，未裁定前不做。 */}
            {trip.state === "at_site" && (
              <div style={{ marginTop: 10, textAlign: "center" }}>
                <button className="dl-card-toggle" onClick={() => setShowFix((v) => !v)}>
                  {tr("pv.stateWrong")}
                </button>
                {showFix && (
                  <div className="liff-card" style={{ marginTop: 8, textAlign: "left" }}>
                    <div className="dm-empty-hint" style={{ marginBottom: 8 }}>{tr("pv.stateWrongBody")}</div>
                    <button className="btn" style={{ width: "100%" }}
                      onClick={() => { setShowFix(false); void punch("depart_site"); }}
                      disabled={busy !== null}>
                      {tr("pv.markDeparted")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/*
        剛打完的那一站 · 寫一句「這趟做了什麼」（punch-note-to-report M3）
        ⚠️ 自動出現但**不搶焦點**（沒有 autoFocus）—— 只想打卡的人不必多按一次關鍵盤，
           打卡是一天很多次的高頻動作（OQ-PNR-2）。
        ⚠️ 不是 modal、不擋、可以直接忽略走人。打卡已經成立了，這只是加值（F-1 · P0）。
      */}
      {justPunched && (
        // ⚠️ 容器用 .liff-card（block）不是 .liff-group ——
        //    後者是 `display:flex` 的**單行列**（label ⋯ value 那種）。
        //    2026-09-02 就是誤用它，四塊內容全變成同一列的 flex 子元素被擠扁，
        //    「記下來」在手機上排成直的。跟旁邊的地點欄用同一套（.liff-card + .field）。
        <div className="liff-card" style={{ borderColor: "var(--primary)", marginBottom: 12 }}>
          <div className="field">
            <label htmlFor="punch-note">{tr("pv.noteHd", { place: justPunched.place })}</label>
            <textarea
              id="punch-note" className="tf" rows={2} value={note}
              placeholder={tr("pv.notePh")}
              onChange={(e) => setNote(e.target.value)}
              style={{ resize: "vertical" }}
            />
          </div>
          {/* 200 字是軟限制：超過只提示不擋 —— 在客戶端當場被擋住比字太長糟（OQ-PNR-3） */}
          {note.length > 200 && (
            <div className="liff-note" style={{ marginTop: 6, color: "var(--warn)" }}>
              {tr("pv.noteTooLong", { n: String(note.length) })}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" style={{ flex: 1 }}
              disabled={savingNote || !note.trim()}
              onClick={() => void saveNote()}>
              {savingNote ? tr("common.saving") : tr("pv.noteSave")}
            </button>
            <button className="btn" onClick={() => setJustPunched(null)}>{tr("pv.noteSkip")}</button>
          </div>
          <div className="liff-note" style={{ marginTop: 8 }}>{tr("pv.noteHint")}</div>
        </div>
      )}

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

      {/* 任務時間 · 客戶要的「抵達與離開配對＝這次任務完成時間」（§5-bis）
          ⚠️ 跟下面的里程分開列：里程是**移動**、任務時間是**停留**，
             兩者是相反的區間。放在同一張表裡一定會有人讀錯。 */}
      {stays.length > 0 && (
        <>
          <div className="liff-groups-hd">{tr("pv.taskTime")}</div>
          {stays.map((st) => (
            <div key={st.arrivePunchId} className="liff-group">
              <span>
                {tr("mt.segN", { n: st.seq })}
                {st.place && <span className="liff-note"> · {st.place}</span>}
              </span>
              {/* ⚠️ minutes === null 是「未記錄離開」，**不可以顯示 0 分鐘** ——
                  0 是一個看起來很正常、沒有人會去查的數字（F-12 · P0）。*/}
              <span className={st.minutes == null ? "liff-note" : "liff-pct"}>
                {st.minutes != null
                  ? tr("pv.stayMin", { min: String(st.minutes) })
                  : st.seq === stays.length && trip?.state === "at_site"
                    ? tr("pv.stillHere")
                    : tr("pv.noDepart")}
              </span>
            </div>
          ))}
          {staySummary && staySummary.completed > 0 && (
            <div className="liff-group primary" style={{ marginTop: 2 }}>
              <span>{tr("pv.taskTotal", {
                h: String(Math.floor(staySummary.totalMinutes / 60)),
                m: String(staySummary.totalMinutes % 60),
                n: String(staySummary.completed),
              })}</span>
            </div>
          )}
          {/* 只給合計而不說有幾趟沒算到，那個數字會被當成全部 */}
          {staySummary && staySummary.incomplete > 0 && (
            <div className="liff-explain">
              {tr("pv.taskIncomplete", { n: String(staySummary.incomplete) })}
            </div>
          )}
        </>
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
