import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { currentTx, withSystemTx } from "../db/client.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { AttendanceRepository, type PunchLite } from "./attendance.repository.js";
import { MapRoutingConfigRepository } from "./map-routing-config.repository.js";
import { NotificationBus } from "../notification-hub/notification.bus.js";
import { buildRoutingProvider, getRoutingProvider, haversineMeters, type LatLng, type RoutingProvider } from "./routing-provider.js";

export interface PunchInput {
  punchType: "clock_in" | "arrive_site" | "clock_out";
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  customerName: string | null;
  source: string;
}

const PUNCH_TYPE_LABEL: Record<string, string> = {
  clock_in: "出發打卡",
  arrive_site: "到點打卡",
  clock_out: "下班打卡",
};

// 原地打卡判定：兩點距離小於此值視為「沒有移動」（GPS 靜止誤差約 5-20m）
// 這種段落不該去問路由服務——Google/ORS 找不到「同一點到同一點」的路線，
// 會被誤判成「算不出來」而永遠留 null、卡在待補算清單。
const SAME_LOCATION_THRESHOLD_M = 20;

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
    private readonly bus: NotificationBus,
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
      let distanceM: number | null = null;
      let routeProvider: string | null = null;
      let routeGeometry: string | null = null;

      // 防中斷機制：距離一律要有值，永不留白。
      // 依可信度降級：道路路線 → 步行路線 → 直線距離（各自標記來源，可稽核）
      if (straightDistanceM < SAME_LOCATION_THRESHOLD_M) {
        // 原地打卡（同點/GPS 誤差內）· 路由服務算不出「同點到同點」· 直接記位移、省配額
        distanceM = straightDistanceM;
        routeProvider = "same_location";
      } else {
        const provider = await this.resolveProvider();
        if (provider) {
          try {
            const r = await provider.computeRoute(from, to);
            distanceM = r.distanceM;
            routeGeometry = r.polyline;
            // 記下實際模式（drive 算不出時會退步行）→ 行程明細可標示，里程來源可稽核
            routeProvider = r.mode === "walk" ? `${provider.name}:walk` : provider.name;
          } catch (e) {
            this.logger.warn(`里程計算失敗（${provider.name}）· 改記直線距離 · ${(e as Error).message}`);
          }
        }
        if (distanceM == null) {
          // 地圖服務未設定/中斷/算不出 → 退直線距離（標記來源，之後可用補算升級為道路路線）
          distanceM = straightDistanceM;
          routeProvider = "straight_fallback";
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

    // 可疑打卡 → 發領域事件（要不要通知、通知誰，由 notification_rule 決定 · 本模組不管管道）
    if (suspicious) {
      const employeeName = (await this.repo.getUserDisplayName(tx, user.user_id)) ?? "（未知員工）";
      this.bus.emit({
        eventType: "attendance.suspicious",
        tenantId: user.tenant_id,
        eventLabel: "外勤打卡異常",
        dedupKey: `attendance.suspicious:${punchId}`,
        sourceRef: "attendance.suspicious",
        payload: {
          employeeName,
          punchTypeLabel: PUNCH_TYPE_LABEL[input.punchType] ?? input.punchType,
          customerName: input.customerName ?? "",
          impossibleSpeedKmh: suspicious.impossible_speed_kmh ?? "",
          lowAccuracyM: suspicious.low_accuracy_m ?? "",
          punchedAt: new Date().toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" }),
        },
      });
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

  // 補填/修正某次打卡的地點名稱。
  // 為什麼允許事後改：地點名稱是「給人看的標籤」，不是打卡證據——證據是座標、時間、里程，那些一律不可改。
  // 因此這不是「補打卡」（design doc attendance-trip-state-machine §9 明確禁止），不構成造假空間。
  // 寫入 audit 由全域 TenantTxInterceptor 自動記錄（R5）。
  async relabelPunch(user: JwtUser, punchId: string, customerName: string | null): Promise<{ punchId: string; customerName: string | null }> {
    if (!user.tenant_id) throw new BadRequestException("此帳號無所屬租戶");
    const name = customerName?.trim() ? customerName.trim().slice(0, 200) : null;
    const ok = await this.repo.updatePunchLabel(currentTx(), punchId, user.user_id, name);
    if (!ok) throw new BadRequestException("找不到這筆打卡紀錄 · 或不屬於你");
    return { punchId, customerName: name };
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

  /** 待補算筆數（provider 當時失敗留 null 的段落）*/
  async pendingBackfillCount(): Promise<number> {
    return withSystemTx((tx) => this.repo.countTripsMissingDistance(tx));
  }

  // 補算里程：把「有座標但當初沒算出道路里程」的段落重跑一次 provider。
  // 用於地圖服務曾中斷/未啟用的情況；只填原本是 null 的欄位，不改打卡原始資料。
  // 逐筆序列處理（避免打爆 provider 配額）· 單次上限 limit。
  async backfillMileage(limit = 100): Promise<{
    pendingBefore: number; attempted: number; succeeded: number; failed: number;
    remaining: number; stoppedEarly: boolean; errors: string[];
  }> {
    const pendingBefore = await this.pendingBackfillCount();
    const provider = await this.resolveProvider();
    if (!provider) {
      return { pendingBefore, attempted: 0, succeeded: 0, failed: 0, remaining: pendingBefore, stoppedEarly: false, errors: ["尚未設定里程 provider 或 API 金鑰"] };
    }
    const targets = await withSystemTx((tx) => this.repo.listTripsMissingDistance(tx, Math.max(1, Math.min(limit, 500))));

    let attempted = 0, succeeded = 0, failed = 0, consecutiveFailures = 0, stoppedEarly = false;
    const errors: string[] = [];
    for (const t of targets) {
      attempted++;
      const from: LatLng = { lat: t.fromLat, lng: t.fromLng };
      const to: LatLng = { lat: t.toLat, lng: t.toLng };
      try {
        // 原地打卡（同點/GPS 誤差內）：路由服務永遠算不出來，直接記位移
        const straight = haversineMeters(from, to);
        if (straight < SAME_LOCATION_THRESHOLD_M) {
          await withSystemTx((tx) => this.repo.fillTripDistance(tx, t.tripId, {
            distanceM: straight, routeProvider: "same_location", routeGeometry: null,
          }));
          succeeded++;
          consecutiveFailures = 0;
          continue;
        }
        const r = await provider.computeRoute(from, to);
        await withSystemTx((tx) => this.repo.fillTripDistance(tx, t.tripId, {
          distanceM: r.distanceM,
          routeProvider: r.mode === "walk" ? `${provider.name}:walk` : provider.name,
          routeGeometry: r.polyline,
        }));
        succeeded++;
        consecutiveFailures = 0;
      } catch (e) {
        failed++;
        consecutiveFailures++;
        if (errors.length < 3) errors.push((e as Error).message.slice(0, 300));
        // 防中斷：這段道路路線算不出來 → 至少確保有直線距離（下次補算仍會嘗試升級）
        try {
          await withSystemTx((tx) => this.repo.fillTripDistance(tx, t.tripId, {
            distanceM: haversineMeters(from, to), routeProvider: "straight_fallback", routeGeometry: null,
          }));
        } catch { /* 寫入失敗就算了 · 不因補救動作再拋錯 */ }
        // 連續多筆失敗 → 視為 provider 層問題（認證/配額），停止以免空燒
        if (consecutiveFailures >= 5) { stoppedEarly = true; break; }
      }
    }
    const remaining = await this.pendingBackfillCount();
    this.logger.log(`里程補算 · 嘗試 ${attempted} · 成功 ${succeeded} · 失敗 ${failed} · 剩餘 ${remaining}${stoppedEarly ? " · 連續失敗提前中止" : ""}`);
    return { pendingBefore, attempted, succeeded, failed, remaining, stoppedEarly, errors };
  }

  // 連線測試：用固定兩點（台北車站 → 松山機場，約 7-9 km）實打一次 provider
  // 目的：把 provider 的真實錯誤（未啟用 API / 未開計費 / 金鑰限制…）回給 aiproot 前端，
  // 否則失敗只會靜默變成「沒有里程」，難以診斷。
  async testRouting(): Promise<{
    ok: boolean; provider: string | null; distanceM?: number; hasPolyline?: boolean; error?: string;
  }> {
    const provider = await this.resolveProvider();
    if (!provider) {
      return { ok: false, provider: null, error: "尚未設定里程 provider 或 API 金鑰" };
    }
    const from: LatLng = { lat: 25.0478, lng: 121.5170 };   // 台北車站
    const to: LatLng = { lat: 25.0697, lng: 121.5516 };     // 松山機場
    try {
      const r = await provider.computeRoute(from, to);
      return { ok: true, provider: provider.name, distanceM: r.distanceM, hasPolyline: !!r.polyline };
    } catch (e) {
      return { ok: false, provider: provider.name, error: (e as Error).message.slice(0, 400) };
    }
  }
}
