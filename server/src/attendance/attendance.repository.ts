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
  routeProvider: string | null;
  destination: string | null;
  departedAt: string;
  arrivedAt: string;
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

  // 背景反查地址回填（best-effort · 不阻擋打卡）
  async updatePunchAddress(tx: Db, punchId: string, address: string): Promise<void> {
    await tx.execute(sql`
      UPDATE attendance_punch SET address = ${address}, geocoded_at = now()
      WHERE punch_id = ${punchId}::uuid
    `);
  }

  // 指定台北日期的移動紀錄（dateStr = null → 當日）· 併 from/to 打卡點取目的地與出發/到點時間
  async listTripsByDate(tx: Db, userId: string, dateStr: string | null): Promise<TripDetail[]> {
    const res = await tx.execute<{
      trip_id: string; distance_m: number | null; route_provider: string | null;
      destination: string | null; departed_at: string; arrived_at: string;
    }>(sql`
      SELECT t.trip_id, t.distance_m, t.route_provider,
             tp.customer_name AS destination,
             fp.punched_at::text AS departed_at,
             tp.punched_at::text AS arrived_at
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
      routeProvider: r.route_provider,
      destination: r.destination,
      departedAt: r.departed_at,
      arrivedAt: r.arrived_at,
    }));
  }
}
