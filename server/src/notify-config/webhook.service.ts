import { Injectable, Logger } from "@nestjs/common";
import { withSystemTx } from "../db/client.js";
import { LineClient } from "../notify/line.client.js";
import { NotifyRepository } from "../notify/notify.repository.js";
import { MemoryDedupCache, type DedupCache } from "../notify/dedup.js";
import { NotifyConfigRepository } from "./notify-config.repository.js";
import { RagicApiClient } from "./ragic-api.client.js";
import { composeFromConfig } from "./dynamic-composer.js";
import { parseRagicWebhook } from "./ragic-webhook.parser.js";

export interface WebhookResult {
  status: "sent" | "skipped_dedup" | "skipped_event" | "line_failed" | "disabled" | "not_found";
  lineStatus?: number;
  lineMessage?: string;
}

// notify v2 webhook 接收編排：查 config（token）→ 事件過濾 → dedup → fetch record → compose → push → audit
// 對照 docs/modules/notify-selfserve-platform.md §4
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private dedup: DedupCache = new MemoryDedupCache(30_000);

  constructor(
    private readonly configRepo: NotifyConfigRepository,
    private readonly api: RagicApiClient,
    private readonly line: LineClient,
    private readonly auditRepo: NotifyRepository,
  ) {}

  /** 僅測試用 */
  setDedupCache(cache: DedupCache): void {
    this.dedup = cache;
  }

  async handleWebhook(token: string, body: unknown): Promise<WebhookResult> {
    const startedAt = Date.now();
    const parsed = parseRagicWebhook(body);

    const config = await withSystemTx((tx) => this.configRepo.getResolvedByToken(tx, token));
    if (!config) return { status: "not_found" };
    if (!config.enabled) return { status: "disabled" };

    // 事件過濾
    const wantEvent =
      parsed.eventType === "CREATE" ? config.notifyCreate
      : parsed.eventType === "DELETE" ? config.notifyDelete
      : config.notifyUpdate;
    if (!wantEvent) return { status: "skipped_event" };

    // dedup（configId + sheetPath + recordId）
    const rid = parsed.recordId ?? 0;
    if (this.dedup.shouldSkip(config.configId, config.sheetPath, rid)) {
      return { status: "skipped_dedup" };
    }

    // fetch 完整 record（非 DELETE + 有 key + 有 recordId）· 失敗降級用 webhook data
    let record = parsed.recordData;
    let recordUrl: string | null = null;
    if (parsed.recordId != null) {
      recordUrl = `https://${config.server}.ragic.com/${config.apname}${config.sheetPath}/${parsed.recordId}`;
      if (parsed.eventType !== "DELETE" && config.apiKey) {
        try {
          record = await this.api.fetchRecord(
            { server: config.server, apname: config.apname, apiKey: config.apiKey },
            config.sheetPath,
            parsed.recordId,
          );
        } catch (e) {
          this.logger.warn(`fetch record 失敗 · 改用 webhook data · ${(e as Error).message}`);
        }
      }
    }

    // compose
    const text = composeFromConfig({
      title: config.title || config.sheetName,
      eventType: parsed.eventType,
      fields: config.fields,
      record,
      recordUrl,
    });

    // resolve LINE token（該租戶 line_bot / env fallback）
    const tenantToken = config.tenantId
      ? await withSystemTx((tx) => this.configRepo.getLineTokenForTenant(tx, config.tenantId as string))
      : null;
    const lineToken = tenantToken ?? process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";

    // push（不 retry）
    const res = await this.line.pushText({ token: lineToken, groupId: config.lineGroupId }, text);

    // audit（reuse notification_log · v2 細節放 audit jsonb）
    await this.auditRepo.writeLog({
      trigger: "save",
      sheetPath: config.sheetPath,
      recordId: rid,
      status: res.ok ? "sent" : "line_failed",
      lineStatus: res.ok ? undefined : res.status,
      lineMessage: res.ok ? undefined : res.message,
      latencyMs: Date.now() - startedAt,
      messageText: text,
      audit: { source: "webhook_v2", configId: config.configId, tenantId: config.tenantId, eventType: parsed.eventType },
    });

    if (res.ok) return { status: "sent" };
    this.logger.warn(`LINE push 失敗 · config=${config.configId} status=${res.status} msg=${res.message}`);
    return { status: "line_failed", lineStatus: res.status, lineMessage: res.message };
  }
}
