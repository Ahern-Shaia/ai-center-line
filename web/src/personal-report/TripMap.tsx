import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { PunchRow, TripRow } from "../api";
import { bcp47, getLocale, t} from "../i18n";

// 外勤行程地圖 · React.lazy 載入（Leaflet 獨立 chunk）· 對齊 kb/CustomerMap 的 react-leaflet + CARTO light 慣例
// 打卡點＝CircleMarker（免圖檔資產）· 逐段道路折線＝Polyline（route_geometry 解碼；無則直線虛線）
type TileConfig = { tileProvider: string; tileApiKey: string | null };
type LatLng = [number, number];

const TEAL = "#0F766E";
const INDIGO = "#4338CA";
const ROUTE = "#2563EB";

// encoded polyline 解碼（Google/ORS 精度 5）→ [lat,lng][]
function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let b: number, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length) map.fitBounds(points, { padding: [30, 30] });
  }, [points, map]);
  return null;
}

export default function TripMap({ punches, trips, tile }: { punches: PunchRow[]; trips: TripRow[]; tile: TileConfig }) {
  const segments = useMemo(() => trips.map((t) => {
    if (t.routeGeometry) return { pts: decodePolyline(t.routeGeometry), dashed: false };
    if (t.fromLat != null && t.fromLng != null && t.toLat != null && t.toLng != null) {
      return { pts: [[t.fromLat, t.fromLng], [t.toLat, t.toLng]] as LatLng[], dashed: true };
    }
    return { pts: [] as LatLng[], dashed: false };
  }), [trips]);

  const markers = useMemo(() => punches
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({
      id: p.punchId,
      pos: [p.lat as number, p.lng as number] as LatLng,
      start: p.punchType === "clock_in",
      label: `${new Date(p.punchedAt).toLocaleTimeString(bcp47(), { hour12: false, hour: "2-digit", minute: "2-digit" })} ${t(p.punchType === "clock_in" ? "tm.depart" : "tm.arrive")}${p.customerName ? " · " + p.customerName : ""}`,
    })), [punches]);

  const allPts = useMemo(() => [...segments.flatMap((s) => s.pts), ...markers.map((m) => m.pos)], [segments, markers]);

  // ⚠️ 2026-08-28：預設圖磚由 CARTO 換成 OSM 標準圖磚。
  //    CARTO 的免費 basemap 改政策了 —— 現在**回 HTTP 200，但把
  //    「API KEY REQUIRED / carto.com/basemaps/apikey」印在圖上**。
  //    不報錯、不是 4xx、圖也載得出來 —— 前端完全察覺不到，實機截圖才看得見。
  //    OSM 標準圖磚免金鑰。租戶若設了 MapTiler key 仍走那條。
  const useMaptiler = tile.tileProvider === "maptiler" && !!tile.tileApiKey;

  return (
    <div className="trip-map">
      <MapContainer center={[23.7, 120.9]} zoom={7} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        {useMaptiler ? (
          <TileLayer
            url={`https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${tile.tileApiKey}`}
            attribution='&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
        ) : (
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
        )}
        {segments.map((s, i) => s.pts.length ? (
          <Polyline key={i} positions={s.pts} pathOptions={{ color: ROUTE, weight: 5, opacity: 0.85, ...(s.dashed ? { dashArray: "6 8" } : {}) }}>
            <Tooltip>{t("mt.segN", { n: i + 1 })}{s.dashed ? t("tm.dashed") : ""}</Tooltip>
          </Polyline>
        ) : null)}
        {markers.map((m) => (
          <CircleMarker key={m.id} center={m.pos} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: m.start ? TEAL : INDIGO, fillOpacity: 1 }}>
            <Tooltip>{m.label}</Tooltip>
          </CircleMarker>
        ))}
        <FitBounds points={allPts} />
      </MapContainer>
    </div>
  );
}
