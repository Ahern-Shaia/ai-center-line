import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { withTenant } from "../db/client.js";
import { PasswordPolicyService } from "../auth/password-policy.service.js";
import { UserLineBindingRepository } from "./user-line-binding.repository.js";
import { LiffPrefillService } from "./liff-prefill.service.js";
import { msg } from "../i18n/index.js";

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
    private readonly passwordPolicy: PasswordPolicyService,
  ) {}

  /**
   * LIFF 選配 · 綁定完成的員工可設 email + 密碼 · 提供 email 登入備援
   * · 走 lineUserId 認證 (LIFF SDK 保證)
   * · Email 唯一性檢查限自 tenant (別 tenant 可重用)
   * · 密碼走 password policy validate
   * · 自設 · 不 force change (must_change_password = false)
   */
  async setPasswordViaLiff(args: {
    botId: string;
    lineUserId: string;
    email: string;
    password: string;
  }): Promise<{ success: true; email: string }> {
    // Step 1 · 走綁定表對照 · 拿 userId + tenantId
    const binding = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) =>
      this.bindingRepo.getActiveByLineUserId(tx, args.botId, args.lineUserId),
    );
    if (!binding) throw new NotFoundException(msg("srv.bind.notBoundHint"));

    const userInfo = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{
      tenant_id: string; display_name: string;
    }>(sql`SELECT tenant_id::text, display_name FROM users WHERE user_id = ${binding.userId}::uuid`));
    const user = userInfo.rows[0];
    if (!user) throw new NotFoundException(msg("srv.auth.noUserRecord"));

    // Step 2 · 密碼強度驗
    const emailTrimmed = args.email.trim().toLowerCase();
    if (!emailTrimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      throw new BadRequestException(msg("srv.v.email"));
    }
    this.passwordPolicy.validate(args.password, { email: emailTrimmed, displayName: user.display_name });

    // Step 3 · Email 唯一性檢查 (同 tenant · 排除自己)
    return withTenant({ tenantId: user.tenant_id, role: "tenant_admin" }, async (tx) => {
      const collide = await tx.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM users
        WHERE tenant_id = ${user.tenant_id}::uuid
          AND lower(email) = ${emailTrimmed}
          AND user_id != ${binding.userId}::uuid
      `);
      if (parseInt(collide.rows[0].n, 10) > 0) {
        throw new ConflictException(msg("srv.user.emailTaken"));
      }

      const hash = await bcrypt.hash(args.password, 10);
      await tx.execute(sql`
        UPDATE users SET
          email = ${emailTrimmed},
          password_hash = ${hash},
          password_updated_at = now(),
          password_expires_at = now() + interval '90 days',
          must_change_password = false
        WHERE user_id = ${binding.userId}::uuid
      `);
      this.logger.log(`Employee set password · user=${binding.userId} · email=${emailTrimmed}`);
      return { success: true as const, email: emailTrimmed };
    });
  }

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
    // 先檢查是否已綁定 · webhook 觸發 · 不知 tenant · 走 aiproot_admin 跨租戶讀
    const existing = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.bindingRepo.getActiveByLineUserId(tx, botId, lineUserId));
    if (existing) {
      const userRes = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{ display_name: string; email: string }>(sql`
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
   *   - INSERT users (tenant_id 從 bot 查 · display_name · department_id · role='employee')
   *   - INSERT user_line_binding · method='liff_self_service'
   */
  /**
   * v3（2026-08-28）· **員工可以自己選群組**；不選則沿用 server 推斷。
   *
   * ## 為什麼推翻 v2
   *
   * v2 寫著「系統推斷比人工可靠」，理由是群組活動是 LINE 保證的技術事實。
   * **實例推翻了它**：有員工發言最多的部門群，並不是他真正歸屬的部門
   * （行銷的人在別的群話比較多）。「發言最多」量到的是**社交活躍度**，
   * 不是**組織歸屬**——這兩件事本來就不保證一致，而我們一直當它們是。
   *
   * v2 的其餘三條理由仍然成立，所以**不是全開，是有邊界地開**：
   *   · 只能從**他自己近 30 天發過言的群**裡選（下方 SQL 就是這道邊界）
   *     —— 這個端點是 `@Public()`，不擋的話任何人都能把自己塞進任一部門
   *   · 只能選**已分派部門且 group_type='department'** 的群
   *     —— 否則產出會歸到不存在的組織單位（0068 那條註解）
   *   · 自選會寫 `department_source='manual'`（migration 0052：手動優先，
   *     **永不被自動推導覆寫**）—— 主管改過的與員工選過的一樣受保護
   *   · 選錯仍然只有 tenant_admin 能改，責任與 audit 不變
   *
   * ⚠️ 驗證失敗要**丟錯不要靜默退回自動推斷** —— 靜默退回的話，
   *    使用者以為自己選好了，實際上系統用的是別的答案。
   */
  async completeLiffBinding(args: {
    botId: string;
    lineUserId: string;
    displayName: string;
    /** 員工自選的主要群（LINE groupId）· 不給就沿用 server 推斷 */
    primaryGroupId?: string;
    metadata: Record<string, unknown>;
  }): Promise<{
    userId: string;
    bindingId: string;
    displayName: string;
    departmentName: string | null;
    departmentSource: "auto_from_group_activity" | "self_selected" | "unassigned_needs_manager";
  }> {
    // 檢查是否已綁定（防重）· 跨租戶讀走 aiproot_admin (需通過 user_line_binding EXISTS→users 子查詢)
    const existing = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.bindingRepo.getActiveByLineUserId(tx, args.botId, args.lineUserId));
    if (existing) {
      throw new BadRequestException(msg("srv.bind.already"));
    }

    // Step 1 · 跨租戶查 bot tenant (line_bot 允 aiproot_admin)
    const bot = await withTenant({ tenantId: null, role: "aiproot_admin" }, async (tx) => {
      const r = await tx.execute<{ tenant_id: string }>(sql`
        SELECT tenant_id::text FROM line_bot WHERE bot_id = ${args.botId}::uuid LIMIT 1
      `);
      return r.rows[0];
    });
    if (!bot) throw new NotFoundException(msg("srv.bind.noBot"));

    // Step 2 · 拿到 tenant 後 · 走 tenant_admin 讀 departments + INSERT users/binding
    return withTenant({ tenantId: bot.tenant_id, role: "tenant_admin" }, async (tx) => {
      // Derive department · 從 line_message 撈 Alice 近 30 天發言最多的群 → 對應 department
      const inferred = await tx.execute<{ department_id: string | null; department_name: string | null; message_count: number }>(sql`
        SELECT lg.department_id::text,
               d.department_name,
               count(*)::int AS message_count
        FROM line_message lm
        JOIN line_group lg ON lg.bot_id = lm.bot_id AND lg.group_id = lm.group_id
        LEFT JOIN departments d ON d.department_id = lg.department_id
        WHERE lm.bot_id = ${args.botId}::uuid
          AND lm.sender_line_id = ${args.lineUserId}
          AND lm.chat_context = 'group'
          AND lm.sent_at > now() - interval '30 days'
          AND lg.department_id IS NOT NULL
          -- 0068 · 只看部門群。少這一行的話，在「有你真好」（全員群 40 人，
          -- 而社交群通常話最多）發言最多的人會被歸到那個假部門，
          -- 他的日報與任務就統計到一個不存在的組織單位底下。
          AND lg.group_type = 'department'
        GROUP BY lg.department_id, d.department_name
        ORDER BY count(*) DESC
        LIMIT 1
      `);
      // 員工自選 → 驗證那個群真的是「他自己發過言、已分派部門、且是部門群」。
      // ⚠️ 這是 @Public() 端點的安全邊界：少了它，任何人都能把自己塞進任一部門。
      let chosen: { department_id: string | null; department_name: string | null } | undefined;
      if (args.primaryGroupId) {
        const ok = await tx.execute<{ department_id: string | null; department_name: string | null }>(sql`
          SELECT lg.department_id::text, d.department_name
          FROM line_message lm
          JOIN line_group lg ON lg.bot_id = lm.bot_id AND lg.group_id = lm.group_id
          LEFT JOIN departments d ON d.department_id = lg.department_id
          WHERE lm.bot_id = ${args.botId}::uuid
            AND lm.sender_line_id = ${args.lineUserId}
            AND lm.group_id = ${args.primaryGroupId}
            AND lm.chat_context = 'group'
            AND lm.sent_at > now() - interval '30 days'
            AND lg.department_id IS NOT NULL
            AND lg.group_type = 'department'
          GROUP BY lg.department_id, d.department_name
          LIMIT 1
        `);
        chosen = ok.rows[0];
        // 丟錯不要靜默退回自動推斷 —— 那會讓使用者以為選好了，系統卻用別的答案
        if (!chosen) throw new BadRequestException(msg("srv.bind.badGroupChoice"));
      }

      const primaryDept = inferred.rows[0];
      const departmentId: string | null = chosen ? chosen.department_id : (primaryDept?.department_id ?? null);
      const departmentName: string | null = chosen ? chosen.department_name : (primaryDept?.department_name ?? null);
      const source: "auto_from_group_activity" | "self_selected" | "unassigned_needs_manager" =
        chosen ? "self_selected" : departmentId ? "auto_from_group_activity" : "unassigned_needs_manager";

      const tenantId = bot.tenant_id;
      // INSERT users · role='employee' (v2 · 對照 migration 0020 加的 role)
      const userRes = await tx.execute<{ user_id: string }>(sql`
        INSERT INTO users
          (tenant_id, email, display_name, department_id, department_source, role, must_change_password)
        VALUES
          (${tenantId}::uuid,
           ${args.lineUserId + "@line.local"},
           ${args.displayName},
           ${departmentId}::uuid,
           -- ⚠️ 自選寫 'manual'（migration 0052：手動優先、**永不被自動推導覆寫**）。
           --    寫成 'auto' 的話，下一次自動推導會把員工自己選的答案蓋掉。
           ${chosen ? "manual" : "auto"},
           'employee',
           false)
        RETURNING user_id::text
      `);
      const newUserId = userRes.rows[0].user_id;

      const { bindingId } = await this.bindingRepo.create(tx, {
        userId: newUserId,
        botId: args.botId,
        lineUserId: args.lineUserId,
        boundBy: newUserId,
        bindingMethod: "liff_self_service",
        metadata: { ...args.metadata, dept_source: source, dept_chosen_group: args.primaryGroupId ?? null, dept_inferred_from_messages: primaryDept?.message_count ?? 0 },
      });

      this.logger.log(`LIFF binding complete · user=${args.displayName} · dept=${departmentName ?? "(未分派)"} · source=${source}`);

      return {
        userId: newUserId,
        bindingId,
        displayName: args.displayName,
        departmentName,
        departmentSource: source,
      };
    });
  }

  /**
   * 依 lineUserId 反查 aiproot user · pipeline / warroom / personal report 都要用
   * 高頻呼叫 · user_line_binding USING 子查詢會撞 users RLS · 用 aiproot_admin 跨租戶讀
   */
  async resolveUserByLineUserId(botId: string, lineUserId: string): Promise<string | null> {
    const binding = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.bindingRepo.getActiveByLineUserId(tx, botId, lineUserId));
    return binding?.userId ?? null;
  }

  /**
   * Alice 自撤銷 · 或 aiproot admin 撤銷
   * 跨租戶 revoke 需 aiproot_admin (bindingId 已知 · RLS 檢 users 子查詢)
   */
  async revokeBinding(bindingId: string, revokedBy: string, reason: "self_revoke" | "aiproot_revoke" | "user_deleted"): Promise<void> {
    await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.bindingRepo.revoke(tx, bindingId, { revokedBy, reason }));
    this.logger.log(`Binding revoked · bindingId=${bindingId} · reason=${reason}`);
  }

  /**
   * tenant_admin 撤銷自租戶員工綁定
   * · 一律在該 tenant 上下文執行 · user_line_binding RLS (USING · FOR ALL) 會把
   *   非本租戶的 binding_id 濾掉 → UPDATE 命中 0 列 → revoked=false → 視同找不到。
   *   ⇒ 跨租戶 IDOR 由 RLS 擋死 · 不靠應用層額外查詢。
   * · tenantId 必須來自 caller 的 JWT（非 client 輸入）。
   */
  async revokeBindingForTenant(bindingId: string, tenantId: string, revokedBy: string): Promise<void> {
    const { revoked } = await withTenant({ tenantId, role: "tenant_admin" }, (tx) =>
      this.bindingRepo.revoke(tx, bindingId, { revokedBy, reason: "tenant_admin_revoke" }),
    );
    if (!revoked) {
      throw new NotFoundException(msg("srv.bind.noRevocable"));
    }
    this.logger.log(`Binding revoked by tenant_admin · bindingId=${bindingId} · tenant=${tenantId}`);
  }

  /**
   * 永久刪除已撤銷的綁定 · 清稽核頁雜訊。
   * · 跨租戶 IDOR 同樣由 RLS 擋（在該 tenant 上下文執行 → 別家的 binding_id 命中 0 列）
   * · repo 層另有 `status = 'revoked'` 護欄，active 的刪不掉
   */
  async deleteRevokedBindingForTenant(bindingId: string, tenantId: string, actorId: string): Promise<void> {
    const { deleted } = await withTenant({ tenantId, role: "tenant_admin" }, (tx) =>
      this.bindingRepo.deleteRevoked(tx, bindingId),
    );
    if (!deleted) {
      throw new NotFoundException(msg("srv.bind.noDeletable"));
    }
    this.logger.log(`Revoked binding deleted · bindingId=${bindingId} · tenant=${tenantId} · by=${actorId}`);
  }

  /** aiproot 平台端刪除已撤銷綁定（跨租戶） */
  async deleteRevokedBinding(bindingId: string, actorId: string): Promise<void> {
    const { deleted } = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) =>
      this.bindingRepo.deleteRevoked(tx, bindingId),
    );
    if (!deleted) {
      throw new NotFoundException(msg("srv.bind.noDeletable"));
    }
    this.logger.log(`Revoked binding deleted by aiproot · bindingId=${bindingId} · by=${actorId}`);
  }
}
