import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export interface PunchLite {
  punchId: string;
  lat: number | null;
  lng: number | null;
  punchedAtMs: number;
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
  }): Promise<void> {
    await tx.execute(sql`
      INSERT INTO attendance_trip
        (tenant_id, user_id, from_punch_id, to_punch_id, distance_m, route_provider, computed_at)
      VALUES
        (${t.tenantId}::uuid, ${t.userId}::uuid, ${t.fromPunchId}::uuid, ${t.toPunchId}::uuid,
         ${t.distanceM}, ${t.routeProvider}, ${t.distanceM != null ? sql`now()` : sql`NULL`})
    `);
  }

  // 當日移動紀錄（供戰情室/日報檢視）
  async listTripsToday(tx: Db, userId: string): Promise<Array<{
    tripId: string; distanceM: number | null; routeProvider: string | null; createdAt: string;
  }>> {
    const res = await tx.execute<{ trip_id: string; distance_m: number | null; route_provider: string | null; created_at: string }>(sql`
      SELECT trip_id, distance_m, route_provider, created_at::text
      FROM attendance_trip
      WHERE user_id = ${userId}::uuid
        AND (created_at AT TIME ZONE 'Asia/Taipei')::date = (now() AT TIME ZONE 'Asia/Taipei')::date
      ORDER BY created_at ASC
    `);
    return res.rows.map((r) => ({ tripId: r.trip_id, distanceM: r.distance_m, routeProvider: r.route_provider, createdAt: r.created_at }));
  }
}
