import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { currentTx } from "../db/client.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { NotifyConfigRepository } from "./notify-config.repository.js";
import { RuleRepository } from "../notification-hub/rule.repository.js";
import type { NotifyConfigField } from "../db/schema.js";
import type { RagicSourceConfig, RuleRow } from "../notification-hub/types.js";

// aiproot「通知設定」service · v3 起底層操作 notification_rule（來源無關）
// 對外仍維持 v2 的 config 形狀，前端契約不變（notification-hub.md §7 遷移）
export interface ConfigView {
  configId: string;
  ragicAccountId: string;
  sheetPath: string;
  sheetName: string;
  webhookToken: string;
  title: string | null;
  fields: NotifyConfigField[];
  notifyCreate: boolean;
  notifyUpdate: boolean;
  notifyDelete: boolean;
  lineGroupId: string;
  enabled: boolean;
  accountDisplayName: string;
}

function toView(r: RuleRow & { accountDisplayName: string | null }): ConfigView {
  const cfg = r.sourceConfig as unknown as RagicSourceConfig;
  return {
    configId: r.ruleId,
    ragicAccountId: cfg?.ragicAccountId ?? "",
    sheetPath: cfg?.sheetPath ?? "",
    sheetName: cfg?.sheetName ?? r.name,
    webhookToken: r.webhookToken ?? "",
    title: r.template?.title ?? null,
    fields: (r.template?.items ?? []).map((it) => ({
      fieldId: Number(it.path),
      label: it.label,
      order: it.order,
    })),
    notifyCreate: cfg?.events?.create ?? false,
    notifyUpdate: cfg?.events?.update ?? false,
    notifyDelete: cfg?.events?.delete ?? false,
    lineGroupId: r.channelTarget ?? "",
    enabled: r.enabled,
    accountDisplayName: r.accountDisplayName ?? "",
  };
}

@Injectable()
export class NotifyConfigService {
  constructor(
    private readonly repo: NotifyConfigRepository,
    private readonly rules: RuleRepository,
  ) {}

  /** 不可猜隨機 token · 綁 webhook URL /notify/webhook/<token> */
  private newToken(): string {
    return randomBytes(24).toString("base64url");
  }

  async listConfigs(): Promise<ConfigView[]> {
    const all = await this.rules.list(currentTx());
    return all.filter((r) => r.sourceType === "ragic_form").map(toView);
  }

  listLineGroupsForAccount(accountId: string) {
    return this.repo.listLineGroupsForAccount(currentTx(), accountId);
  }

  async createConfig(user: JwtUser, input: {
    ragicAccountId: string; sheetPath: string; sheetName: string;
    title: string | null; fields: NotifyConfigField[];
    notifyCreate: boolean; notifyUpdate: boolean; notifyDelete: boolean; lineGroupId: string;
  }): Promise<{ configId: string; webhookToken: string }> {
    const webhookToken = this.newToken();
    const tx = currentTx();
    // tenant 由 Ragic 帳號帶出（不信任前端）
    const tenantId = await this.repo.getAccountTenantId(tx, input.ragicAccountId);
    const { ruleId } = await this.rules.create(tx, {
      tenantId,
      name: input.sheetName,
      sourceType: "ragic_form",
      sourceConfig: {
        ragicAccountId: input.ragicAccountId,
        sheetPath: input.sheetPath,
        sheetName: input.sheetName,
        events: { create: input.notifyCreate, update: input.notifyUpdate, delete: input.notifyDelete },
      },
      webhookToken,
      template: {
        title: input.title || input.sheetName,
        items: input.fields.map((f) => ({ path: String(f.fieldId), label: f.label, order: f.order })),
      },
      channelType: "line_group",
      channelTarget: input.lineGroupId,
      createdBy: user.user_id,
    });
    return { configId: ruleId, webhookToken };
  }

  async setEnabled(configId: string, enabled: boolean): Promise<{ status: string }> {
    await this.rules.setEnabled(currentTx(), configId, enabled);
    return { status: "ok" };
  }

  async remove(configId: string): Promise<{ status: string }> {
    await this.rules.remove(currentTx(), configId);
    return { status: "ok" };
  }
}
