import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { currentTx } from "../db/client.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { RagicAccountRepository, type RagicAccountRow } from "./ragic-account.repository.js";
import { RagicApiClient, type RagicSchemaResult } from "./ragic-api.client.js";

// Ragic 帳號管理 + 抓欄位（供前端勾選）· 走 aiproot 上下文（currentTx · RLS 允 aiproot/consultant）
@Injectable()
export class RagicAccountService {
  constructor(
    private readonly repo: RagicAccountRepository,
    private readonly api: RagicApiClient,
  ) {}

  listAccounts(): Promise<RagicAccountRow[]> {
    return this.repo.list(currentTx());
  }

  async createAccount(user: JwtUser, input: {
    tenantId?: string | null; server: string; apname: string; displayName: string; apiKey?: string;
  }): Promise<{ accountId: string }> {
    const server = input.server?.trim();
    const apname = input.apname?.trim();
    const displayName = input.displayName?.trim();
    if (!server || !apname || !displayName) {
      throw new BadRequestException("server / apname / displayName 必填");
    }
    return this.repo.create(currentTx(), {
      tenantId: input.tenantId ?? null,
      server, apname, displayName,
      apiKey: input.apiKey?.trim() || null,
      createdBy: user.user_id,
    });
  }

  async updateKey(_user: JwtUser, accountId: string, apiKey: string): Promise<{ status: string }> {
    if (!apiKey?.trim()) throw new BadRequestException("apiKey 必填");
    await this.repo.updateKey(currentTx(), accountId, apiKey.trim());
    return { status: "ok" };
  }

  // 抓某表單欄位（前端勾選用）· 同時驗證 key 是否有效
  async fetchSheetFields(accountId: string, sheetPath: string): Promise<RagicSchemaResult> {
    const acc = await this.repo.getWithKey(currentTx(), accountId);
    if (!acc) throw new NotFoundException("Ragic 帳號不存在");
    if (!acc.apiKey) throw new BadRequestException("此帳號尚未設定 API key");
    if (!sheetPath?.trim()) throw new BadRequestException("sheetPath 必填");
    return this.api.fetchSchemaFields(
      { server: acc.server, apname: acc.apname, apiKey: acc.apiKey },
      sheetPath.trim(),
    );
  }
}
