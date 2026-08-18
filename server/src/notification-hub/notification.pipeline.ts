import { Injectable, Logger } from "@nestjs/common";
import { withSystemTx } from "../db/client.js";
import { MemoryDedupCache, type DedupCache } from "../notify/dedup.js";
import { LineSender } from "./channels/line.sender.js";
import { RuleRepository } from "./rule.repository.js";
import { HubAuditRepository } from "./audit.repository.js";
import { countFilledItems, matchFilters, renderTemplate } from "./template.renderer.js";
import type { InternalSourceConfig, NotificationEvent, RuleRow } from "./types.js";

export type DeliverStatus = "sent" | "skipped_dedup" | "skipped_filter" | "line_failed" | "unsupported_channel" | "disabled" | "invalid_body";

export interface DeliverResult {
  status: DeliverStatus;
  lineStatus?: number;
  lineMessage?: string;
}

// 共用中介：filter → dedup → render → send → audit
// 所有來源（ragic_form / internal_event / schedule）與管道共用這一份。
// 對照 docs/modules/notification-hub.md §2
@Injectable()
export class NotificationPipeline {
  private readonly logger = new Logger(NotificationPipeline.name);
  private dedup: DedupCache = new MemoryDedupCache(30_000);

  constructor(
    private readonly rules: RuleRepository,
    private readonly line: LineSender,
    private readonly audit: HubAuditRepository,
  ) {}

  /** 僅測試用 */
  setDedupCache(cache: DedupCache): void {
    this.dedup = cache;
  }

  /** 對單一規則投遞一個事件 */
  async deliver(rule: RuleRow, event: NotificationEvent): Promise<DeliverResult> {
    const startedAt = Date.now();
    if (!rule.enabled) return { status: "disabled" };

    // 1) 規則過濾（internal_event 才有 filters）
    if (rule.sourceType === "internal_event") {
      const cfg = rule.sourceConfig as unknown as InternalSourceConfig;
      if (!matchFilters(cfg, event.payload)) {
        return { status: "skipped_filter" };
      }
    }

    // 2) dedup（rule + 事件 dedupKey）
    if (this.dedup.shouldSkip(rule.ruleId, event.sourceRef ?? rule.sourceType, hashKey(event.dedupKey))) {
      await this.audit.write({
        ruleId: rule.ruleId, sourceType: rule.sourceType, channel: rule.channelType,
        tenantId: rule.tenantId, sourceRef: event.sourceRef ?? null, recordId: event.recordId ?? 0,
        status: "skipped_dedup", latencyMs: Date.now() - startedAt, audit: { dedupKey: event.dedupKey },
      });
      return { status: "skipped_dedup" };
    }

    // 3) render
    const text = renderTemplate(rule.template, event.payload, event.eventLabel, event.link);

    // 3.5) 抓不到完整資料、且每一欄都取不到值 → 不送。
    //
    // 這種訊息長得跟正常通知一樣，但十幾行全是「（未填）」，對收件的人是純噪音，
    // 而且一次 Ragic 批次修改就會洗滿整個群（2026-08-13 那 80 筆就是這樣來的）。
    // 成因是「抓不到完整資料」——例如 Ragic 帳號到期、金鑰失效——
    // 此時 payload 會退回 webhook 帶的內容，一個欄位都對不上。
    //
    // ⚠️ 2026-08-18 用戶裁定：**只擋「抓不到資料」，不擋「資料真的空」**。
    //    原本 0fb415c 是「全空就擋」，但那會連帶擋掉一種正常情境 ——
    //    有人在 Ragic 新建一張空白單、之後才回頭填，那則「已新增」就永遠不會發出，
    //    而「有人開了一張新單」本身就是收件的人想知道的事。
    //    兩者的差別只有一個訊號：`diagnostics.fetchError` 有沒有值。
    //
    //    代價講明：欄位設定與表單不符（改過表單、路徑不同）時會恢復送出全是（未填）的訊息。
    //    那不是靜默的 —— 通知紀錄展開後的診斷會判讀成「已抓到資料，但勾選的欄位一個都對不上」，
    //    指的正是去改欄位設定。擋下來反而讓設定錯誤沒有任何人看得見。
    //
    // 記成 invalid_body（畫面顯示「內容不符」）而不是新增狀態：DB 對 status 有 CHECK，
    // 加值要 migration，而 code 先上線就會 insert 失敗、整個 webhook handler 炸掉 ——
    // 比原本的問題更糟。「內容不符」本來就是核准的 mockup 給這個情境的標籤。
    const itemCount = (rule.template.items ?? []).length;
    const fetchError = (event.diagnostics ?? {}).fetchError;
    if (itemCount > 0 && fetchError && countFilledItems(rule.template, event.payload) === 0) {
      const why = `取不到完整資料，${itemCount} 個欄位全部是空的 · 未送出 · 原因：${String(fetchError)}`;
      await this.audit.write({
        ruleId: rule.ruleId, sourceType: rule.sourceType, channel: rule.channelType,
        tenantId: rule.tenantId, sourceRef: event.sourceRef ?? null, recordId: event.recordId ?? 0,
        status: "invalid_body", lineMessage: why,
        latencyMs: Date.now() - startedAt, messageText: text,
        audit: { eventLabel: event.eventLabel, eventType: event.eventType ?? null, ...(event.diagnostics ?? {}) },
      });
      this.logger.warn(`全欄位取不到值 · 不送出 · rule=${rule.ruleId} · ${why}`);
      return { status: "invalid_body", lineMessage: why };
    }

    // 4) send（管道可插拔 · Phase 1 支援 LINE 群/私訊）
    if (rule.channelType !== "line_group" && rule.channelType !== "line_user") {
      this.logger.warn(`管道尚未支援：${rule.channelType}（rule=${rule.ruleId}）`);
      return { status: "unsupported_channel" };
    }
    // 取 token 的優先序 —— 前兩層是正解，第三層是待拆的過渡
    //   ① rule.botId：規則明確指定用哪支 bot 發（0061 起，精靈強制選）
    //   ② rule.tenantId：⚠️ 猜「該租戶最新建立的 bot」· 只給 0061 之前的舊規則用
    //   ③ env：⚠️ 全域單一 token · 2026-08-12 鮮湧事故的成因（拿甲的 token 推乙的群）
    // 資料補完（所有規則都有 botId）後，②③ 應一併刪除 —— 見
    // docs/modules/notify-bot-scoped-target.md §7 OQ-NBT-5 / §8 M4
    let token: string | null = null;
    if (rule.botId) {
      token = await withSystemTx((tx) => this.rules.getLineTokenForBot(tx, rule.botId as string));
      if (!token) {
        this.logger.warn(`規則指定的 bot 取不到 token（已停用？）· rule=${rule.ruleId} bot=${rule.botId}`);
      }
    } else if (rule.tenantId) {
      token = await withSystemTx((tx) => this.rules.getLineTokenForTenant(tx, rule.tenantId as string));
      this.logger.warn(
        `⚠️ 規則未指定 bot · 退回「該租戶最新建立的 bot」（猜的）· rule=${rule.ruleId} tenant=${rule.tenantId}`
        + " · 請到通知設定重新選擇要用哪支機器人發送",
      );
    } else {
      this.logger.warn(
        `⚠️ 規則既無 bot 也無租戶 · 退回全域 env token（猜的）· rule=${rule.ruleId}`
        + " · 這是 2026-08-12 鮮湧推送失敗的成因，請到通知設定補上機器人",
      );
    }
    // line_group → channel_target 即 groupId；line_user → channel_target 為本系統 user_id，需解析成 LINE userId
    let to = rule.channelTarget ?? "";
    if (rule.channelType === "line_user" && to) {
      const lineUserId = await withSystemTx((tx) => this.rules.resolveLineUserId(tx, to));
      if (!lineUserId) {
        await this.audit.write({
          ruleId: rule.ruleId, sourceType: rule.sourceType, channel: rule.channelType,
          tenantId: rule.tenantId, sourceRef: event.sourceRef ?? null, recordId: event.recordId ?? 0,
          status: "line_failed", lineStatus: 0, lineMessage: "通知對象尚未綁定 LINE",
          latencyMs: Date.now() - startedAt, messageText: text,
        });
        return { status: "line_failed", lineStatus: 0, lineMessage: "通知對象尚未綁定 LINE" };
      }
      to = lineUserId;
    }
    const res = await this.line.pushText(token ?? process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "", to, text);

    // 5) audit
    await this.audit.write({
      ruleId: rule.ruleId, sourceType: rule.sourceType, channel: rule.channelType,
      tenantId: rule.tenantId, sourceRef: event.sourceRef ?? null, recordId: event.recordId ?? 0,
      status: res.ok ? "sent" : "line_failed",
      lineStatus: res.ok ? undefined : res.status,
      lineMessage: res.ok ? undefined : res.message,
      latencyMs: Date.now() - startedAt,
      messageText: text,
      audit: { eventLabel: event.eventLabel, eventType: event.eventType ?? null, ...(event.diagnostics ?? {}) },
    });

    if (res.ok) return { status: "sent" };
    this.logger.warn(`推送失敗 · rule=${rule.ruleId} ch=${rule.channelType} status=${res.status} msg=${res.message}`);
    return { status: "line_failed", lineStatus: res.status, lineMessage: res.message };
  }

  /** internal_event 分派：找出所有訂閱該事件的規則並逐一投遞 */
  async dispatchInternal(event: NotificationEvent): Promise<DeliverResult[]> {
    if (!event.eventType) return [];
    const matched = await withSystemTx((tx) =>
      this.rules.listEnabledForEvent(tx, event.eventType as string, event.tenantId),
    );
    const out: DeliverResult[] = [];
    for (const rule of matched) {
      try {
        out.push(await this.deliver(rule, event));
      } catch (e) {
        this.logger.warn(`投遞失敗 · rule=${rule.ruleId} · ${(e as Error).message}`);
      }
    }
    return out;
  }
}

// dedup cache 介面吃 number；把字串 key 轉成穩定數值
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}
