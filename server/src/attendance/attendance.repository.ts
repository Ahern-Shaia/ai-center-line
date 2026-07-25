import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export interface PunchLite {
  punchId: string;
  lat: number | null;
  lng: number | null;
  punchedAtMs: number;
}

export interface TripDetail {
  tripId: string;
  distanceM: number | null;
  straightDistanceM: number | null;
  routeProvider: string | null;
  routeGeometry: string | null;
  destination: string | null;
  fromLat: number | null;
  fromLng: number | null;
  toLat: number | null;
  toLng: number | null;
  fromAddress: string | null;
  toAddress: string | null;
  departedAt: string;
  arrivedAt: string;
}

export interface PunchDetail {
  punchId: string;
  punchType: string;
  customerName: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  punchedAt: string;
}

@Injectable()
export class AttendanceRepository {
  // 同一員工「當日、此刻之前」最近一筆打卡（算里程與速度的前一點）
  async getLatestPunchToday(tx: Db, userId: string): Promise<PunchLite | null> {
    const res = await tx.execute<{ punch_id: string; lat: number | null; lng: number | null; punched_at: string }>(sql`
      SELECT punch_id, lat::float8 AS lat, lng::float8 AS lng, punched_at::text AS punched_at
      FROM attendance_punch
      WHERE user_id = ${userId}::uuid
        AND (punched_at AT TIME ZONE 'Asia/Taipei')::date = (now() AT TIME ZONE 'Asia/Taipei')::date
      ORDER BY punched_at DESC
      LIMIT 1
    `);
    const r = res.rows[0];
    if (!r) return null;
    return { punchId: r.punch_id, lat: r.lat, lng: r.lng, punchedAtMs: Date.parse(r.punched_at) };
  }

  async insertPunch(tx: Db, p: {
    tenantId: string;
    userId: string;
    punchType: "clock_in" | "arrive_site" | "clock_out";
    lat: number | null;
    lng: number | null;
    accuracyM: number | null;
    customerName: string | null;
    source: string;
    suspicious: Record<string, unknown> | null;
  }): Promise<{ punchId: string }> {
    const res = await tx.execute<{ punch_id: string }>(sql`
      INSERT INTO attendance_punch
        (tenant_id, user_id, punch_type, lat, lng, accuracy_m, customer_name, source, suspicious)
      VALUES
        (${p.tenantId}::uuid, ${p.userId}::uuid, ${p.punchType}, ${p.lat}, ${p.lng}, ${p.accuracyM},
         ${p.customerName}, ${p.source}, ${p.suspicious ? JSON.stringify(p.suspicious) : null}::jsonb)
      RETURNING punch_id
    `);
    return { punchId: res.rows[0].punch_id };
  }

  async insertTrip(tx: Db, t: {
    tenantId: string;
    userId: string;
    fromPunchId: string;
    toPunchId: string;
    distanceM: number | null;
    routeProvider: string | null;
    routeGeometry: string | null;
    straightDistanceM: number | null;
  }): Promise<void> {
    await tx.execute(sql`
      INSERT INTO attendance_trip
        (tenant_id, user_id, from_punch_id, to_punch_id, distance_m, route_provider, route_geometry, straight_distance_m, computed_at)
      VALUES
        (${t.tenantId}::uuid, ${t.userId}::uuid, ${t.fromPunchId}::uuid, ${t.toPunchId}::uuid,
         ${t.distanceM}, ${t.routeProvider}, ${t.routeGeometry}, ${t.straightDistanceM},
         ${t.distanceM != null ? sql`now()` : sql`NULL`})
    `);
  }

  // ===== 里程補算（provider 當時失敗 → distance_m 留 null）=====

  // 待補算＝「尚未取得真實道路路線」的段落：
  //   · distance_m IS NULL（舊資料 / 早期失敗）
  //   · 或 route_provider = 'straight_fallback'（當時服務不通、先記直線，可升級為道路路線）
  // 不含 same_location（原地打卡本來就沒有路線可算，補算也不會變）
  private readonly BACKFILL_WHERE = sql`
    (t.distance_m IS NULL OR t.route_provider = 'straight_fallback')
    AND fp.lat IS NOT NULL AND fp.lng IS NOT NULL
    AND tp.lat IS NOT NULL AND tp.lng IS NOT NULL
  `;

  /** 待補算筆數 */
  async countTripsMissingDistance(tx: Db): Promise<number> {
    const res = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM attendance_trip t
      JOIN attendance_punch fp ON fp.punch_id = t.from_punch_id
      JOIN attendance_punch tp ON tp.punch_id = t.to_punch_id
      WHERE ${this.BACKFILL_WHERE}
    `);
    return res.rows[0]?.n ?? 0;
  }

  /** 取待補算清單（新到舊 · 有上限，避免一次打爆 provider 配額）*/
  async listTripsMissingDistance(tx: Db, limit: number): Promise<Array<{
    tripId: string; fromLat: number; fromLng: number; toLat: number; toLng: number;
  }>> {
    const res = await tx.execute<{
      trip_id: string; from_lat: number; from_lng: number; to_lat: number; to_lng: number;
    }>(sql`
      SELECT t.trip_id,
             fp.lat::float8 AS from_lat, fp.lng::float8 AS from_lng,
             tp.lat::float8 AS to_lat,   tp.lng::float8 AS to_lng
      FROM attendance_trip t
      JOIN attendance_punch fp ON fp.punch_id = t.from_punch_id
      JOIN attendance_punch tp ON tp.punch_id = t.to_punch_id
      WHERE ${this.BACKFILL_WHERE}
      ORDER BY t.created_at DESC
      LIMIT ${limit}
    `);
    return res.rows.map((r) => ({
      tripId: r.trip_id, fromLat: r.from_lat, fromLng: r.from_lng, toLat: r.to_lat, toLng: r.to_lng,
    }));
  }

  // 補算結果寫回：只動「還沒有真實道路路線」的段落（null 或直線估算），
  // 已經有道路路線的不覆蓋（避免重跑改動已確定的里程）。
  async fillTripDistance(tx: Db, tripId: string, d: {
    distanceM: number; routeProvider: string; routeGeometry: string | null;
  }): Promise<void> {
    await tx.execute(sql`
      UPDATE attendance_trip
      SET distance_m = ${d.distanceM}, route_provider = ${d.routeProvider},
          route_geometry = ${d.routeGeometry}, computed_at = now()
      WHERE trip_id = ${tripId}::uuid
        AND (distance_m IS NULL OR route_provider = 'straight_fallback')
    `);
  }

  // 通知用 · 取員工顯示名（無則 email）
  async getUserDisplayName(tx: Db, userId: string): Promise<string | null> {
    const res = await tx.execute<{ name: string | null }>(sql`
      SELECT COALESCE(NULLIF(display_name, ''), email) AS name
      FROM users WHERE user_id = ${userId}::uuid LIMIT 1
    `);
    return res.rows[0]?.name ?? null;
  }

  // 背景反查地址回填（best-effort · 不阻擋打卡）
  async updatePunchAddress(tx: Db, punchId: string, address: string): Promise<void> {
    await tx.execute(sql`
      UPDATE attendance_punch SET address = ${address}, geocoded_at = now()
      WHERE punch_id = ${punchId}::uuid
    `);
  }

  // 指定台北日期的移動紀錄（dateStr = null → 當日）· 併 from/to 打卡點取目的地/座標/地址/時間/折線
  async listTripsByDate(tx: Db, userId: string, dateStr: string | null): Promise<TripDetail[]> {
    const res = await tx.execute<{
      trip_id: string; distance_m: number | null; straight_distance_m: number | null;
      route_provider: string | null; route_geometry: string | null; destination: string | null;
      from_lat: number | null; from_lng: number | null; to_lat: number | null; to_lng: number | null;
      from_address: string | null; to_address: string | null; departed_at: string; arrived_at: string;
    }>(sql`
      SELECT t.trip_id, t.distance_m, t.straight_distance_m, t.route_provider, t.route_geometry,
             tp.customer_name AS destination,
             fp.lat::float8 AS from_lat, fp.lng::float8 AS from_lng,
             tp.lat::float8 AS to_lat, tp.lng::float8 AS to_lng,
             fp.address AS from_address, tp.address AS to_address,
             fp.punched_at::text AS departed_at, tp.punched_at::text AS arrived_at
      FROM attendance_trip t
      JOIN attendance_punch fp ON fp.punch_id = t.from_punch_id
      JOIN attendance_punch tp ON tp.punch_id = t.to_punch_id
      WHERE t.user_id = ${userId}::uuid
        AND (tp.punched_at AT TIME ZONE 'Asia/Taipei')::date
            = COALESCE(${dateStr}::date, (now() AT TIME ZONE 'Asia/Taipei')::date)
      ORDER BY tp.punched_at ASC
    `);
    return res.rows.map((r) => ({
      tripId: r.trip_id,
      distanceM: r.distance_m,
      straightDistanceM: r.straight_distance_m,
      routeProvider: r.route_provider,
      routeGeometry: r.route_geometry,
      destination: r.destination,
      fromLat: r.from_lat, fromLng: r.from_lng, toLat: r.to_lat, toLng: r.to_lng,
      fromAddress: r.from_address, toAddress: r.to_address,
      departedAt: r.departed_at, arrivedAt: r.arrived_at,
    }));
  }

  // 指定台北日期的打卡序列（供時間軸 + 段數自明 + 地圖圖釘）
  async listPunchesByDate(tx: Db, userId: string, dateStr: string | null): Promise<PunchDetail[]> {
    const res = await tx.execute<{
      punch_id: string; punch_type: string; customer_name: string | null; address: string | null;
      lat: number | null; lng: number | null; punched_at: string;
    }>(sql`
      SELECT punch_id, punch_type, customer_name, address,
             lat::float8 AS lat, lng::float8 AS lng, punched_at::text AS punched_at
      FROM attendance_punch
      WHERE user_id = ${userId}::uuid
        AND (punched_at AT TIME ZONE 'Asia/Taipei')::date
            = COALESCE(${dateStr}::date, (now() AT TIME ZONE 'Asia/Taipei')::date)
      ORDER BY punched_at ASC
    `);
    return res.rows.map((r) => ({
      punchId: r.punch_id, punchType: r.punch_type, customerName: r.customer_name,
      address: r.address, lat: r.lat, lng: r.lng, punchedAt: r.punched_at,
    }));
  }
}
