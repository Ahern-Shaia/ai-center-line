import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withSystemTx } from "../db/client.js";
import { LineBotRepository } from "./line-bot.repository.js";
import { LineGroupRepository } from "./line-group.repository.js";

// LINE webhook payload · 依 https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects
interface LineWebhookPayload {
  destination?: string;                            // bot user ID (Uxxx) - webhook 收件方 bot 識別
  events?: Array<{
    type: string;                                  // "message" | "join" | "leave" | "memberJoined" | ...
    timestamp: number;                             // event 發生時間 (ms epoch)
    source?: {
      type: string;                                // "user" | "group" | "room"
      groupId?: string;                            // Cxxx (group only)
      userId?: string;
      roomId?: string;
    };
    [key: string]: unknown;
  }>;
}

@Injectable()
export class LineWebhookService {
  private readonly logger = new Logger(LineWebhookService.name);

  constructor(
    private readonly botRepo: LineBotRepository,
    private readonly groupRepo: LineGroupRepository,
  ) {}

  // 主入口 · rawBody 用於 HMAC 驗證 · payload 解析後可 access destination + events
  async processWebhook(rawBody: string, signature: string): Promise<void> {
    let payload: LineWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as LineWebhookPayload;
    } catch (err) {
      this.logger.warn(`webhook body 非合法 JSON · ${(err as Error).message}`);
      return;
    }
    const destination = payload.destination;
    if (!destination) {
      this.logger.warn("webhook 缺 destination · 忽略");
      return;
    }
    if (!payload.events || payload.events.length === 0) {
      // LINE 有時送 verify webhook 沒 events · 200 快回即可
      return;
    }

    // 找 bot + secret 驗簽 · 在 system tx 內執行避免 RLS 阻擋
    await withSystemTx(async (tx) => {
      const bot = await this.botRepo.getByBotUserIdWithSecret(tx, destination);
      if (!bot) {
        this.logger.warn(`webhook destination 不對應任何 bot · destination=${destination}`);
        return;
      }

      // HMAC-SHA256(rawBody, channel_secret) · timing-safe compare
      const expected = createHmac("sha256", bot.channelSecret).update(rawBody).digest("base64");
      const sigBuf = safeBufFromB64(signature);
      const expBuf = Buffer.from(expected, "base64");
      if (!sigBuf || sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        this.logger.warn(`webhook 驗簽失敗 · botId=${bot.botId} · destination=${destination}`);
        return;                                    // 不拋錯 · 靜默 log · 不讓 attacker 探邊
      }

      // 首次驗簽成功 · 標記 webhook_verified_at
      await this.botRepo.markWebhookVerified(tx, bot.botId);

      // 處理 events · 只關心 group 事件
      for (const event of payload.events!) {
        const groupId = event.source?.groupId;
        if (!groupId) continue;                    // 1-1 chat 或 room · 本輪不處理
        try {
          const upsert = await this.groupRepo.upsertOnEvent(tx, {
            botId: bot.botId,
            groupId,
            eventTimestampMs: event.timestamp,
            eventType: event.type,
            rawEvent: event as Record<string, unknown>,
          });
          if (upsert.isNew) {
            this.logger.log(`[line-webhook] 新群偵測 · botId=${bot.botId} · groupId=${groupId} · type=${event.type}`);
          }
        } catch (err) {
          this.logger.error(`upsert line_group 失敗 · groupId=${groupId} · ${(err as Error).message}`);
        }
      }
    });
  }
}

function safeBufFromB64(b64: string | undefined): Buffer | null {
  if (!b64) return null;
  try {
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}
