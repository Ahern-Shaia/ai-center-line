import { Injectable, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx, withSystemTx, db as rawDb } from "../db/client.js";
import { UserLineBindingRepository } from "./user-line-binding.repository.js";
import { LiffPrefillService } from "./liff-prefill.service.js";

/**
 * Employee Binding Service · 方向 8 LIFF Zero-Config
 * 對照 employee-line-binding.md §7-quinque
 *
 * 綁定流程（Alice 全在 LINE 內 · 60 秒）：
 *   1. Alice 加 bot 好友 → webhook follow event → bot 推 LIFF link
 *   2. Alice 點 LIFF · LIFF SDK 拿到 lineUserId
 *   3. 前端 LIFF 頁 call GET /binding/liff/pretill
 *      · 系統從 line_member 撈 display_name + 常出現的群 → 部門推斷
 *      · 回傳 pre-fill 資料
 *   4. Alice 確認 or 微調 · 前端 call POST /binding/liff/complete
 *      · 系統 INSERT users + INSERT user_line_binding
 *   5. Bot 主動私訊「綁定成功」
 */
@Injectable()
export class EmployeeBindingService {
  private readonly logger = new Logger(EmployeeBindingService.name);

  constructor(
    private readonly bindingRepo: UserLineBindingRepository,
    private readonly prefillService: LiffPrefillService,
  ) {}

  /**
   * LIFF 開啟時 · 撈 pre-fill 資料
   * bot 從 URL botId 取 · Alice 的 lineUserId 從 LIFF SDK 取
   */
  async getLiffPrefill(botId: string, lineUserId: string): Promise<{
    status: "new" | "already_bound";
    existing?: { userDisplayName: string; boundAt: string };
    prefill?: {
      displayName: string | null;
      pictureUrl: string | null;
      candidateGroups: Array<{
        groupId: string;
        displayName: string | null;
        departmentId: string | null;
        departmentName: string | null;
        messageCount: number;
      }>;
    };
  }> {
    // 先檢查是否已綁定
    const existing = await withSystemTx((tx) => this.bindingRepo.getActiveByLineUserId(tx, botId, lineUserId));
    if (existing) {
      // 查 user display_name
      const userRes = await withSystemTx((tx) => tx.execute<{ display_name: string; email: string }>(sql`
        SELECT display_name, email FROM users WHERE user_id = ${existing.userId}::uuid
      `));
      const user = userRes.rows[0];
      return {
        status: "already_bound",
        existing: {
          userDisplayName: user?.display_name ?? "（未知）",
          boundAt: existing.boundAt,
        },
      };
    }

    // 撈 pre-fill 候選
    const prefill = await this.prefillService.pretillCandidates(botId, lineUserId);
    return {
      status: "new",
      prefill: {
        displayName: prefill.displayName,
        pictureUrl: prefill.pictureUrl,
        candidateGroups: prefill.candidateGroups.map((g) => ({
          groupId: g.groupId,
          displayName: g.displayName,
          departmentId: g.departmentId,
          departmentName: g.departmentName,
          messageCount: g.messageCount,
        })),
      },
    };
  }

  /**
   * Alice 確認綁定
   * Body:
   *   - botId · lineUserId (from LIFF SDK)
   *   - displayName · Alice 姓名（默認採 LINE 名 · 也可修改）
   *   - primaryGroupId · Alice 選的主要群（決定 department）
   *   - metadata: LIFF 時的 line_member snapshot
   *
   * 系統：
   *   - 查 primaryGroupId → department_id
   *   - INSERT users (tenant_id 從 bot 查 · display_name · department_id · role='group_owner')
   *   - INSERT user_line_binding · method='liff_self_service'
   */
  async completeLiffBinding(args: {
    botId: string;
    lineUserId: string;
    displayName: string;
    primaryGroupId: string | null;
    metadata: Record<string, unknown>;
  }): Promise<{
    userId: string;
    bindingId: string;
    displayName: string;
    departmentName: string | null;
  }> {
    // 檢查是否已綁定（防重）
    const existing = await withSystemTx((tx) => this.bindingRepo.getActiveByLineUserId(tx, args.botId, args.lineUserId));
    if (existing) {
      throw new BadRequestException("已綁定 · 若要更換請聯繫業助");
    }

    return withSystemTx(async (tx) => {
      // 從 bot 查 tenant_id
      const botRes = await tx.execute<{ tenant_id: string }>(sql`
        SELECT tenant_id::text FROM line_bot WHERE bot_id = ${args.botId}::uuid LIMIT 1
      `);
      const bot = botRes.rows[0];
      if (!bot) throw new NotFoundException("bot 不存在");
      const tenantId = bot.tenant_id;

      // 從 primaryGroupId 查 department_id (若有選 group)
      let departmentId: string | null = null;
      let departmentName: string | null = null;
      if (args.primaryGroupId) {
        const groupRes = await tx.execute<{ department_id: string | null; department_name: string | null }>(sql`
          SELECT lg.department_id::text, d.department_name
          FROM line_group lg
          LEFT JOIN departments d ON d.department_id = lg.department_id
          WHERE lg.bot_id = ${args.botId}::uuid AND lg.group_id = ${args.primaryGroupId}
          LIMIT 1
        `);
        const g = groupRes.rows[0];
        departmentId = g?.department_id ?? null;
        departmentName = g?.department_name ?? null;
      }

      // INSERT users · display_name 用 Alice 確認的（default 是 line_member 的 display_name）
      // role='group_owner' 對齊 CLAUDE.md 現有 role 設計（v1 不加 employee role）
      const userRes = await tx.execute<{ user_id: string }>(sql`
        INSERT INTO users
          (tenant_id, email, display_name, department_id, role, must_change_password)
        VALUES
          (${tenantId}::uuid,
           ${args.lineUserId + "@line.local"},  -- LIFF 綁定沒 email · 用 line_user_id 佔位
           ${args.displayName},
           ${departmentId}::uuid,
           'group_owner',
           false)
        RETURNING user_id::text
      `);
      const newUserId = userRes.rows[0].user_id;

      // INSERT binding
      const { bindingId } = await this.bindingRepo.create(tx, {
        userId: newUserId,
        botId: args.botId,
        lineUserId: args.lineUserId,
        boundBy: newUserId,                                     // self-service · 綁定者是自己
        bindingMethod: "liff_self_service",
        metadata: args.metadata,
      });

      this.logger.log(`LIFF binding complete · user=${args.displayName} (${newUserId}) · botId=${args.botId} · lineUserId=${args.lineUserId.slice(-6)}`);

      return {
        userId: newUserId,
        bindingId,
        displayName: args.displayName,
        departmentName,
      };
    });
  }

  /**
   * 依 lineUserId 反查 aiproot user · pipeline / warroom / personal report 都要用
   * 高頻呼叫 · 走 rawDb（不需 request context）
   */
  async resolveUserByLineUserId(botId: string, lineUserId: string): Promise<string | null> {
    const binding = await this.bindingRepo.getActiveByLineUserId(rawDb, botId, lineUserId);
    return binding?.userId ?? null;
  }

  /**
   * Alice 自撤銷 · 或 aiproot admin 撤銷
   */
  async revokeBinding(bindingId: string, revokedBy: string, reason: "self_revoke" | "aiproot_revoke" | "user_deleted"): Promise<void> {
    await withSystemTx((tx) => this.bindingRepo.revoke(tx, bindingId, { revokedBy, reason }));
    this.logger.log(`Binding revoked · bindingId=${bindingId} · reason=${reason}`);
  }
}
