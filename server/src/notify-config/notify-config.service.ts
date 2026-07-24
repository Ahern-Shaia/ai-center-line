import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { currentTx } from "../db/client.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { NotifyConfigRepository } from "./notify-config.repository.js";
import type { NotifyConfigField } from "../db/schema.js";

// notify_config CRUD（供 M3 前端 UI）· webhook token 於此產生
@Injectable()
export class NotifyConfigService {
  constructor(private readonly repo: NotifyConfigRepository) {}

  // 不可猜隨機 token · 綁 webhook URL /notify/webhook/<token>
  private newToken(): string {
    return randomBytes(24).toString("base64url");
  }

  listConfigs() {
    return this.repo.list(currentTx());
  }

  async createConfig(user: JwtUser, input: {
    ragicAccountId: string; tenantId: string | null; sheetPath: string; sheetName: string;
    title: string | null; fields: NotifyConfigField[];
    notifyCreate: boolean; notifyUpdate: boolean; notifyDelete: boolean; lineGroupId: string;
  }): Promise<{ configId: string; webhookToken: string }> {
    const webhookToken = this.newToken();
    const { configId } = await this.repo.create(currentTx(), { ...input, webhookToken, createdBy: user.user_id });
    return { configId, webhookToken };
  }

  async setEnabled(configId: string, enabled: boolean): Promise<{ status: string }> {
    await this.repo.setEnabled(currentTx(), configId, enabled);
    return { status: "ok" };
  }

  async remove(configId: string): Promise<{ status: string }> {
    await this.repo.remove(currentTx(), configId);
    return { status: "ok" };
  }
}
