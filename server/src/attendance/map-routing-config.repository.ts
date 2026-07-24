import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

// 地圖 provider 平台設定 repository · api_key 用 pgcrypto 加密（key = LINE_CONFIG_ENC_KEY · 沿用既有）
@Injectable()
export class MapRoutingConfigRepository {
  private encKey(): string {
    const k = process.env.LINE_CONFIG_ENC_KEY;
    if (!k) throw new Error("LINE_CONFIG_ENC_KEY env 未設（地圖 key 加密需要）");
    return k;
  }

  // backend 內部用 · 回明碼 key（走 withSystemTx / aiproot 上下文）
  async get(tx: Db): Promise<{ provider: string; apiKey: string | null }> {
    const key = this.encKey();
    const res = await tx.execute<{ provider: string; api_key: string | null }>(sql`
      SELECT provider,
             CASE WHEN api_key_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(api_key_enc, ${key})::text END AS api_key
      FROM map_routing_config WHERE singleton = true LIMIT 1
    `);
    const r = res.rows[0];
    return r ? { provider: r.provider, apiKey: r.api_key } : { provider: "openrouteservice", apiKey: null };
  }

  // 前端顯示用 · 不回 key 明碼 · 只回是否已設
  async getStatus(tx: Db): Promise<{ provider: string; hasKey: boolean }> {
    const res = await tx.execute<{ provider: string; has_key: boolean }>(sql`
      SELECT provider, (api_key_enc IS NOT NULL) AS has_key
      FROM map_routing_config WHERE singleton = true LIMIT 1
    `);
    const r = res.rows[0];
    return r ? { provider: r.provider, hasKey: r.has_key } : { provider: "openrouteservice", hasKey: false };
  }

  async upsertWithKey(tx: Db, provider: string, apiKey: string, updatedBy: string): Promise<void> {
    const key = this.encKey();
    await tx.execute(sql`
      INSERT INTO map_routing_config (singleton, provider, api_key_enc, updated_by, updated_at)
      VALUES (true, ${provider}, pgp_sym_encrypt(${apiKey}, ${key}), ${updatedBy}::uuid, now())
      ON CONFLICT (singleton) DO UPDATE SET
        provider = EXCLUDED.provider,
        api_key_enc = EXCLUDED.api_key_enc,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    `);
  }

  // 只改 provider（保留既有 key）
  async updateProviderOnly(tx: Db, provider: string, updatedBy: string): Promise<void> {
    await tx.execute(sql`
      INSERT INTO map_routing_config (singleton, provider, updated_by, updated_at)
      VALUES (true, ${provider}, ${updatedBy}::uuid, now())
      ON CONFLICT (singleton) DO UPDATE SET
        provider = EXCLUDED.provider,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    `);
  }

  // ===== 地圖圖磚（tile）設定 · 前端 Leaflet 用 · osm 免金鑰 =====

  // client 用 · 回明碼 tile key（tile key 屬 client-side · Leaflet 於瀏覽器組 URL 需用）
  async getTileConfig(tx: Db): Promise<{ tileProvider: string; tileApiKey: string | null }> {
    const key = this.encKey();
    const res = await tx.execute<{ tile_provider: string; tile_api_key: string | null }>(sql`
      SELECT tile_provider,
             CASE WHEN tile_api_key_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(tile_api_key_enc, ${key})::text END AS tile_api_key
      FROM map_routing_config WHERE singleton = true LIMIT 1
    `);
    const r = res.rows[0];
    return r ? { tileProvider: r.tile_provider, tileApiKey: r.tile_api_key } : { tileProvider: "osm", tileApiKey: null };
  }

  // aiproot 顯示用 · 不回 key 明碼
  async getTileStatus(tx: Db): Promise<{ tileProvider: string; hasTileKey: boolean }> {
    const res = await tx.execute<{ tile_provider: string; has_tile_key: boolean }>(sql`
      SELECT tile_provider, (tile_api_key_enc IS NOT NULL) AS has_tile_key
      FROM map_routing_config WHERE singleton = true LIMIT 1
    `);
    const r = res.rows[0];
    return r ? { tileProvider: r.tile_provider, hasTileKey: r.has_tile_key } : { tileProvider: "osm", hasTileKey: false };
  }

  // 設 tile provider（+ 選填 key · null = 保留既有 key · osm 不需 key）
  async upsertTile(tx: Db, tileProvider: string, tileApiKey: string | null, updatedBy: string): Promise<void> {
    const key = this.encKey();
    const encExpr = tileApiKey != null ? sql`pgp_sym_encrypt(${tileApiKey}, ${key})` : sql`NULL`;
    await tx.execute(sql`
      INSERT INTO map_routing_config (singleton, tile_provider, tile_api_key_enc, updated_by, updated_at)
      VALUES (true, ${tileProvider}, ${encExpr}, ${updatedBy}::uuid, now())
      ON CONFLICT (singleton) DO UPDATE SET
        tile_provider = EXCLUDED.tile_provider,
        tile_api_key_enc = ${tileApiKey != null ? sql`EXCLUDED.tile_api_key_enc` : sql`map_routing_config.tile_api_key_enc`},
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    `);
  }
}
