import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
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
  }): Promise<LineBotDto> {
    const tx = currentTx();
    // 若動 access_token · 重新驗一次 · 更新 bot_user_id?（不做 · 若換 token 但同 channel botUserId 不變）
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
    await this.botRepo.update(tx, botId, patch);
    return this.getBot(botId);
  }

  async disableBot(botId: string): Promise<void> {
    const tx = currentTx();
    await this.botRepo.update(tx, botId, { status: "disabled" });
  }

  // Refs 給 UI 下拉：aiproot_admin 新增 bot 挑 tenant · tenant_admin 分派 group 到 department
  // 依 RLS · tenant_admin 只看 own tenant · aiproot_admin 看全
  async getRefs(): Promise<RefsDto> {
    const tx = currentTx();
    const tenants = await tx.execute<{ tenant_id: string; tenant_name: string }>(sql`
      SELECT tenant_id, tenant_name FROM tenants ORDER BY tenant_name
    `);
    const departments = await tx.execute<{ department_id: string; department_name: string }>(sql`
      SELECT department_id, department_name FROM departments ORDER BY department_name
    `);
    return {
      tenants: tenants.rows.map((r) => ({ tenantId: r.tenant_id, tenantName: r.tenant_name })),
      departments: departments.rows.map((r) => ({ departmentId: r.department_id, departmentName: r.department_name })),
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

