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
    // 排查線索：訊息欄位全空時，用來分辨是「沒抓到 record」「key 對不上」還是「資料真的空」
    const diagnostics: Record<string, unknown> = {
      // 留原始內容片段：Ragic 完整 / 精簡兩種模式形狀差很多，只看 key 名判斷不出來
      webhookBody: safePreview(body),
      parsedEventType: parsed.eventType,
      parsedRecordId: parsed.recordId,
      recordFetched: false,
    };

    if (parsed.recordId != null) {
      const acc = await withSystemTx((tx) => this.rules.getRagicAccount(tx, cfg.ragicAccountId));
      if (!acc) {
        diagnostics.fetchSkipped = "找不到 Ragic 帳號設定";
      } else {
        link = `https://${acc.server}.ragic.com/${acc.apname}${cfg.sheetPath}/${parsed.recordId}`;
        if (parsed.eventType === "DELETE") {
          diagnostics.fetchSkipped = "DELETE 事件不取 record";
        } else if (!acc.apiKey) {
          diagnostics.fetchSkipped = "此 Ragic 帳號未設定 API 金鑰 → 只能用 webhook 帶的內容";
        } else {
          try {
            payload = await this.api.fetchRecord(
              { server: acc.server, apname: acc.apname, apiKey: acc.apiKey },
              cfg.sheetPath,
              parsed.recordId,
            );
            diagnostics.recordFetched = true;
          } catch (e) {
            diagnostics.fetchError = (e as Error).message.slice(0, 300);
            this.logger.warn(`fetch record 失敗 · 改用 webhook 內容 · ${(e as Error).message}`);
          }
        }
      }
    } else {
      diagnostics.fetchSkipped = "webhook 未帶 record id";
    }

    // 模板 path 與 payload key 對不上是「全部（未填）」最隱蔽的成因 → 直接把兩邊列出來比
    const payloadKeys = Object.keys(payload);
    diagnostics.payloadKeys = payloadKeys.slice(0, 20);
    diagnostics.payloadKeyCount = payloadKeys.length;
    diagnostics.templatePaths = (rule.template.items ?? []).map((i) => i.path).slice(0, 20);
    diagnostics.matchedPaths = (rule.template.items ?? []).filter((i) => i.path in payload).length;

    const event: NotificationEvent = {
      sourceType: "ragic_form",
      tenantId: rule.tenantId,
      eventLabel: parsed.eventType === "CREATE" ? "已新增" : parsed.eventType === "DELETE" ? "已刪除" : "已更新",
      dedupKey: `${cfg.sheetPath}:${parsed.recordId ?? 0}`,
      payload,
      link,
      sourceRef: cfg.sheetPath,
      recordId: parsed.recordId ?? 0,
      diagnostics,
    };

    const res = await this.pipeline.deliver(rule, event);
    return { status: res.status };
  }
}

// webhook 原始內容片段（排查用）· 截斷避免把整筆資料塞進 log
function safePreview(body: unknown): string {
  try {
    const s = JSON.stringify(body);
    return s == null ? String(body) : s.length > 400 ? `${s.slice(0, 400)}…（已截斷）` : s;
  } catch {
    return "（無法序列化）";
  }
}
