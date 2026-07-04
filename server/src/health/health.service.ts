import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

@Injectable()
export class HealthService {
  async check(): Promise<{ db: "up" | "unknown" }> {
    const r = await db.execute(sql`SELECT 1 AS ok`);
    const ok = (r.rows?.[0] as { ok?: number } | undefined)?.ok;
    return { db: Number(ok) === 1 ? "up" : "unknown" };
  }
}
