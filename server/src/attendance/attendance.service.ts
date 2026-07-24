import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { currentTx, withSystemTx } from "../db/client.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { AttendanceRepository, type PunchLite } from "./attendance.repository.js";
import { MapRoutingConfigRepository } from "./map-routing-config.repository.js";
import { buildRoutingProvider, getRoutingProvider, haversineMeters, type LatLng, type RoutingProvider } from "./routing-provider.js";

export interface PunchInput {
  punchType: "clock_in" | "arrive_site" | "clock_out";
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  customerName: string | null;
  source: string;
}

const SPEED_LIMIT_KMH = 150;   // 直線速度上限（保守）· 超過視為不合理（瞬移/偽造）
const ACCURACY_LIMIT_M = 100;  // GPS 精度上限 · 超過標低信心

// 反作弊旗標（純函式 · 可測）：前一點 + 此點座標 + 時間差 → 旗標明細 | null
export function computeSuspicious(
  prev: PunchLite | null,
  curr: { lat: number | null; lng: number | null; accuracyM: number | null },
  nowMs: number,
): Record<string, number> | null {
  const flags: Record<string, number> = {};
  if (curr.accuracyM != null && curr.accuracyM > ACCURACY_LIMIT_M) {
    flags.low_accuracy_m = Math.round(curr.accuracyM);
  }
  if (prev?.lat != null && prev.lng != null && curr.lat != null && curr.lng != null) {
    const straight = haversineMeters({ lat: prev.lat, lng: prev.lng }, { lat: curr.lat, lng: curr.lng });
    const hours = (nowMs - prev.punchedAtMs) / 3_600_000;
    if (hours > 0) {
      const kmh = (straight / 1000) / hours;
      if (kmh > SPEED_LIMIT_KMH) flags.impossible_speed_kmh = Math.round(kmh);
    }
  }
  return Object.keys(flags).length ? flags : null;
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);
  constructor(
    private readonly repo: AttendanceRepository,
    private readonly mapConfig: MapRoutingConfigRepository,
  ) {}

  // 先讀 DB 平台設定（aiproot 前端設的 provider + key）· 無則 fallback env
  private async resolveProvider(): Promise<RoutingProvider | null> {
    try {
      const cfg = await withSystemTx((tx) => this.mapConfig.get(tx));
      const p = buildRoutingProvider(cfg.provider, cfg.apiKey);
      if (p) return p;
    } catch (e) {
      this.logger.warn(`讀地圖設定失敗 · fallback env · ${(e as Error).message}`);
    }
    return getRoutingProvider();
  }

  async punch(user: JwtUser, input: PunchInput): Promise<{
    punchId: string;
    suspicious: Record<string, number> | null;
    trip: { distanceM: number | null; routeProvider: string | null } | null;
  }> {
    if (!user.tenant_id) throw new BadRequestException("此帳號無所屬租戶 · 無法打卡");
    const tx = currentTx();

    const prev = await this.repo.getLatestPunchToday(tx, user.user_id);
    const suspicious = computeSuspicious(prev, input, Date.now());

    const { punchId } = await this.repo.insertPunch(tx, {
      tenantId: user.tenant_id,
      userId: user.user_id,
      punchType: input.punchType,
      lat: input.lat,
      lng: input.lng,
      accuracyM: input.accuracyM,
      customerName: input.customerName,
      source: input.source,
      suspicious,
    });

    // 到點打卡 → 從當日前一點算一趟里程（provider 失敗只記 null，不阻擋打卡）
    let trip: { distanceM: number | null; routeProvider: string | null } | null = null;
    if (input.punchType === "arrive_site" && prev?.lat != null && prev.lng != null && input.lat != null && input.lng != null) {
      const from: LatLng = { lat: prev.lat, lng: prev.lng };
      const to: LatLng = { lat: input.lat, lng: input.lng };
      const straightDistanceM = haversineMeters(from, to);
      const provider = await this.resolveProvider();
      let distanceM: number | null = null;
      let routeProvider: string | null = null;
      let routeGeometry: string | null = null;
      if (provider) {
        try {
          const r = await provider.computeRoute(from, to);
          distanceM = r.distanceM;
          routeGeometry = r.polyline;
          routeProvider = provider.name;
        } catch (e) {
          this.logger.warn(`里程計算失敗（${provider.name}）· ${(e as Error).message}`);
        }
      }
      await this.repo.insertTrip(tx, {
        tenantId: user.tenant_id,
        userId: user.user_id,
        fromPunchId: prev.punchId,
        toPunchId: punchId,
        distanceM,
        routeProvider,
        routeGeometry,
        straightDistanceM,
      });
      trip = { distanceM, routeProvider };
    }

    // 背景反查此打卡點地址（best-effort · 不阻擋打卡 · 見透明化 doc OQ-MT-3）
    if (input.lat != null && input.lng != null) {
      this.scheduleGeocode(punchId, { lat: input.lat, lng: input.lng });
    }

    return { punchId, suspicious, trip };
  }

  // 背景反查地址 · setImmediate 脫離 request tx · 用 withSystemTx 回填 · 失敗靜默（address 保持 null 可日後補）
  private scheduleGeocode(punchId: string, point: LatLng): void {
    setImmediate(() => {
      void (async () => {
        try {
          const provider = await this.resolveProvider();
          if (!provider) return;
          const address = await provider.reverseGeocode(point);
          if (!address) return;
          await withSystemTx((tx) => this.repo.updatePunchAddress(tx, punchId, address));
        } catch (e) {
          this.logger.warn(`背景反查地址失敗 · ${(e as Error).message}`);
        }
      })();
    });
  }

  // 指定台北日期的行程 + 打卡序列（dateStr = null → 當日）· 員工只看自己（以 JWT user_id 限定）
  async tripsByDate(user: JwtUser, dateStr: string | null) {
    if (dateStr !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestException("date 格式需為 YYYY-MM-DD");
    }
    const tx = currentTx();
    const [trips, punches] = await Promise.all([
      this.repo.listTripsByDate(tx, user.user_id, dateStr),
      this.repo.listPunchesByDate(tx, user.user_id, dateStr),
    ]);
    return { trips, punches };
  }

  // 地圖圖磚設定（前端 Leaflet 用 · tile key 屬 client-side）· 平台全域設定走 withSystemTx
  async tileConfig(): Promise<{ tileProvider: string; tileApiKey: string | null }> {
    return withSystemTx((tx) => this.mapConfig.getTileConfig(tx));
  }
}
