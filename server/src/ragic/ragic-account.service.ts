import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
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
    // (server, apname) 有唯一索引。撞到時原本會把 pg 的 23505 原樣往外丟 ——
    // 使用者看到的是一整段英文堆疊，而他真正要做的只是「這個帳號已經有了，去換它的金鑰」。
    // 想換金鑰的人第一直覺就是重新建一次帳號，所以這條路一定會被走到。
    try {
      return await this.repo.create(currentTx(), {
        tenantId: input.tenantId ?? null,
        server, apname, displayName,
        apiKey: input.apiKey?.trim() || null,
        createdBy: user.user_id,
      });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        const existing = (await this.repo.list(currentTx()))
          .find((a) => a.server === server && a.apname === apname);
        throw new ConflictException(
          `這個 Ragic 帳號已經建過了（${server} · ${apname}`
          + `${existing ? `，目前名稱「${existing.displayName}」` : ""}）`
          + ` —— 不需要重建：直接在下拉選它，要換金鑰請按「更新金鑰」`,
        );
      }
      throw e;
    }
  }

  async updateKey(_user: JwtUser, accountId: string, apiKey: string): Promise<{ status: string }> {
    if (!apiKey?.trim()) throw new BadRequestException("apiKey 必填");
    const ok = await this.repo.updateKey(currentTx(), accountId, apiKey.trim());
    if (!ok) throw new NotFoundException("Ragic 帳號不存在");
    return { status: "ok" };
  }

  async rename(_user: JwtUser, accountId: string, displayName: string): Promise<{ status: string }> {
    const name = displayName?.trim();
    if (!name) throw new BadRequestException("顯示名稱不可空白");
    if (name.length > 60) throw new BadRequestException("顯示名稱請控制在 60 字以內");
    const ok = await this.repo.updateDisplayName(currentTx(), accountId, name);
    if (!ok) throw new NotFoundException("Ragic 帳號不存在");
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
