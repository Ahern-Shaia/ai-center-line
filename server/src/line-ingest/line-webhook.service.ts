import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withSystemTx, type Db } from "../db/client.js";
import { LineBotRepository } from "./line-bot.repository.js";
import { LineGroupRepository } from "./line-group.repository.js";
import { LineMessageRepository } from "./line-message.repository.js";
import { MediaDownloadService } from "./media-download.service.js";
import { MemberFetchService } from "./member-fetch.service.js";
import { LineApiClient } from "./line-api.client.js";
import { EmployeeBindingService } from "../employee-binding/employee-binding.service.js";

interface BotWithSecret {
  botId: string;
  tenantId: string;
  channelSecret: string;
  channelAccessToken: string;
  status: string;
}

// LINE webhook payload · 依 https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects
interface LineWebhookEvent {
  type: string;                                    // "message" | "join" | "leave" | "memberJoined" | "follow" | "unfollow" | ...
  timestamp: number;                               // event 發生時間 (ms epoch)
  replyToken?: string;                             // 0016 · reply token (message/follow event 才有)
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
    private readonly bindingService: EmployeeBindingService,
    private readonly lineApi: LineApiClient,
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

      // 處理 events · 群組 + 1-on-1 都處理
      for (const event of payload.events!) {
        const groupId = event.source?.groupId;

        // 1-on-1 handling (0016 · employee-line-binding + personal-daily-report 需要)
        if (!groupId) {
          await this.handleDirectEvent(tx, bot, event);
          continue;
        }

        try {
          const upsert = await this.groupRepo.upsertOnEvent(tx, {
            botId: bot.botId,
            groupId,
            eventTimestampMs: event.timestamp,
            eventType: event.type,
            rawEvent: event as unknown as Record<string, unknown>,
          });
          if (upsert.isNew) {
            this.logger.log(`[line-webhook] 新群偵測 · botId=${bot.botId} · groupId=${groupId} · type=${event.type}`);
            // fire-and-forget auto-probe display_name · 免 tenant_admin 手動去 aiproot 「LINE 機器人」點 probe
            void this.autoProbeGroupName(bot.channelAccessToken, bot.botId, groupId);
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

          // 0016 · 若 sender 已綁定 · 落庫時就對到 aiproot user (資料快照)
          const senderUid = event.source?.userId;
          const senderUserId = senderUid
            ? await this.bindingService.resolveUserByLineUserId(bot.botId, senderUid)
            : null;

          const { inserted } = await this.messageRepo.insertOnEvent(tx, {
            messageId: msg.id,
            tenantId: ref.tenantId,
            botId: bot.botId,
            groupId,
            departmentId: ref.departmentId,
            senderLineId: senderUid ?? null,
            senderUserId,                                 // 0016 · null 若未綁定
            chatContext: "group",
            messageType: msg.type,
            textContent,
            stickerRef,
            sentAtMs: event.timestamp,
            rawEvent: event as unknown as Record<string, unknown>,
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

  /**
   * 1-on-1 事件處理 · 0016 · employee-line-binding + personal-daily-report
   * · follow event · Alice 加 bot 好友 → bot 推 LIFF link (若 env 設 LIFF_URL)
   * · message event · Alice 私訊 bot → 依 binding 對到 user · 落庫 chat_context='personal'
   */
  private async handleDirectEvent(tx: Db, bot: BotWithSecret, event: LineWebhookEvent): Promise<void> {
    const userId = event.source?.userId;
    if (!userId) return;

    // follow event · Alice 加好友
    if (event.type === "follow") {
      const liffUrl = process.env.LIFF_URL;
      if (liffUrl && event.replyToken) {
        try {
          const url = `${liffUrl}?botId=${bot.botId}`;
          await this.lineApi.replyMessage(bot.channelAccessToken, event.replyToken, [
            { type: "text", text: "歡迎加入！請點下方按鈕完成綁定 · 綁定後即可使用個人日報功能" },
            {
              type: "template",
              altText: "完成綁定",
              template: {
                type: "buttons",
                text: "點按鈕開始綁定",
                actions: [{ type: "uri", label: "開始綁定", uri: url }],
              },
            },
          ]);
          this.logger.log(`[line-webhook] follow · pushed LIFF · botId=${bot.botId} · userId=${userId.slice(-6)}`);
        } catch (err) {
          this.logger.error(`follow reply 失敗 · ${(err as Error).message}`);
        }
      }
      return;
    }

    // 1-on-1 message · 個人日報素材
    if (event.type === "message" && event.message?.type === "text") {
      // 查 binding · 若未綁定 · bot reply「請先綁定」(OQ-PDR-8)
      const senderUserId = await this.bindingService.resolveUserByLineUserId(bot.botId, userId);
      const msg = event.message;
      const textContent = typeof msg.text === "string" ? truncate(msg.text, 5000) : null;

      if (!senderUserId) {
        // 未綁定 · bot 提示
        if (event.replyToken) {
          try {
            const liffUrl = process.env.LIFF_URL;
            const hint = liffUrl
              ? `請先完成綁定才能記錄個人日報\n${liffUrl}?botId=${bot.botId}`
              : "請先完成綁定才能記錄個人日報 · 聯繫公司資訊窗口";
            await this.lineApi.replyMessage(bot.channelAccessToken, event.replyToken, [
              { type: "text", text: hint },
            ]);
          } catch (err) {
            this.logger.warn(`unbound reply 失敗 · ${(err as Error).message}`);
          }
        }
        return;
      }

      // v2 · 「設密碼」關鍵字 · bot 推設密碼 LIFF 按鈕 (Option C · 選配)
      // 3 頁共用同一 LIFF endpoint (binding.html) · 用 ?page=set-password 切 view
      if (textContent && isSetPasswordKeyword(textContent)) {
        if (event.replyToken) {
          const url = buildLiffUrl(bot.botId, "set-password");
          try {
            await this.lineApi.replyMessage(bot.channelAccessToken, event.replyToken, [
              {
                type: "template",
                altText: "設定登入密碼",
                template: {
                  type: "buttons",
                  text: "設密碼後 · 可用 email 登入 aiproot 網頁\n(選配 · 不設也可用「以 LINE 登入」)",
                  actions: [{ type: "uri", label: "設定密碼", uri: url }],
                },
              },
            ]);
            this.logger.log(`[line-webhook] set-password keyword · pushed LIFF · user=${userId.slice(-6)}`);
          } catch (err) {
            this.logger.warn(`set-password reply 失敗 · ${(err as Error).message}`);
          }
        }
        return;
      }

      // v2 · 關鍵字觸發：Alice 打「日報」/「看日報」/「我的日報」/「daily」 → bot 推「我的日報」LIFF 按鈕
      // 不落庫此訊息 (是指令 · 非工作記錄)
      // 3 頁共用同一 LIFF endpoint (binding.html) · 用 ?page=mine 切 view
      if (textContent && isDailyReportKeyword(textContent)) {
        if (event.replyToken) {
          const url = buildLiffUrl(bot.botId, "mine");
          try {
            await this.lineApi.replyMessage(bot.channelAccessToken, event.replyToken, [
              {
                type: "template",
                altText: "查看我的日報",
                template: {
                  type: "buttons",
                  text: "點按鈕看今日 AI 整理的日報 · 可編輯後送出主管",
                  actions: [{ type: "uri", label: "查看我的日報", uri: url }],
                },
              },
            ]);
            this.logger.log(`[line-webhook] daily-report keyword · pushed LIFF · user=${userId.slice(-6)}`);
          } catch (err) {
            this.logger.warn(`daily-report reply 失敗 · ${(err as Error).message}`);
          }
        }
        return;
      }

      // 已綁定 · 落庫 chat_context='personal'
      try {
        await this.messageRepo.insertOnEvent(tx, {
          messageId: msg.id,
          tenantId: bot.tenantId,
          botId: bot.botId,
          groupId: `__personal__${userId}`,              // 佔位 · 因 group_id NOT NULL · 用 __personal__ 前綴標記
          departmentId: null,
          senderLineId: userId,
          senderUserId,
          chatContext: "personal",
          messageType: msg.type,
          textContent,
          stickerRef: null,
          sentAtMs: event.timestamp,
          rawEvent: event as unknown as Record<string, unknown>,
        });

        // bot 輕回應 · 讓 Alice 知道已收到 · 首則額外提示可用「日報」查
        if (event.replyToken) {
          try {
            await this.lineApi.replyMessage(bot.channelAccessToken, event.replyToken, [
              { type: "text", text: "✓ 已記錄\n\n下班前 17:30 自動整理成日報 · 或隨時傳「日報」二字查看" },
            ]);
          } catch (err) {
            this.logger.warn(`personal msg ack reply 失敗 · ${(err as Error).message}`);
          }
        }
      } catch (err) {
        this.logger.error(`落個人訊息失敗 · messageId=${msg.id} · ${(err as Error).message}`);
      }
    }
  }

  /**
   * Fire-and-forget · 新群偵測時自動呼 LINE API 拉群名 · UPDATE line_group.display_name
   * · 失敗只 log · 不影響 webhook 處理
   * · 用 withSystemTx 獨立 tx (fire-and-forget 跳出 webhook 的 tenant tx)
   */
  private async autoProbeGroupName(accessToken: string, botId: string, groupId: string): Promise<void> {
    try {
      const summary = await this.lineApi.getGroupSummary(accessToken, groupId);
      if (!summary?.groupName) return;
      await withSystemTx((tx) => this.groupRepo.updateDisplayName(tx, {
        botId, groupId, displayName: summary.groupName,
      }));
      this.logger.log(`[line-webhook] auto-probed display_name · groupId=${groupId} · name=${summary.groupName}`);
    } catch (err) {
      this.logger.warn(`[line-webhook] auto-probe display_name 失敗 · groupId=${groupId} · ${(err as Error).message}`);
    }
  }
}

// 建 LIFF button URL · 3 個 view (binding / set-password / mine) 共用同一 endpoint
// 若 LIFF_URL 是 liff.line.me/{liffId} · 直接 append query
// 若 LIFF_URL 是 Web URL (含 .html) · 也直接 append query
// 若無 LIFF_URL env · fallback 到 demo web URL
function buildLiffUrl(botId: string, page: "binding" | "set-password" | "mine"): string {
  const base = process.env.LIFF_URL ?? "https://ai-center-line-demo.onrender.com/liff/binding.html";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}botId=${botId}&page=${page}`;
}

// 判斷是否為「查日報」關鍵字 · 支援中英 · 前後空白容錯
function isDailyReportKeyword(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === "日報" || t === "我的日報" || t === "看日報" || t === "查日報"
    || t === "daily" || t === "daily report" || t === "報告" || t === "查看";
}

// 「設密碼」關鍵字 · Option C · 觸發設密碼 LIFF 頁
function isSetPasswordKeyword(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === "設密碼" || t === "設定密碼" || t === "密碼" || t === "改密碼"
    || t === "set password" || t === "password";
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
