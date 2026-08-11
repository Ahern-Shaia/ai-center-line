import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withSystemTx, type Db } from "../db/client.js";
import { schedulerTimeLabel } from "../scheduler-config/scheduler-time.js";
import { LineBotRepository } from "./line-bot.repository.js";
import { LineGroupRepository } from "./line-group.repository.js";
import { LineMessageRepository } from "./line-message.repository.js";
import { MediaDownloadService } from "./media-download.service.js";
import { MemberFetchService } from "./member-fetch.service.js";
import { CompletionSignalService } from "../task-completion/completion-signal.service.js";
import { OpenTaskReminderService } from "../task-completion/open-task-reminder.service.js";
import { PrivateCompletionService } from "../task-completion/private-completion.service.js";
import { LineApiClient } from "./line-api.client.js";
import { EmployeeBindingService } from "../employee-binding/employee-binding.service.js";

interface BotWithSecret {
  botId: string;
  tenantId: string;
  kind: string;                                    // "analysis" | "utility" · utility 只回群組 ID · 不落庫
  channelSecret: string;
  channelAccessToken: string;
  status: string;
  /** 0060 · 這支 bot 專屬的 LIFF（須與 messaging channel 同 provider）· null = 用 env 預設 */
  liffId: string | null;
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
    quotedMessageId?: string;                      // 0036 · 引用回覆指到的原訊息 —— 任務完成訊號的鑰匙
    [key: string]: unknown;
  };
  postback?: {
    data: string;                                  // 0046 · 「是哪一件做完了」按鈕帶回的 `done:<ticketId>`
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
  // 通用 ID bot 的降噪去重 · groupId → 最近一次回覆的 LINE event timestamp(ms)
  private readonly utilityLastReplyAt = new Map<string, number>();

  constructor(
    private readonly botRepo: LineBotRepository,
    private readonly groupRepo: LineGroupRepository,
    private readonly messageRepo: LineMessageRepository,
    private readonly mediaDownload: MediaDownloadService,
    private readonly memberFetch: MemberFetchService,
    private readonly bindingService: EmployeeBindingService,
    private readonly lineApi: LineApiClient,
    private readonly completionSignal: CompletionSignalService,
    private readonly openTaskReminder: OpenTaskReminderService,
    private readonly privateCompletion: PrivateCompletionService,
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
    // 0036 · 引用回覆的即時回饋 · 累到 tx 結束才送（reply token 在 tx 內送會拖住交易）
    const replyTasks: Array<{ replyToken: string; accessToken: string; text: string }> = [];
    // 0036 · M3.5 · 每日回報的未確認清單 · 查詢要在 tx 外做（tickets RLS 需 tenant 上下文）
    const reminderTasks: Array<{
      tenantId: string; groupId: string; senderLineUserId: string;
      text: string; replyToken: string; accessToken: string;
    }> = [];

    await withSystemTx(async (tx) => {
      const bot = await this.botRepo.getByBotUserIdWithSecret(tx, destination);
      if (!bot) {
        this.logger.warn(`webhook destination 不對應任何 bot · destination=${destination}`);
        return;
      }
      // 停用中的 bot 一樣不處理，但要跟「查無此 bot」分開講 ——
      // 兩者印同一句的話，排查時會往「密鑰／設定壞了」的方向找，實際上只是被停用。
      if (bot.status !== "active") {
        this.logger.warn(
          `webhook 收到事件但 bot 已停用 · 事件已丟棄 · botId=${bot.botId} status=${bot.status} destination=${destination}`,
        );
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

      // 通用 ID bot · 只回群組 ID · 完全不進 ingestion 主線（不落庫/不分析/不查租戶）
      // 對照 docs/modules/group-id-onboarding.md §4 · replyTasks 於 tx 結束後統一送
      if (bot.kind === "utility") {
        for (const event of payload.events!) {
          const gid = event.source?.groupId;
          if (!gid || !event.replyToken) continue;
          const isJoin = event.type === "join";
          const isKeyword =
            event.type === "message" &&
            event.message?.type === "text" &&
            isGroupIdKeyword(typeof event.message.text === "string" ? event.message.text : "");
          if (!isJoin && !isKeyword) continue;
          // 同群 30 秒內只回一次 · 降噪（best-effort · 依 LINE event timestamp 去重）
          if (!this.utilityShouldReply(gid, event.timestamp)) continue;
          replyTasks.push({
            replyToken: event.replyToken,
            accessToken: bot.channelAccessToken,
            text: buildGroupIdReply(gid, isJoin),
          });
        }
        return;                                    // 早退 · 跳過群組 upsert + 訊息落庫
      }

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

          // 0036 · M3a · 引用回覆 → 完成訊號（先落地，對應留給批次後回掃）
          // ⚠️ 只認 inserted：webhook 會重送，重複處理會重複回話洗版
          if (inserted && msg.type === "text" && msg.quotedMessageId && senderUid) {
            try {
              const r = await this.completionSignal.capture(tx, {
                tenantId: ref.tenantId,
                groupId,
                replyMessageId: msg.id,
                quotedMessageId: msg.quotedMessageId,
                replierLineUserId: senderUid,
                replierDisplayName: null,          // member profile 另有 cache · 這裡不擋
                text: textContent ?? "",
              });
              // 客戶把這個群的回話關掉了 —— 訊號照樣落地，只是 bot 不出聲（0040）
              if (r.reply && event.replyToken && ref.replyEnabled) {
                replyTasks.push({ replyToken: event.replyToken, accessToken: bot.channelAccessToken, text: r.reply });
              }
            } catch (err) {
              // 訊號沒收到不影響訊息本身已經落庫 —— 分析照跑，只是少一筆完成訊號
              this.logger.warn(`[completion] 訊號落地失敗 · messageId=${msg.id} · ${(err as Error).message}`);
            }
          }

          // 0036 · M3.5 · 他自己發的每日回報 → 回一份「尚未確認完成」清單
          // ⚠️ 這裡只收集，實際查詢在 tx 結束後做 ——
          //    要讀 tickets，而 tickets 的 RLS 在 systemTx 底下會靜默回 0 筆。
          if (inserted && msg.type === "text" && !msg.quotedMessageId && senderUid && event.replyToken
              && ref.replyEnabled) {
            reminderTasks.push({
              tenantId: ref.tenantId,
              groupId,
              senderLineUserId: senderUid,
              text: textContent ?? "",
              replyToken: event.replyToken,
              accessToken: bot.channelAccessToken,
            });
          }

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

    // M3.5 · tx 結束後才查（tickets 要 tenant 上下文）· 有清單才排回話
    for (const r of reminderTasks) {
      try {
        const text = await this.openTaskReminder.replyForDailyReport({
          tenantId: r.tenantId, groupId: r.groupId,
          senderLineUserId: r.senderLineUserId, text: r.text,
        });
        if (text) replyTasks.push({ replyToken: r.replyToken, accessToken: r.accessToken, text });
      } catch (err) {
        this.logger.warn(`[reminder] 清單失敗 · group=${r.groupId} · ${(err as Error).message}`);
      }
    }

    // Tx 結束才回話 · reply token 有時效但不長，先讓 tx 落定再送
    for (const r of replyTasks) {
      try {
        await this.lineApi.replyMessage(r.accessToken, r.replyToken, [{ type: "text", text: r.text }]);
      } catch (err) {
        // 回話失敗不影響訊號已經落地 —— 少回一句可以，訊號掉了不行
        this.logger.warn(`[completion] 回覆失敗 · ${(err as Error).message}`);
      }
    }

    // Tx 結束才 enqueue · 避免 in-flight tx 內做 fire-and-forget 邊界模糊
    for (const task of mediaTasks) {
      this.mediaDownload.enqueue(task);
    }
    for (const task of memberTasks) {
      this.memberFetch.enqueue(task);
    }
  }

  // 通用 ID bot · 同群 30 秒內只回一次（best-effort · 多實例各自去重，可接受）
  private utilityShouldReply(groupId: string, eventTsMs: number): boolean {
    const last = this.utilityLastReplyAt.get(groupId);
    if (last != null && eventTsMs - last < 30_000) return false;
    this.utilityLastReplyAt.set(groupId, eventTsMs);
    if (this.utilityLastReplyAt.size > 5000) this.utilityLastReplyAt.clear();  // 上限保護 · 避免無限長
    return true;
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
      if ((bot.liffId || process.env.LIFF_URL) && event.replyToken) {
        try {
          const url = this.liffUrlFor(bot, "binding");
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

    // 他點了「是哪一件做完了」的按鈕 —— 多張任務時的消歧義（private-completion.service.ts）
    if (event.type === "postback") {
      const data = event.postback?.data;
      if (!data || !event.replyToken) return;
      const uid = await this.bindingService.resolveUserByLineUserId(bot.botId, userId);
      if (!uid) return;                              // 未綁定不可能收到我們發的按鈕
      try {
        const reply = await this.privateCompletion.handlePostback({
          tenantId: bot.tenantId, userId: uid, lineUserId: userId, messageId: "", data,
        });
        if (reply) await this.lineApi.replyMessage(bot.channelAccessToken, event.replyToken, reply);
      } catch (err) {
        this.logger.warn(`[private-completion] postback 失敗 · data=${data} · ${(err as Error).message}`);
      }
      return;
    }

    // 1-on-1 message
    if (event.type === "message") {
      // 查 binding · 未綁定一律回綁定提示（不論訊息型別 · 貼圖/照片/文字皆可）
      // gap A · 原本只在 text 才回 · 藍領員工常先傳貼圖/照片 → 會收到沉默 · 此處補齊
      const senderUserId = await this.bindingService.resolveUserByLineUserId(bot.botId, userId);

      if (!senderUserId) {
        // 未綁定 · 不論型別回一次綁定提示 · 有 LIFF 給按鈕 · 無則 fallback 文字（比照 follow）
        if (event.replyToken) {
          const hasLiff = !!(bot.liffId || process.env.LIFF_URL);
          try {
            if (hasLiff) {
              await this.lineApi.replyMessage(bot.channelAccessToken, event.replyToken, [
                { type: "text", text: "看起來還沒完成綁定 · 點下方按鈕即可（綁定後才能記錄日報）" },
                {
                  type: "template",
                  altText: "完成綁定",
                  template: {
                    type: "buttons",
                    text: "點按鈕開始綁定",
                    actions: [{ type: "uri", label: "開始綁定", uri: this.liffUrlFor(bot, "binding") }],
                  },
                },
              ]);
            } else {
              await this.lineApi.replyMessage(bot.channelAccessToken, event.replyToken, [
                { type: "text", text: "請先完成綁定才能記錄個人日報 · 聯繫公司資訊窗口" },
              ]);
            }
          } catch (err) {
            this.logger.warn(`unbound reply 失敗 · ${(err as Error).message}`);
          }
        }
        return;
      }

      // 已綁定 · 以下只處理文字（關鍵字 / 落庫 / ack）· 非文字暫不處理
      const msg = event.message;
      if (!msg || msg.type !== "text") return;
      const textContent = typeof msg.text === "string" ? truncate(msg.text, 5000) : null;

      // v2 · 「設密碼」關鍵字 · bot 推設密碼 LIFF 按鈕 (Option C · 選配)
      // 3 頁共用同一 LIFF endpoint (binding.html) · 用 ?page=set-password 切 view
      if (textContent && isSetPasswordKeyword(textContent)) {
        if (event.replyToken) {
          const url = this.liffUrlFor(bot, "set-password");
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
          const url = this.liffUrlFor(bot, "mine");
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

        // 私訊裡的完成回報 —— 指派通知是私訊推的，他自然會在私訊回。
        // ⚠️ 這支自己開 tenant tx（不吃這裡的 systemTx）· 見 private-completion.service.ts 的說明。
        // 接住了就回它的話並 return，不再回下面那句「✓ 已記錄」（兩句都回等於自打嘴巴）。
        if (event.replyToken && textContent) {
          try {
            const reply = await this.privateCompletion.handleText({
              tenantId: bot.tenantId,
              userId: senderUserId,
              lineUserId: userId,
              text: textContent,
              messageId: msg.id,
              quotedMessageId: typeof msg.quotedMessageId === "string" ? msg.quotedMessageId : null,
            });
            if (reply) {
              await this.lineApi.replyMessage(bot.channelAccessToken, event.replyToken, reply);
              return;
            }
          } catch (err) {
            // 接不住不影響訊息已落庫 —— 掉回下面的 ack，至少他知道我們收到了
            this.logger.warn(`[private-completion] 失敗 · messageId=${msg.id} · ${(err as Error).message}`);
          }
        }

        // bot 輕回應 · 讓 Alice 知道已收到。
        //
        // 提示句只在**當天第一則**附上 —— 原本每則都附，使用者連傳五則就看到五次同一句，
        // 變成純噪音（2026-08-11 用戶回報）。註解本來就寫「首則額外提示」，只是沒實作。
        // 之後每則就只回「✓ 已記錄」。
        if (event.replyToken) {
          try {
            const isFirstToday = await this.messageRepo.isFirstPersonalMessageToday(tx, bot.botId, userId);
            let text = "✓ 已記錄";
            if (isFirstToday) {
              // ⚠️ 時間不可寫死 · 每家自己設（prod 實例：台灣福祉把批次改成 18:00）
              const at = await schedulerTimeLabel(tx, bot.tenantId, "pdr");
              const tail = at ? `${at} 由 AI 整理成日報` : "AI 會整理成日報";
              // 文案要誠實：訊息是「立刻記錄、立刻看得到」；AI 整理是另一件事
              text = `✓ 已記錄\n\n傳「日報」可隨時查看今日記錄 · ${tail}`;
            }
            await this.lineApi.replyMessage(bot.channelAccessToken, event.replyToken, [
              { type: "text", text },
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
  /**
   * 0060 · 取這支 bot 該用的 LIFF 連結。
   *
   * bot 沒設 liff_id 時退回 LIFF_URL env（既有客戶維持原行為），但**記 warn** ——
   * 因為若這支 bot 的 messaging channel 與 env 那支 LIFF 不同 provider，
   * 使用者會「綁定成功」卻永遠對不上，且沒有任何錯誤可循（OQ-LMP-2 裁定：fallback + 告警）。
   */
  private liffUrlFor(bot: BotWithSecret, page: "binding" | "set-password" | "mine"): string {
    if (!bot.liffId) {
      this.logger.warn(
        `[line-webhook] bot 未設 liff_id · 退回 LIFF_URL env · botId=${bot.botId} · `
        + "若此 bot 的 channel 與該 LIFF 不同 provider，綁定會寫入對不上的 line_user_id",
      );
    }
    return buildLiffUrl(bot, page);
  }

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
//
// 0060 · 為什麼要 per-bot（docs/modules/liff-multi-provider.md）：
//   LIFF 取得的 line_user_id 屬於「LIFF app 所掛的 Login channel」的 provider，
//   webhook 收到的屬於「messaging channel」的 provider。兩者不同 provider 時，
//   同一個人有兩組 ID，綁定寫進去的值永遠對不上 —— 而且綁定流程看起來是成功的。
//   所以 bot 有自己的 liffId 時一律優先用它。
//
// liffId 也一併帶進 query：前端 liff.init() 需要知道自己是哪一支 LIFF。
// 沒設 liffId 就退回 LIFF_URL env（既有客戶維持原行為），由呼叫端記 warn。
function buildLiffUrl(bot: { botId: string; liffId: string | null }, page: "binding" | "set-password" | "mine"): string {
  const base = bot.liffId
    ? `https://liff.line.me/${bot.liffId}`
    : (process.env.LIFF_URL ?? "https://ai-center-line-demo.onrender.com/liff/binding.html");
  const sep = base.includes("?") ? "&" : "?";
  const liffParam = bot.liffId ? `&liffId=${encodeURIComponent(bot.liffId)}` : "";
  return `${base}${sep}botId=${bot.botId}&page=${page}${liffParam}`;
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

// 通用 ID bot · 觸發關鍵字＝「群組ID」（M0 CLOSED OQ-GID-2）· 去空白、ID 部分大小寫不敏感
function isGroupIdKeyword(text: string): boolean {
  const t = text.trim().replace(/\s+/g, "").toLowerCase();
  return t === "群組id" || t === "群組ｉｄ";      // 半形 / 全形 ＩＤ 皆收
}

// 通用 ID bot 的回覆文案 · isJoin=加群歡迎（多帶引導）· 否則＝關鍵字再取一次（精簡）
function buildGroupIdReply(groupId: string, isJoin: boolean): string {
  if (isJoin) {
    return [
      "你好，我是 aiproot 的群組 ID 小幫手。",
      "本群組 ID：",
      groupId,
      "（複製上面這串，貼到 aiproot 後台的「LINE 群組」欄位即可）",
      "需要再看一次，在群裡打「群組ID」我就再回你。取得後可將我移除。",
    ].join("\n");
  }
  return [
    "本群組 ID：",
    groupId,
    "（複製後貼到 aiproot 後台的「LINE 群組」欄位）",
  ].join("\n");
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
