import { Logger } from "@nestjs/common";

// 路線里程 provider · 可插拔（docs §3.3）
// 兩點 GPS 座標 → 開車實際行駛距離（公尺）。TRAFFIC_UNAWARE 讓里程可重現、可稽核。
// provider 選用 + API key 走 aiproot 全域 env（前端設定頁為後續 sub-milestone）：
//   MAP_ROUTING_PROVIDER = google_routes | openrouteservice（預設 openrouteservice · 免綁卡）
//   GOOGLE_ROUTES_API_KEY / OPENROUTESERVICE_API_KEY

const logger = new Logger("RoutingProvider");
const FETCH_TIMEOUT_MS = 8000;

export interface LatLng { lat: number; lng: number; }

export interface RouteResult {
  distanceM: number;
  polyline: string | null;   // encoded polyline（道路折線）· 供地圖繪製 · 取不到為 null
}

export interface RoutingProvider {
  readonly name: string;
  computeRoute(from: LatLng, to: LatLng): Promise<RouteResult>;
  reverseGeocode(point: LatLng): Promise<string | null>;   // best-effort · 失敗回 null
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

class GoogleRoutesProvider implements RoutingProvider {
  readonly name = "google_routes";
  constructor(private readonly key: string) {}
  async computeRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
    const d = await fetchJson("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      }),
    }) as { routes?: Array<{ distanceMeters?: number; polyline?: { encodedPolyline?: string } }> };
    const m = d.routes?.[0]?.distanceMeters;
    if (typeof m !== "number") {
      // 帶上原始回應片段 · 否則「算不出來」無從診斷（常見：routes:[] ＝該兩點找不到行車路線）
      const raw = JSON.stringify(d).slice(0, 200);
      const hint = Array.isArray(d.routes) && d.routes.length === 0
        ? "Google 找不到行車路線（兩點過近／不在道路網／座標異常）"
        : "回應缺 distanceMeters";
      throw new Error(`${hint} · from=${from.lat},${from.lng} to=${to.lat},${to.lng} · raw=${raw}`);
    }
    return { distanceM: Math.round(m), polyline: d.routes?.[0]?.polyline?.encodedPolyline ?? null };
  }
  async reverseGeocode(point: LatLng): Promise<string | null> {
    try {
      const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      u.searchParams.set("latlng", `${point.lat},${point.lng}`);
      u.searchParams.set("language", "zh-TW");
      u.searchParams.set("key", this.key);
      const d = await fetchJson(u.toString(), { method: "GET" }) as { results?: Array<{ formatted_address?: string }> };
      return d.results?.[0]?.formatted_address ?? null;
    } catch (e) {
      logger.warn(`Google 反查地址失敗 · ${(e as Error).message}`);
      return null;
    }
  }
}

class OpenRouteServiceProvider implements RoutingProvider {
  readonly name = "openrouteservice";
  constructor(private readonly key: string) {}
  async computeRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
    // ORS 座標順序為 [lng, lat] · 預設回 encoded polyline geometry + summary.distance
    const d = await fetchJson("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: this.key },
      body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
    }) as { routes?: Array<{ summary?: { distance?: number }; geometry?: string }> };
    const m = d.routes?.[0]?.summary?.distance;
    if (typeof m !== "number") throw new Error("ORS 回應無 summary.distance");
    return { distanceM: Math.round(m), polyline: d.routes?.[0]?.geometry ?? null };
  }
  async reverseGeocode(point: LatLng): Promise<string | null> {
    try {
      const u = new URL("https://api.openrouteservice.org/geocode/reverse");
      u.searchParams.set("api_key", this.key);
      u.searchParams.set("point.lon", String(point.lng));
      u.searchParams.set("point.lat", String(point.lat));
      u.searchParams.set("size", "1");
      const d = await fetchJson(u.toString(), { method: "GET" }) as {
        features?: Array<{ properties?: { label?: string; name?: string } }>;
      };
      const p = d.features?.[0]?.properties;
      return p?.label ?? p?.name ?? null;
    } catch (e) {
      logger.warn(`ORS 反查地址失敗 · ${(e as Error).message}`);
      return null;
    }
  }
}

// 依 provider 名 + key 建 provider（給 DB 設定用）· 無 key 回 null
export function buildRoutingProvider(name: string, key: string | null): RoutingProvider | null {
  if (!key) return null;
  if (name === "google_routes" || name === "google") return new GoogleRoutesProvider(key);
  return new OpenRouteServiceProvider(key);
}

// env fallback（DB 未設 provider/key 時）· 無 key 回 null（呼叫端把 distance 存 null，不阻擋打卡）
export function getRoutingProvider(): RoutingProvider | null {
  const which = (process.env.MAP_ROUTING_PROVIDER ?? "openrouteservice").trim();
  const key = which === "google_routes" || which === "google"
    ? process.env.GOOGLE_ROUTES_API_KEY
    : process.env.OPENROUTESERVICE_API_KEY;
  if (!key) { logger.warn(`地圖 provider(${which}) 未設 key（DB 設定或 env）· 里程暫不計算`); return null; }
  return buildRoutingProvider(which, key);
}

// 直線距離（Haversine）· provider 失敗時的 fallback / 反作弊速度粗算用
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
