import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// 部署到哪個版本了？沒有這個資訊，push 完只能靠「有沒有新路由」間接猜，
// 純內部行為的改動（parser、API 參數）根本驗不到——2026-07-27 一天撞三次。
// Render 會自動注入 RENDER_GIT_COMMIT；本機沒有就顯示 dev。
const COMMIT = (process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "dev").slice(0, 7);
// 進程啟動時間 · 用來確認「這次部署真的重啟了」而不是看到舊進程
const STARTED_AT = new Date().toISOString();

export interface HealthResult {
  db: "up" | "unknown";
  commit: string;
  startedAt: string;
}

@Injectable()
export class HealthService {
  async check(): Promise<HealthResult> {
    const r = await db.execute(sql`SELECT 1 AS ok`);
    const ok = (r.rows?.[0] as { ok?: number } | undefined)?.ok;
    return { db: Number(ok) === 1 ? "up" : "unknown", commit: COMMIT, startedAt: STARTED_AT };
  }
}
