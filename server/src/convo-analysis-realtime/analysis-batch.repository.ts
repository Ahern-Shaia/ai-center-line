import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export interface AnalysisBatchRow {
  batchId: string;
  tenantId: string;
  groupId: string;
  batchDate: string;
  uploadId: number | null;
  status: "pending" | "running" | "completed" | "failed" | "empty";
  messageCount: number;
  triggeredBy: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

@Injectable()
export class AnalysisBatchRepository {
  /**
   * 開始 batch · 冪等 UNIQUE (tenant_id, group_id, batch_date)
   * 若已存在 (手動重跑) · 覆蓋 upload_id 前值 · 狀態改回 running
   * 回 batchId + 是否 first (供 log)
   */
  async startBatch(tx: Db, args: {
    tenantId: string;
    groupId: string;
    batchDate: string;
    triggeredBy: string;
  }): Promise<{ batchId: string; isFirst: boolean }> {
    const res = await tx.execute<{ batch_id: string; first: boolean }>(sql`
      INSERT INTO analysis_batch (tenant_id, group_id, batch_date, status, triggered_by, started_at)
      VALUES (${args.tenantId}::uuid, ${args.groupId}, ${args.batchDate}::date,
              'running', ${args.triggeredBy}, now())
      ON CONFLICT (tenant_id, group_id, batch_date) DO UPDATE SET
        status = 'running',
        triggered_by = EXCLUDED.triggered_by,
        started_at = now(),
        error_message = NULL,
        updated_at = now()
      RETURNING batch_id, (xmax = 0) AS first
    `);
    const row = res.rows[0];
    if (!row) throw new Error("analysis_batch startBatch 未回 batch_id");
    return { batchId: row.batch_id, isFirst: row.first };
  }

  async markCompleted(tx: Db, batchId: string, args: {
    uploadId: number;
    messageCount: number;
  }): Promise<void> {
    await tx.execute(sql`
      UPDATE analysis_batch SET
        status = 'completed',
        upload_id = ${args.uploadId},
        message_count = ${args.messageCount},
        completed_at = now(),
        updated_at = now()
      WHERE batch_id = ${batchId}::uuid
    `);
  }

  async markEmpty(tx: Db, batchId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE analysis_batch SET
        status = 'empty',
        message_count = 0,
        completed_at = now(),
        updated_at = now()
      WHERE batch_id = ${batchId}::uuid
    `);
  }

  async markFailed(tx: Db, batchId: string, errorMessage: string): Promise<void> {
    await tx.execute(sql`
      UPDATE analysis_batch SET
        status = 'failed',
        error_message = ${errorMessage},
        completed_at = now(),
        updated_at = now()
      WHERE batch_id = ${batchId}::uuid
    `);
  }

  async listByTenant(tx: Db, args: {
    tenantId?: string;
    limit?: number;
  }): Promise<AnalysisBatchRow[]> {
    const res = await tx.execute<{
      batch_id: string; tenant_id: string; group_id: string; batch_date: string;
      upload_id: number | null; status: AnalysisBatchRow["status"]; message_count: number;
      triggered_by: string; started_at: string | null; completed_at: string | null;
      error_message: string | null;
    }>(sql`
      SELECT batch_id, tenant_id, group_id, batch_date::text, upload_id, status,
             message_count, triggered_by,
             started_at::text, completed_at::text, error_message
      FROM analysis_batch
      WHERE (${args.tenantId ?? null}::uuid IS NULL OR tenant_id = ${args.tenantId ?? null}::uuid)
      ORDER BY batch_date DESC, tenant_id ASC
      LIMIT ${args.limit ?? 200}
    `);
    return res.rows.map((r) => ({
      batchId: r.batch_id,
      tenantId: r.tenant_id,
      groupId: r.group_id,
      batchDate: r.batch_date,
      uploadId: r.upload_id,
      status: r.status,
      messageCount: r.message_count,
      triggeredBy: r.triggered_by,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      errorMessage: r.error_message,
    }));
  }
}
