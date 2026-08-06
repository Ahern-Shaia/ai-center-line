import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

// 方向 8 LIFF Zero-Config 綁定 repository
// 對照 docs/modules/employee-line-binding.md v1.0.1

export interface UserLineBindingRow {
  bindingId: string;
  userId: string;
  botId: string;
  lineUserId: string;
  boundAt: string;
  boundBy: string | null;
  bindingMethod: "liff_self_service" | "aiproot_manual";
  status: "active" | "revoked";
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
  metadata: Record<string, unknown> | null;
  [key: string]: unknown;    // 讓 drizzle execute<> 通過
}

@Injectable()
export class UserLineBindingRepository {
  /**
   * 依 (botId, lineUserId) 查 active binding · 個人日報 / assignee 對照用
   * webhook 高頻呼叫 · 需 index 命中 ix_user_line_binding_lookup
   */
  async getActiveByLineUserId(tx: Db, botId: string, lineUserId: string): Promise<UserLineBindingRow | null> {
    const res = await tx.execute<UserLineBindingRow>(sql`
      SELECT binding_id AS "bindingId",
             user_id::text AS "userId",
             bot_id::text AS "botId",
             line_user_id AS "lineUserId",
             bound_at::text AS "boundAt",
             bound_by::text AS "boundBy",
             binding_method AS "bindingMethod",
             status,
             revoked_at::text AS "revokedAt",
             revoked_by::text AS "revokedBy",
             revoked_reason AS "revokedReason",
             metadata
      FROM user_line_binding
      WHERE bot_id = ${botId}::uuid
        AND line_user_id = ${lineUserId}
        AND status = 'active'
      LIMIT 1
    `);
    return res.rows[0] ?? null;
  }

  /**
   * 依 userId 查 active binding
   */
  async getActiveByUserId(tx: Db, userId: string): Promise<UserLineBindingRow | null> {
    const res = await tx.execute<UserLineBindingRow>(sql`
      SELECT binding_id AS "bindingId",
             user_id::text AS "userId",
             bot_id::text AS "botId",
             line_user_id AS "lineUserId",
             bound_at::text AS "boundAt",
             bound_by::text AS "boundBy",
             binding_method AS "bindingMethod",
             status,
             revoked_at::text AS "revokedAt",
             revoked_by::text AS "revokedBy",
             revoked_reason AS "revokedReason",
             metadata
      FROM user_line_binding
      WHERE user_id = ${userId}::uuid AND status = 'active'
      LIMIT 1
    `);
    return res.rows[0] ?? null;
  }

  /**
   * 建立綁定 · 冪等（UNIQUE bot_id + line_user_id）· 若已存在 revoked · 復活為 active
   */
  async create(tx: Db, args: {
    userId: string;
    botId: string;
    lineUserId: string;
    boundBy: string | null;
    bindingMethod: "liff_self_service" | "aiproot_manual";
    metadata: Record<string, unknown> | null;
  }): Promise<{ bindingId: string; isNew: boolean }> {
    const res = await tx.execute<{ binding_id: string; inserted: boolean }>(sql`
      INSERT INTO user_line_binding
        (user_id, bot_id, line_user_id, bound_by, binding_method, metadata)
      VALUES
        (${args.userId}::uuid, ${args.botId}::uuid, ${args.lineUserId},
         ${args.boundBy ?? null}, ${args.bindingMethod},
         ${args.metadata ? JSON.stringify(args.metadata) : null}::jsonb)
      ON CONFLICT (bot_id, line_user_id) DO UPDATE SET
        status = 'active',
        revoked_at = NULL,
        revoked_by = NULL,
        revoked_reason = NULL,
        bound_at = now(),
        bound_by = EXCLUDED.bound_by,
        binding_method = EXCLUDED.binding_method,
        metadata = EXCLUDED.metadata,
        user_id = EXCLUDED.user_id
      RETURNING binding_id, (xmax = 0) AS inserted
    `);
    const row = res.rows[0];
    return { bindingId: row.binding_id, isNew: row.inserted };
  }

  /**
   * 撤銷綁定 · 標 revoked · 不刪 row（audit 保留）
   */
  async revoke(tx: Db, bindingId: string, args: {
    revokedBy: string;
    reason: "self_revoke" | "aiproot_revoke" | "tenant_admin_revoke" | "user_deleted";
  }): Promise<{ revoked: boolean }> {
    const res = await tx.execute<{ id: string }>(sql`
      UPDATE user_line_binding SET
        status = 'revoked',
        revoked_at = now(),
        revoked_by = ${args.revokedBy}::uuid,
        revoked_reason = ${args.reason}
      WHERE binding_id = ${bindingId}::uuid AND status = 'active'
      RETURNING binding_id AS id
    `);
    return { revoked: res.rows.length > 0 };
  }

  /**
   * 永久刪除一筆**已撤銷**的綁定（清掉稽核頁上的雜訊列）。
   *
   * ⚠️ `AND status = 'revoked'` 不可拿掉 —— 刪到 active 的等於把人默默解綁，
   *    而且畫面上不會有任何異狀：他只是從此收不到日報、打卡也對不到人。
   *
   * 刪掉不影響本人重新綁定：insert 走 `ON CONFLICT (bot_id, line_user_id) DO UPDATE`，
   * 有列就救活、沒列就新增，兩條路都通。
   *
   * 撤銷的歷史仍留在 `audit_log`（誰在何時呼叫 revoke 端點），不會因此消失。
   */
  async deleteRevoked(tx: Db, bindingId: string): Promise<{ deleted: boolean }> {
    const res = await tx.execute<{ id: string }>(sql`
      DELETE FROM user_line_binding
      WHERE binding_id = ${bindingId}::uuid AND status = 'revoked'
      RETURNING binding_id AS id
    `);
    return { deleted: res.rows.length > 0 };
  }

  /**
   * 列 · aiproot audit 頁 · filter by tenantId (JOIN users)
   */
  async listByTenant(tx: Db, tenantId: string, args: { status?: "active" | "revoked"; limit?: number } = {}): Promise<Array<{
    bindingId: string;
    userId: string;
    userDisplayName: string | null;
    userEmail: string | null;
    lineUserId: string;
    boundAt: string;
    bindingMethod: string;
    status: string;
  }>> {
    const res = await tx.execute<{
      binding_id: string;
      user_id: string;
      user_display_name: string | null;
      user_email: string | null;
      line_user_id: string;
      bound_at: string;
      binding_method: string;
      status: string;
    }>(sql`
      SELECT b.binding_id, b.user_id::text, u.display_name AS user_display_name,
             u.email AS user_email, b.line_user_id, b.bound_at::text,
             b.binding_method, b.status
      FROM user_line_binding b
      JOIN users u ON u.user_id = b.user_id
      WHERE u.tenant_id = ${tenantId}::uuid
        AND (${args.status ?? null}::text IS NULL OR b.status = ${args.status ?? null})
      ORDER BY b.bound_at DESC
      LIMIT ${args.limit ?? 200}
    `);
    return res.rows.map((r) => ({
      bindingId: r.binding_id,
      userId: r.user_id,
      userDisplayName: r.user_display_name,
      userEmail: r.user_email,
      lineUserId: r.line_user_id,
      boundAt: r.bound_at,
      bindingMethod: r.binding_method,
      status: r.status,
    }));
  }
}
