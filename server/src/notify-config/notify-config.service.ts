import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { currentTx } from "../db/client.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { NotifyConfigRepository } from "./notify-config.repository.js";
import { RuleRepository } from "../notification-hub/rule.repository.js";
import { LineApiClient } from "../line-ingest/line-api.client.js";
import { sql } from "drizzle-orm";
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
  /**
   * 0061 · 用哪支 bot 發送 · line_group 必填（群組清單依它過濾）。
   * ⚠️ 刻意寫成「必填但可為 undefined」而非 `botId?:` —— controller 的 create
   * 是逐欄位重組 body，選填型別讓它整個漏掉 botId 也編譯得過（2026-08-12 真的漏了，
   * 前端送了、後端卻回「請選擇要用哪支機器人發送」）。
   */
  botId: string | undefined;
}

@Injectable()
export class NotifyConfigService {
  constructor(
    private readonly repo: NotifyConfigRepository,
    private readonly rules: RuleRepository,
    private readonly lineApi: LineApiClient,
  ) {}

  private newToken(): string {
    return randomBytes(24).toString("base64url");
  }

  eventCatalog() {
    return EVENT_CATALOG;
  }

  /** 目標群下拉 · 不經 ragic 帳號（見 repository 的說明）*/
  listAllLineGroups() {
    return this.repo.listAllLineGroups(currentTx());
  }

  listNotifiableUsers(tenantId: string) {
    return this.rules.listNotifiableUsers(currentTx(), tenantId);
  }

  /**
   * 可選的「發送機器人 + 該機器人所在的群組」。
   *
   * 這是精靈第 3 步的資料來源。**群組清單依 bot 過濾**，所以使用者不可能挑到
   * 別支 bot 的群 —— LINE 的群組 ID 依 bot 發放，挑錯就是 400 而且看不出原因
   * （2026-08-12 鮮湧事故）。把錯誤消滅在選項裡，不是靠使用者填對。
   *
   * 只列 active 的 bot 與 active 的群：已離開的群送過去也是 400。
   */
  async listSendableTargets(): Promise<Array<{
    botId: string;
    botName: string;
    tenantId: string | null;
    tenantName: string | null;
    groups: Array<{ groupId: string; displayName: string | null }>;
  }>> {
    const tx = currentTx();
    const bots = await tx.execute<{
      bot_id: string; bot_name: string; tenant_id: string | null; tenant_name: string | null;
    }>(sql`
      SELECT b.bot_id::text AS bot_id, b.name AS bot_name,
             b.tenant_id::text AS tenant_id, t.tenant_name
      FROM line_bot b LEFT JOIN tenants t ON t.tenant_id = b.tenant_id
      WHERE b.status = 'active' AND b.kind = 'analysis'
      ORDER BY t.tenant_name NULLS LAST, b.name
    `);
    const groups = await tx.execute<{ bot_id: string; group_id: string; display_name: string | null }>(sql`
      SELECT bot_id::text AS bot_id, group_id, display_name
      FROM line_group WHERE status = 'active'
      ORDER BY display_name NULLS LAST, group_id
    `);
    const byBot = new Map<string, Array<{ groupId: string; displayName: string | null }>>();
    for (const g of groups.rows) {
      const arr = byBot.get(g.bot_id) ?? [];
      arr.push({ groupId: g.group_id, displayName: g.display_name });
      byBot.set(g.bot_id, arr);
    }
    return bots.rows.map((b) => ({
      botId: b.bot_id,
      botName: b.bot_name,
      tenantId: b.tenant_id,
      tenantName: b.tenant_name,
      groups: byBot.get(b.bot_id) ?? [],
    }));
  }

  /**
   * 這個群組 ID 屬於哪支 bot？—— 逐支 active bot 拿 token 問 LINE。
   *
   * 為什麼需要：`line_group` 只在收到 webhook 事件時才有紀錄，
   * bot 若在 webhook 設定完成前就進群，我方就完全沒有那個群的資料
   * （2026-08-12：四條規則的目標群 C452bb99… 就是這種）。
   * 補既有規則的 bot_id 前必須先查清楚 —— **不可以用「現在能送成功」反推**，
   * 那只證明全域 token 那支在裡面，而全域 token 指向誰正是要拆掉的東西。
   */
  async whichBotIsInGroup(groupId: string): Promise<Array<{
    botId: string; botName: string; tenantName: string | null; groupName: string | null;
  }>> {
    const tx = currentTx();
    const bots = await tx.execute<{ bot_id: string; bot_name: string; tenant_name: string | null }>(sql`
      SELECT b.bot_id::text AS bot_id, b.name AS bot_name, t.tenant_name
      FROM line_bot b LEFT JOIN tenants t ON t.tenant_id = b.tenant_id
      WHERE b.status = 'active'
    `);
    const hits: Array<{ botId: string; botName: string; tenantName: string | null; groupName: string | null }> = [];
    for (const b of bots.rows) {
      const token = await this.rules.getLineTokenForBot(tx, b.bot_id);
      if (!token) continue;
      const summary = await this.lineApi.getGroupSummary(token, groupId);
      if (summary) {
        hits.push({
          botId: b.bot_id, botName: b.bot_name, tenantName: b.tenant_name,
          groupName: summary.groupName ?? null,
        });
      }
    }
    return hits;
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

    // 0061 · LINE 的群組 ID 依 bot 發放 —— 沒指定 bot 就只能猜，猜錯就是 400 且看不出原因。
    // 群組必須真的屬於那支 bot，否則存進去只是把錯誤延後到真實事件發生時才爆。
    if (input.channelType === "line_group") {
      if (!input.botId) throw new BadRequestException("請選擇要用哪支機器人發送");
      const owns = await this.repo.groupBelongsToBot(tx, input.botId, input.channelTarget.trim());
      if (!owns) {
        throw new BadRequestException(
          "這個群組不屬於所選的機器人 · 請改從清單挑選（LINE 的群組編號是各機器人各自一套，不能互用）",
        );
      }
    }

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
        botId: input.botId ?? null,
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
      botId: input.botId ?? null,
      createdBy: user.user_id,
    });
    return { ruleId, webhookToken: null };
  }

  /** 單條規則的完整內容 · 編輯畫面預填用（列表只有摘要） */
  async getRuleDetail(ruleId: string) {
    const cur = await this.rules.getById(currentTx(), ruleId);
    if (!cur) throw new NotFoundException("找不到這條規則");
    const cfg = cur.sourceConfig as Record<string, unknown>;
    const tpl = cur.template as { title?: string; items?: Array<{ path: string; label: string; order: number }> };
    const ev = (cfg.events ?? {}) as { create?: boolean; update?: boolean; delete?: boolean };
    return {
      ruleId: cur.ruleId,
      name: cur.name,
      sourceType: cur.sourceType,
      // 這三個回給前端只為了顯示，前端不可送回來改（改了等於換一條規則）
      ragicAccountId: (cfg.ragicAccountId as string) ?? null,
      sheetPath: (cfg.sheetPath as string) ?? null,
      sheetName: (cfg.sheetName as string) ?? null,
      eventType: (cfg.eventType as string) ?? null,
      notifyCreate: ev.create ?? true,
      notifyUpdate: ev.update ?? true,
      notifyDelete: ev.delete ?? false,
      title: tpl?.title ?? null,
      fields: (tpl?.items ?? []).map((i) => ({ path: i.path, label: i.label, order: i.order })),
      channelType: cur.channelType,
      channelTarget: cur.channelTarget,
      botId: cur.botId,
    };
  }

  /**
   * 編輯規則 · 可以改：名稱、觸發事件、欄位、標題、通知對象。
   * 不能改：來源類型、Ragic 表單路徑、webhook 網址 —— 那三個改了等於換一條規則，
   * 而網址已經貼在客戶的 Ragic 那一側，客戶不會知道，通知會悄悄停掉。
   */
  async updateRule(ruleId: string, input: {
    name?: string; title?: string | null;
    notifyCreate?: boolean; notifyUpdate?: boolean; notifyDelete?: boolean;
    fields?: Array<{ path: string | number; label: string; order: number }>;
    channelType?: string; channelTarget?: string;
    botId?: string;
  }): Promise<{ status: string }> {
    const tx = currentTx();
    const cur = await this.rules.getById(tx, ruleId);
    if (!cur) throw new NotFoundException("找不到這條規則");
    if (!input.fields?.length) throw new BadRequestException("至少勾選一個通知欄位");
    if (!input.channelTarget?.trim()) throw new BadRequestException("請選擇通知對象");
    // 與 createRule 同一道閘 —— 編輯時一樣不可以指到別支 bot 的群
    const nextChannelType = input.channelType ?? cur.channelType;
    if (nextChannelType === "line_group" && input.botId) {
      const owns = await this.repo.groupBelongsToBot(tx, input.botId, input.channelTarget.trim());
      if (!owns) {
        throw new BadRequestException(
          "這個群組不屬於所選的機器人 · 請改從清單挑選（LINE 的群組編號是各機器人各自一套，不能互用）",
        );
      }
    }

    const name = input.name?.trim() || cur.name;
    const template: NotificationTemplate = {
      title: input.title?.trim() || name,
      items: input.fields.map((f) => ({ path: String(f.path), label: f.label, order: f.order })),
    };
    const events = cur.sourceType === "ragic_form"
      ? {
          create: input.notifyCreate ?? true,
          update: input.notifyUpdate ?? true,
          delete: input.notifyDelete ?? false,
        }
      : null;

    const ok = await this.rules.update(tx, ruleId, {
      name, events, template,
      channelType: input.channelType ?? cur.channelType,
      channelTarget: input.channelTarget.trim(),
      botId: input.botId,
    });
    if (!ok) throw new NotFoundException("找不到這條規則");
    return { status: "ok" };
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
