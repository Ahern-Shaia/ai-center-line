import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export type SchedulerId = "pdr" | "group_batch";

export interface SchedulerConfigRow {
  schedulerId: SchedulerId;
  tenantId: string | null;
  enabled: boolean;
  cronExpr: string;
  timeZone: string;
  minSourceCount: number;
  lookbackDays: number;
  concurrency: number;
  lastRunAt: string | null;
  lastRunResult: Record<string, unknown> | null;
  updatedBy: string | null;
  updatedAt: string;
  [key: string]: unknown;
}

/**
 * SchedulerConfigRepository · scheduler-config M1
 * 對照 docs/modules/scheduler-config.md §4
 */
@Injectable()
export class SchedulerConfigRepository {
  async list(tx: Db, tenantId: string | null): Promise<SchedulerConfigRow[]> {
    const res = await tx.execute<SchedulerConfigRow>(sql`
      SELECT scheduler_id                  AS "schedulerId",
             tenant_id::text               AS "tenantId",
             enabled,
             cron_expr                     AS "cronExpr",
             time_zone                     AS "timeZone",
             min_source_count              AS "minSourceCount",
             lookback_days                 AS "lookbackDays",
             concurrency,
             last_run_at::text             AS "lastRunAt",
             last_run_result               AS "lastRunResult",
             updated_by::text              AS "updatedBy",
             updated_at::text              AS "updatedAt"
      FROM scheduler_config
      WHERE tenant_id = ${tenantId}::uuid OR tenant_id IS NULL
      ORDER BY scheduler_id, tenant_id NULLS LAST
    `);
    return res.rows;
  }

  /**
   * 全站所有 config (含 platform default + 每 tenant override) · SchedulerManager 啟動時全載
   */
  async listAll(tx: Db): Promise<SchedulerConfigRow[]> {
    const res = await tx.execute<SchedulerConfigRow>(sql`
      SELECT scheduler_id                  AS "schedulerId",
             tenant_id::text               AS "tenantId",
             enabled,
             cron_expr                     AS "cronExpr",
             time_zone                     AS "timeZone",
             min_source_count              AS "minSourceCount",
             lookback_days                 AS "lookbackDays",
             concurrency,
             last_run_at::text             AS "lastRunAt",
             last_run_result               AS "lastRunResult",
             updated_by::text              AS "updatedBy",
             updated_at::text              AS "updatedAt"
      FROM scheduler_config
      ORDER BY scheduler_id, tenant_id NULLS FIRST
    `);
    return res.rows;
  }

  /**
   * 撈 resolved config · 若 tenant 有 override 用 override · 否則 fallback platform default
   * SchedulerManager dispatch 時查用
   */
  async resolveForTenant(tx: Db, schedulerId: SchedulerId, tenantId: string | null): Promise<SchedulerConfigRow | null> {
    const res = await tx.execute<SchedulerConfigRow>(sql`
      SELECT scheduler_id                  AS "schedulerId",
             tenant_id::text               AS "tenantId",
             enabled,
             cron_expr                     AS "cronExpr",
             time_zone                     AS "timeZone",
             min_source_count              AS "minSourceCount",
             lookback_days                 AS "lookbackDays",
             concurrency,
             last_run_at::text             AS "lastRunAt",
             last_run_result               AS "lastRunResult",
             updated_by::text              AS "updatedBy",
             updated_at::text              AS "updatedAt"
      FROM scheduler_config
      WHERE scheduler_id = ${schedulerId}
        AND (tenant_id = ${tenantId}::uuid OR tenant_id IS NULL)
      ORDER BY tenant_id NULLS LAST
      LIMIT 1
    `);
    return res.rows[0] ?? null;
  }

  /**
   * Upsert (scheduler_id, tenant_id) · tenant_id=NULL 為 platform default
   * 欄位白名單控管由 caller（service 層）處理
   */
  async upsert(tx: Db, args: {
    schedulerId: SchedulerId;
    tenantId: string | null;
    enabled: boolean;
    cronExpr: string;
    timeZone: string;
    minSourceCount: number;
    lookbackDays: number;
    concurrency: number;
    updatedBy: string;
  }): Promise<SchedulerConfigRow> {
    const tenantIdSql = args.tenantId
      ? sql`${args.tenantId}::uuid`
      : sql`NULL::uuid`;
    const res = await tx.execute<SchedulerConfigRow>(sql`
      INSERT INTO scheduler_config
        (scheduler_id, tenant_id, enabled, cron_expr, time_zone, min_source_count, lookback_days, concurrency, updated_by, updated_at)
      VALUES
        (${args.schedulerId}, ${tenantIdSql}, ${args.enabled}, ${args.cronExpr}, ${args.timeZone},
         ${args.minSourceCount}, ${args.lookbackDays}, ${args.concurrency}, ${args.updatedBy}::uuid, now())
      ON CONFLICT (scheduler_id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))
      DO UPDATE SET
        enabled          = EXCLUDED.enabled,
        cron_expr        = EXCLUDED.cron_expr,
        time_zone        = EXCLUDED.time_zone,
        min_source_count = EXCLUDED.min_source_count,
        lookback_days    = EXCLUDED.lookback_days,
        concurrency      = EXCLUDED.concurrency,
        updated_by       = EXCLUDED.updated_by,
        updated_at       = now()
      RETURNING
        scheduler_id                  AS "schedulerId",
        tenant_id::text               AS "tenantId",
        enabled,
        cron_expr                     AS "cronExpr",
        time_zone                     AS "timeZone",
        min_source_count              AS "minSourceCount",
        lookback_days                 AS "lookbackDays",
        concurrency,
        last_run_at::text             AS "lastRunAt",
        last_run_result               AS "lastRunResult",
        updated_by::text              AS "updatedBy",
        updated_at::text              AS "updatedAt"
    `);
    return res.rows[0];
  }

  async markLastRun(tx: Db, args: {
    schedulerId: SchedulerId;
    tenantId: string | null;
    result: Record<string, unknown>;
  }): Promise<void> {
    const tenantIdCond = args.tenantId
      ? sql`tenant_id = ${args.tenantId}::uuid`
      : sql`tenant_id IS NULL`;
    await tx.execute(sql`
      UPDATE scheduler_config
      SET last_run_at = now(),
          last_run_result = ${JSON.stringify(args.result)}::jsonb
      WHERE scheduler_id = ${args.schedulerId}
        AND ${tenantIdCond}
    `);
  }
}
