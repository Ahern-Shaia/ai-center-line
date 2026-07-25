import { BadRequestException, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { currentTx } from "../db/client.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { NotifyConfigRepository } from "./notify-config.repository.js";
import { RuleRepository } from "../notification-hub/rule.repository.js";
import { EVENT_CATALOG, findEvent } from "../notification-hub/event-catalog.js";
import type { NotificationTemplate } from "../db/schema.js";
import type { NotificationChannelType, NotificationSourceType } from "../db/schema.js";

export interface RuleView {
  ruleId: string;
  name: string;
  enabled: boolean;
  sourceType: NotificationSourceType;
  sourceLabel: string;       // Ragic 表單路徑 or 事件中文名
  channelType: NotificationChannelType;
  channelTarget: string | null;
  channelLabel: string;      // 群名 / 成員名 / 原值
  fieldCount: number;
  webhookToken: string | null;
  accountDisplayName: string | null;
  eventsLabel: string;       // ragic_form：新增/更新/刪除；internal_event：過濾摘要
}

export interface CreateRuleInput {
  name: string;
  sourceType: NotificationSourceType;
  // ragic_form
  ragicAccountId?: string;
  sheetPath?: string;
  sheetName?: string;
  notifyCreate?: boolean;
  notifyUpdate?: boolean;
  notifyDelete?: boolean;
  // internal_event
  eventType?: string;
  filters?: Array<{ path: string; op: "eq" | "gte" | "lte"; value: string | number }>;
  // 共用
  title?: string | null;
  fields: Array<{ path: string; label: string; order: number }>;
  channelType: NotificationChannelType;
  channelTarget: string;
}

@Injectable()
export class NotifyConfigService {
  constructor(
    private readonly repo: NotifyConfigRepository,
    private readonly rules: RuleRepository,
  ) {}

  private newToken(): string {
    return randomBytes(24).toString("base64url");
  }

  eventCatalog() {
    return EVENT_CATALOG;
  }

  listLineGroupsForAccount(accountId: string) {
    return this.repo.listLineGroupsForAccount(currentTx(), accountId);
  }

  listNotifiableUsers(tenantId: string) {
    return this.rules.listNotifiableUsers(currentTx(), tenantId);
  }

  async listRules(): Promise<RuleView[]> {
    const tx = currentTx();
    const all = await this.rules.list(tx);
    // 管道目標的可讀名稱（LINE 群名 / 成員名）
    const groupNames = await this.repo.listAllLineGroupNames(tx);
    const userNames = await this.repo.listAllUserNames(tx);
    return all.map((r) => {
      const cfg = r.sourceConfig as Record<string, unknown>;
      const isRagic = r.sourceType === "ragic_form";
      const ev = (cfg.events ?? {}) as { create?: boolean; update?: boolean; delete?: boolean };
      const eventsLabel = isRagic
        ? [ev.create && "新增", ev.update && "更新", ev.delete && "刪除"].filter(Boolean).join("・") || "（未選）"
        : (() => {
            const fs = (cfg.filters ?? []) as Array<{ path: string; op: string; value: unknown }>;
            return fs.length ? `${fs.length} 個條件` : "全部";
          })();
      return {
        ruleId: r.ruleId,
        name: r.name,
        enabled: r.enabled,
        sourceType: r.sourceType,
        sourceLabel: isRagic
          ? String(cfg.sheetPath ?? "")
          : findEvent(String(cfg.eventType ?? ""))?.label ?? String(cfg.eventType ?? ""),
        channelType: r.channelType,
        channelTarget: r.channelTarget,
        channelLabel:
          r.channelType === "line_group"
            ? groupNames[r.channelTarget ?? ""] ?? r.channelTarget ?? ""
            : r.channelType === "line_user"
              ? userNames[r.channelTarget ?? ""] ?? r.channelTarget ?? ""
              : r.channelTarget ?? "",
        fieldCount: r.template?.items?.length ?? 0,
        webhookToken: r.webhookToken,
        accountDisplayName: r.accountDisplayName,
        eventsLabel,
      };
    });
  }

  async createRule(user: JwtUser, input: CreateRuleInput): Promise<{ ruleId: string; webhookToken: string | null }> {
    if (!input.fields?.length) throw new BadRequestException("至少勾選一個通知欄位");
    if (!input.channelTarget?.trim()) throw new BadRequestException("請選擇通知對象");

    const tx = currentTx();
    const template: NotificationTemplate = {
      title: input.title?.trim() || input.name,
      items: input.fields.map((f) => ({ path: String(f.path), label: f.label, order: f.order })),
    };

    if (input.sourceType === "ragic_form") {
      if (!input.ragicAccountId || !input.sheetPath?.trim() || !input.sheetName?.trim()) {
        throw new BadRequestException("Ragic 來源需 ragicAccountId / sheetPath / sheetName");
      }
      const tenantId = await this.repo.getAccountTenantId(tx, input.ragicAccountId);
      const webhookToken = this.newToken();
      const { ruleId } = await this.rules.create(tx, {
        tenantId,
        name: input.name || input.sheetName,
        sourceType: "ragic_form",
        sourceConfig: {
          ragicAccountId: input.ragicAccountId,
          sheetPath: input.sheetPath.trim(),
          sheetName: input.sheetName.trim(),
          events: {
            create: input.notifyCreate ?? true,
            update: input.notifyUpdate ?? true,
            delete: input.notifyDelete ?? false,
          },
        },
        webhookToken,
        template,
        channelType: input.channelType,
        channelTarget: input.channelTarget.trim(),
        createdBy: user.user_id,
      });
      return { ruleId, webhookToken };
    }

    // internal_event
    if (!input.eventType || !findEvent(input.eventType)) {
      throw new BadRequestException("未知的事件型別");
    }
    const { ruleId } = await this.rules.create(tx, {
      tenantId: user.tenant_id,
      name: input.name || findEvent(input.eventType)!.label,
      sourceType: "internal_event",
      sourceConfig: { eventType: input.eventType, filters: input.filters ?? [] },
      webhookToken: null,
      template,
      channelType: input.channelType,
      channelTarget: input.channelTarget.trim(),
      createdBy: user.user_id,
    });
    return { ruleId, webhookToken: null };
  }

  async setEnabled(ruleId: string, enabled: boolean): Promise<{ status: string }> {
    await this.rules.setEnabled(currentTx(), ruleId, enabled);
    return { status: "ok" };
  }

  async remove(ruleId: string): Promise<{ status: string }> {
    await this.rules.remove(currentTx(), ruleId);
    return { status: "ok" };
  }
}
