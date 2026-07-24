import { Injectable, Logger } from "@nestjs/common";
import { withSystemTx } from "../../db/client.js";
import { RagicApiClient } from "../../notify-config/ragic-api.client.js";
import { parseRagicWebhook } from "../../notify-config/ragic-webhook.parser.js";
import { NotificationPipeline, type DeliverResult } from "../notification.pipeline.js";
import { RuleRepository } from "../rule.repository.js";
import type { NotificationEvent, RagicSourceConfig } from "../types.js";

export type RagicWebhookStatus = DeliverResult["status"] | "not_found" | "skipped_event";

// ragic_form 來源 adapter：Ragic 原生 Webhook → NotificationEvent → pipeline
// 對照 docs/modules/notification-hub.md §4
@Injectable()
export class RagicWebhookService {
  private readonly logger = new Logger(RagicWebhookService.name);

  constructor(
    private readonly rules: RuleRepository,
    private readonly api: RagicApiClient,
    private readonly pipeline: NotificationPipeline,
  ) {}

  async handle(token: string, body: unknown): Promise<{ status: RagicWebhookStatus }> {
    const parsed = parseRagicWebhook(body);
    const rule = await withSystemTx((tx) => this.rules.getByWebhookToken(tx, token));
    if (!rule) return { status: "not_found" };
    if (!rule.enabled) return { status: "disabled" };

    const cfg = rule.sourceConfig as unknown as RagicSourceConfig;

    // 事件過濾（該規則有沒有訂閱這種異動）
    const want =
      parsed.eventType === "CREATE" ? cfg.events?.create
      : parsed.eventType === "DELETE" ? cfg.events?.delete
      : cfg.events?.update;
    if (!want) return { status: "skipped_event" };

    // 取完整 record（非 DELETE 且有 key）· 失敗降級用 webhook 帶的值
    let payload = parsed.recordData;
    let link: string | null = null;
    if (parsed.recordId != null) {
      const acc = await withSystemTx((tx) => this.rules.getRagicAccount(tx, cfg.ragicAccountId));
      if (acc) {
        link = `https://${acc.server}.ragic.com/${acc.apname}${cfg.sheetPath}/${parsed.recordId}`;
        if (parsed.eventType !== "DELETE" && acc.apiKey) {
          try {
            payload = await this.api.fetchRecord(
              { server: acc.server, apname: acc.apname, apiKey: acc.apiKey },
              cfg.sheetPath,
              parsed.recordId,
            );
          } catch (e) {
            this.logger.warn(`fetch record 失敗 · 改用 webhook 內容 · ${(e as Error).message}`);
          }
        }
      }
    }

    const event: NotificationEvent = {
      sourceType: "ragic_form",
      tenantId: rule.tenantId,
      eventLabel: parsed.eventType === "CREATE" ? "已新增" : parsed.eventType === "DELETE" ? "已刪除" : "已更新",
      dedupKey: `${cfg.sheetPath}:${parsed.recordId ?? 0}`,
      payload,
      link,
      sourceRef: cfg.sheetPath,
      recordId: parsed.recordId ?? 0,
    };

    const res = await this.pipeline.deliver(rule, event);
    return { status: res.status };
  }
}
