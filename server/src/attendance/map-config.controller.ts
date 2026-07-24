import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { currentTx } from "../db/client.js";
import { MapRoutingConfigRepository } from "./map-routing-config.repository.js";

const PROVIDERS = ["openrouteservice", "google_routes"] as const;

// aiproot 全域地圖 provider 設定（前端可設 · key 加密存 DB）
// GET 回 { provider, hasKey }（不回 key 明碼）· POST 設 provider(+選填 apiKey)
@Controller("aiproot-console/map-config")
export class MapConfigController {
  constructor(private readonly repo: MapRoutingConfigRepository) {}

  @Get()
  @Roles("aiproot_admin", "consultant")
  async get() {
    return this.repo.getStatus(currentTx());
  }

  @Post()
  @Roles("aiproot_admin")
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
}
