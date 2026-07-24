import { Logger } from "@nestjs/common";

// 路線里程 provider · 可插拔（docs §3.3）
// 兩點 GPS 座標 → 開車實際行駛距離（公尺）。TRAFFIC_UNAWARE 讓里程可重現、可稽核。
// provider 選用 + API key 走 aiproot 全域 env（前端設定頁為後續 sub-milestone）：
//   MAP_ROUTING_PROVIDER = google_routes | openrouteservice（預設 openrouteservice · 免綁卡）
//   GOOGLE_ROUTES_API_KEY / OPENROUTESERVICE_API_KEY

const logger = new Logger("RoutingProvider");
const FETCH_TIMEOUT_MS = 8000;

export interface LatLng { lat: number; lng: number; }

export interface RoutingProvider {
  readonly name: string;
  computeDistanceMeters(from: LatLng, to: LatLng): Promise<number>;
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
  async computeDistanceMeters(from: LatLng, to: LatLng): Promise<number> {
    const d = await fetchJson("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.key,
        "X-Goog-FieldMask": "routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      }),
    }) as { routes?: Array<{ distanceMeters?: number }> };
    const m = d.routes?.[0]?.distanceMeters;
    if (typeof m !== "number") throw new Error("Google Routes 回應無 distanceMeters");
    return m;
  }
}

class OpenRouteServiceProvider implements RoutingProvider {
  readonly name = "openrouteservice";
  constructor(private readonly key: string) {}
  async computeDistanceMeters(from: LatLng, to: LatLng): Promise<number> {
    // ORS 座標順序為 [lng, lat]
    const d = await fetchJson("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: this.key },
      body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
    }) as { routes?: Array<{ summary?: { distance?: number } }> };
    const m = d.routes?.[0]?.summary?.distance;
    if (typeof m !== "number") throw new Error("ORS 回應無 summary.distance");
    return m;
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
