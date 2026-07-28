import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx, withTenant, txStore } from "../db/client.js";
import { LineBotRepository, type LineBotListRow } from "./line-bot.repository.js";
import { LineGroupRepository } from "./line-group.repository.js";
import { LineApiClient } from "./line-api.client.js";

export interface LineBotDto {
  botId: string;
  tenantId: string;
  name: string;
  botUserId: string;
  channelId: string | null;
  channelSecretMasked: string;         // 只顯示長度提示 · 不含明碼
  channelAccessTokenMasked: string;
  status: "active" | "disabled";
  webhookVerifiedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  groupCount: number;
}

export interface LineBotCreateInput {
  tenantId: string;
  name: string;
  channelId?: string;
  channelSecret: string;
  channelAccessToken: string;
  createdBy: string;
}

@Injectable()
export class LineBotService {
  private readonly logger = new Logger(LineBotService.name);

  constructor(
    private readonly botRepo: LineBotRepository,
    private readonly groupRepo: LineGroupRepository,
    private readonly lineApi: LineApiClient,
  ) {}

  // 新增 bot · 先 LINE test-call 拿 botUserId · 加密存 DB
  async createBot(input: LineBotCreateInput): Promise<LineBotDto> {
    // OQ-LI-6 · test call 驗 access token 真實可用 · 順便拿 bot_user_id (webhook destination)
    let botInfo;
    try {
      botInfo = await this.lineApi.getBotInfo(input.channelAccessToken);
    } catch (err) {
      throw new BadRequestException({
        status: "line_api_verify_failed",
        message: "無法驗證 Access Token · LINE API 回錯 · 請檢查 token 是否正確",
        detail: (err as Error).message,
      });
    }

    const tx = currentTx();
    // 檢查同 bot_user_id 已存在（唯一約束會擋 · 但先友善提示）
    const dup = await this.botRepo.getByBotUserIdWithSecret(tx, botInfo.userId);
    if (dup) {
      throw new ConflictException({
        status: "bot_already_registered",
        message: "此 LINE bot 已註冊過 · bot_user_id 重複",
      });
    }

    const botId = await this.botRepo.insert(tx, {
      tenantId: input.tenantId,
      name: input.name,
      botUserId: botInfo.userId,
      channelId: input.channelId ?? null,
      channelSecret: input.channelSecret,
      channelAccessToken: input.channelAccessToken,
      createdBy: input.createdBy,
    });

    const row = await this.botRepo.getById(tx, botId);
    if (!row) throw new Error("剛新增的 bot 找不到");
    return this.toDto(row, input.channelSecret, input.channelAccessToken);
  }

  async listBots(): Promise<LineBotDto[]> {
    const tx = currentTx();
    const rows = await this.botRepo.listByTenant(tx);
    // list 不含 secret · 顯示遮罩用固定樣式
    return rows.map((r) => this.toDto(r, null, null));
  }

  async getBot(botId: string): Promise<LineBotDto> {
    const tx = currentTx();
    const row = await this.botRepo.getById(tx, botId);
    if (!row) throw new NotFoundException("找不到 bot");
    // Detail 頁：secret 仍不 return 明碼 · 只 mask
    const full = await this.botRepo.getByIdWithSecrets(tx, botId);
    return this.toDto(row, full?.channelSecret ?? null, full?.channelAccessToken ?? null);
  }

  async updateBot(botId: string, patch: {
    name?: string;
    channelId?: string | null;
    channelSecret?: string;
    channelAccessToken?: string;
    status?: "active" | "disabled";
    tenantId?: string;
  }): Promise<LineBotDto & { movedTenant?: boolean; clearedGroupDepartments?: number }> {
    const tx = currentTx();
    if (patch.channelAccessToken) {
      try {
        await this.lineApi.getBotInfo(patch.channelAccessToken);
      } catch (err) {
        throw new BadRequestException({
          status: "line_api_verify_failed",
          message: "新 Access Token 驗證失敗",
          detail: (err as Error).message,
        });
      }
    }

    // 遷移 tenant 時 · 檢查現況 · 若真的變 · 額外清 group department（跨 tenant dept 無意義）
    let movedTenant = false;
    let clearedGroupDepartments = 0;
    if (patch.tenantId) {
      const existing = await this.botRepo.getById(tx, botId);
      if (!existing) throw new NotFoundException("找不到 bot");
      if (existing.tenantId !== patch.tenantId) {
        movedTenant = true;
      }
    }

    await this.botRepo.update(tx, botId, patch);

    if (movedTenant) {
      clearedGroupDepartments = await this.botRepo.clearGroupDepartments(tx, botId);
    }

    const bot = await this.getBot(botId);
    return { ...bot, movedTenant, clearedGroupDepartments };
  }

  async disableBot(botId: string): Promise<void> {
    const tx = currentTx();
    await this.botRepo.update(tx, botId, { status: "disabled" });
  }

  /**
   * 永久刪除前先算清楚會連帶刪掉什麼。
   *
   * line_group / line_message / line_member / user_line_binding 對 line_bot 全都是
   * ON DELETE CASCADE —— 刪一個 bot 會把它的群組、所有歷史訊息、成員名單、
   * 以及**員工的 LINE 綁定**一起帶走。綁定沒了，那些人的打卡與日報就對不到人。
   * 所以刪除前一定要讓人看到數字，不能只問一句「確定嗎」。
   */
  async deleteImpact(botId: string): Promise<{
    botName: string; status: string; groups: number; messages: number; members: number; bindings: number;
  }> {
    const tx = currentTx();
    const r = await tx.execute<{
      name: string; status: string; groups: number; messages: number; members: number; bindings: number;
    }>(sql`
      SELECT b.name, b.status,
             (SELECT count(*)::int FROM line_group  WHERE bot_id = b.bot_id) AS groups,
             (SELECT count(*)::int FROM line_message WHERE bot_id = b.bot_id) AS messages,
             (SELECT count(*)::int FROM line_member  WHERE bot_id = b.bot_id) AS members,
             (SELECT count(*)::int FROM user_line_binding WHERE bot_id = b.bot_id) AS bindings
        FROM line_bot b WHERE b.bot_id = ${botId}::uuid
    `);
    const row = r.rows[0];
    if (!row) throw new NotFoundException("找不到這個機器人");
    return {
      botName: row.name, status: row.status,
      groups: row.groups, messages: row.messages, members: row.members, bindings: row.bindings,
    };
  }

  /**
   * 永久刪除 · 只允許刪已停用的。
   * 要求先停用不是為了多一道手續，是為了讓「還在收訊息的 bot」不可能被一鍵刪掉。
   */
  async deleteBotPermanently(botId: string): Promise<void> {
    const tx = currentTx();
    const impact = await this.deleteImpact(botId);
    if (impact.status !== "disabled") {
      throw new BadRequestException("請先停用這個機器人，再永久刪除");
    }
    await tx.execute(sql`DELETE FROM line_bot WHERE bot_id = ${botId}::uuid`);
    this.logger.warn(
      `永久刪除 bot · ${impact.botName} · 連帶刪除 群${impact.groups} 訊息${impact.messages} `
      + `成員${impact.members} 綁定${impact.bindings}`,
    );
  }

  // Refs 給 UI 下拉：
  // - tenants: aiproot 用（看誰可選 · 新增 bot / 部門管理切換）
  // - departments: 依傳入 tenantId scope · 這是 bot detail 頁分派部門下拉需要
  //   若無 tenantId 且 caller 是 aiproot · 回空 array (避免混合多 tenant 部門)
  async getRefs(tenantId?: string): Promise<RefsDto> {
    const tx = currentTx();
    const tenants = await tx.execute<{ tenant_id: string; tenant_name: string }>(sql`
      SELECT tenant_id, tenant_name FROM tenants ORDER BY tenant_name
    `);
    let departments: Array<{ departmentId: string; departmentName: string }> = [];
    if (tenantId) {
      // 明確 scope 到指定 tenant · aiproot 也能看到（SET current_tenant 讓 RLS 通）
      await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
      const res = await tx.execute<{ department_id: string; department_name: string }>(sql`
        SELECT department_id, department_name FROM departments
        WHERE tenant_id = ${tenantId}
        ORDER BY department_name
      `);
      departments = res.rows.map((r) => ({ departmentId: r.department_id, departmentName: r.department_name }));
    } else {
      // 沒帶 tenantId · tenant_admin 走 RLS 拿 own tenant departments
      const res = await tx.execute<{ department_id: string; department_name: string }>(sql`
        SELECT department_id, department_name FROM departments ORDER BY department_name
      `);
      departments = res.rows.map((r) => ({ departmentId: r.department_id, departmentName: r.department_name }));
    }
    return {
      tenants: tenants.rows.map((r) => ({ tenantId: r.tenant_id, tenantName: r.tenant_name })),
      departments,
    };
  }

  // === Webhook 專用（不走 tenant RLS · 需 owner-role connection 或 SECURITY DEFINER） ===
  // M1 簡化：webhook controller 直接開自己的 raw tx · 不掛 app.current_tenant · 靠 role 繞 RLS

  private toDto(row: LineBotListRow, secretPlain: string | null, tokenPlain: string | null): LineBotDto {
    return {
      botId: row.botId,
      tenantId: row.tenantId,
      name: row.name,
      botUserId: row.botUserId,
      channelId: row.channelId,
      channelSecretMasked: secretPlain ? LineBotRepository.mask(secretPlain) : "●●●●●●●●●●",
      channelAccessTokenMasked: tokenPlain ? LineBotRepository.mask(tokenPlain) : "●●●●●●●●●●",
      status: row.status,
      webhookVerifiedAt: row.webhookVerifiedAt,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      groupCount: row.groupCount,
    };
  }
}

// txStore 用於 webhook controller 手動 wrap（避開全域 RLS · 靠 role bypass）
export { txStore };

// Refs · 給 UI 下拉用 · aiproot_admin 需 tenants list · tenant_admin 需 departments list
export interface RefsDto {
  tenants: Array<{ tenantId: string; tenantName: string }>;
  departments: Array<{ departmentId: string; departmentName: string }>;
}

