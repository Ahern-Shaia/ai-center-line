import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withSystemTx } from "../db/client.js";
import { LineBotRepository } from "./line-bot.repository.js";
import { LineGroupRepository } from "./line-group.repository.js";
import { LineMessageRepository } from "./line-message.repository.js";
import { MediaDownloadService } from "./media-download.service.js";
import { MemberFetchService } from "./member-fetch.service.js";

// LINE webhook payload · 依 https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects
interface LineWebhookEvent {
  type: string;                                    // "message" | "join" | "leave" | "memberJoined" | ...
  timestamp: number;                               // event 發生時間 (ms epoch)
  source?: {
    type: string;                                  // "user" | "group" | "room"
    groupId?: string;                              // Cxxx (group only)
    userId?: string;                               // Uxxx sender
    roomId?: string;
  };
  message?: {
    id: string;                                    // LINE messageId
    type: string;                                  // "text" | "image" | "video" | "audio" | "file" | "location" | "sticker"
    text?: string;                                 // text only
    fileName?: string;                             // file only
    packageId?: string;                            // sticker only
    stickerId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface LineWebhookPayload {
  destination?: string;
  events?: LineWebhookEvent[];
}

const MEDIA_MESSAGE_TYPES = new Set(["image", "video", "audio", "file"]);
const ALLOWED_MESSAGE_TYPES = new Set(["text", "sticker", "image", "video", "audio", "file", "location"]);

@Injectable()
export class LineWebhookService {
  private readonly logger = new Logger(LineWebhookService.name);

  constructor(
    private readonly botRepo: LineBotRepository,
    private readonly groupRepo: LineGroupRepository,
    private readonly messageRepo: LineMessageRepository,
    private readonly mediaDownload: MediaDownloadService,
    private readonly memberFetch: MemberFetchService,
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
    const mediaTasks: Array<{
      messageId: string;
      tenantId: string;
      mediaType: string;
      accessToken: string;
      originalFilename: string | null;
    }> = [];
    const memberTasks: Array<{
      tenantId: string;
      botId: string;
      groupId: string;
      userId: string;
      accessToken: string;
    }> = [];

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

        // A1 · 訊息落庫 · 只對已綁 tenant 的 group 落 · 未綁不落 (避免髒資料)
        if (event.type !== "message" || !event.message) continue;
        const msg = event.message;
        if (!ALLOWED_MESSAGE_TYPES.has(msg.type)) {
          this.logger.debug(`[line-webhook] 略過非支援 message type=${msg.type} · messageId=${msg.id}`);
          continue;
        }

        try {
          const ref = await this.groupRepo.getRefForMessage(tx, bot.botId, groupId);
          if (!ref?.tenantId) {
            this.logger.debug(`[line-webhook] group 未綁 tenant · 訊息不落 · groupId=${groupId} · messageId=${msg.id}`);
            continue;
          }

          const stickerRef = msg.type === "sticker"
            ? { packageId: msg.packageId, stickerId: msg.stickerId }
            : null;
          const textContent = msg.type === "text" ? truncate(msg.text ?? "", 5000) : null;

          const { inserted } = await this.messageRepo.insertOnEvent(tx, {
            messageId: msg.id,
            tenantId: ref.tenantId,
            botId: bot.botId,
            groupId,
            departmentId: ref.departmentId,
            senderLineId: event.source?.userId ?? null,
            messageType: msg.type,
            textContent,
            stickerRef,
            sentAtMs: event.timestamp,
            rawEvent: event as Record<string, unknown>,
          });

          if (inserted && MEDIA_MESSAGE_TYPES.has(msg.type)) {
            // A2 · 媒體下載 · 累到 tx 結束後 fire (LINE URL 有 24hr 時效 · 早點下越好)
            mediaTasks.push({
              messageId: msg.id,
              tenantId: ref.tenantId,
              mediaType: msg.type,
              accessToken: bot.channelAccessToken,
              originalFilename: typeof msg.fileName === "string" ? msg.fileName : null,
            });
          }

          // 拉 member profile (displayName) · dedup by cache · webhook 每則都試 · 已有就 skip API call
          const senderUid = event.source?.userId;
          if (senderUid) {
            memberTasks.push({
              tenantId: ref.tenantId,
              botId: bot.botId,
              groupId,
              userId: senderUid,
              accessToken: bot.channelAccessToken,
            });
          }
        } catch (err) {
          this.logger.error(`落訊息失敗 · messageId=${msg.id} · ${(err as Error).message}`);
        }
      }
    });

    // Tx 結束才 enqueue · 避免 in-flight tx 內做 fire-and-forget 邊界模糊
    for (const task of mediaTasks) {
      this.mediaDownload.enqueue(task);
    }
    for (const task of memberTasks) {
      this.memberFetch.enqueue(task);
    }
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

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
