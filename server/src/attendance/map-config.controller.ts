import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { currentTx } from "../db/client.js";
import { MapRoutingConfigRepository } from "./map-routing-config.repository.js";
import { AttendanceService } from "./attendance.service.js";

const PROVIDERS = ["openrouteservice", "google_routes"] as const;
const TILE_PROVIDERS = ["osm", "maptiler"] as const;

// aiproot 全域地圖設定（前端可設 · key 加密存 DB）
// GET 回 { provider, hasKey, tileProvider, hasTileKey }（不回 key 明碼）
// POST 設 routing provider(+選填 apiKey)；POST /tile 設 tile provider(+選填 tileApiKey)
@Controller("aiproot-console/map-config")
export class MapConfigController {
  constructor(
    private readonly repo: MapRoutingConfigRepository,
    private readonly svc: AttendanceService,
  ) {}

  @Get()
  @RequirePermission("map-config:view")
  async get() {
    const tx = currentTx();
    const [routing, tile, pendingBackfill] = await Promise.all([
      this.repo.getStatus(tx),
      this.repo.getTileStatus(tx),
      this.svc.pendingBackfillCount(),
    ]);
    return { ...routing, ...tile, pendingBackfill };
  }

  // 補算里程 · 把地圖服務中斷期間沒算出來的段落重跑（只填 null，不改原始打卡）
  @Post("backfill")
  @RequirePermission("map-config:manage")
  async backfill(@Body() body: { limit?: number }) {
    return this.svc.backfillMileage(typeof body?.limit === "number" ? body.limit : 100);
  }

  @Post()
  @RequirePermission("map-config:manage")
  async set(@CurrentUser() user: JwtUser, @Body() body: { provider?: string; apiKey?: string }) {
    if (!body?.provider || !(PROVIDERS as readonly string[]).includes(body.provider)) {
      throw new BadRequestException("provider 必要 · 需為 openrouteservice | google_routes");
    }
    const tx = currentTx();
    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      await this.repo.upsertWithKey(tx, body.provider, body.apiKey.trim(), user.user_id);
    } else {
      await this.repo.updateProviderOnly(tx, body.provider, user.user_id);
    }
    return { status: "ok", ...(await this.repo.getStatus(tx)) };
  }

  // 連線測試 · 用固定兩點實打一次 provider，把真實錯誤回給前端（診斷 Google/ORS 設定問題）
  @Post("test")
  @RequirePermission("map-config:view")
  async test() {
    return this.svc.testRouting();
  }

  @Post("tile")
  @RequirePermission("map-config:manage")
  async setTile(@CurrentUser() user: JwtUser, @Body() body: { tileProvider?: string; tileApiKey?: string }) {
    if (!body?.tileProvider || !(TILE_PROVIDERS as readonly string[]).includes(body.tileProvider)) {
      throw new BadRequestException("tileProvider 必要 · 需為 osm | maptiler");
    }
    const tx = currentTx();
    const tileKey = typeof body.tileApiKey === "string" && body.tileApiKey.trim() ? body.tileApiKey.trim() : null;
    await this.repo.upsertTile(tx, body.tileProvider, tileKey, user.user_id);
    return { status: "ok", ...(await this.repo.getTileStatus(tx)) };
  }
}
