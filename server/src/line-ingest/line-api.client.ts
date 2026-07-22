import { Injectable, Logger } from "@nestjs/common";

// LINE Messaging API client · 用於 test-call 驗證 access token · 拉 group summary / bot info
// 只做 M1 需要的兩支 endpoint · Phase 2 擴 push message 等

export interface LineBotInfo {
  userId: string;                    // Uxxx bot user ID (webhook destination lookup 用)
  basicId: string;                   // @xxxxxx display friendly id
  displayName: string;
  premiumId?: string;
  pictureUrl?: string;
  chatMode: string;                  // "chat" | "bot"
  markAsReadMode: string;
}

export interface LineGroupSummary {
  groupId: string;
  groupName: string;
  pictureUrl?: string;
}

@Injectable()
export class LineApiClient {
  private readonly logger = new Logger(LineApiClient.name);
  private readonly baseUrl = "https://api.line.me";

  // GET /v2/bot/info · 驗 access token 真實有效 · 拿 bot user ID
  async getBotInfo(accessToken: string): Promise<LineBotInfo> {
    const res = await fetch(`${this.baseUrl}/v2/bot/info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LINE getBotInfo failed · status=${res.status} · body=${body}`);
    }
    return (await res.json()) as LineBotInfo;
  }

  // GET /v2/bot/group/{groupId}/summary · 拉 group 名稱 · 可能失敗（bot 未加群 / 群不存在）
  async getGroupSummary(accessToken: string, groupId: string): Promise<LineGroupSummary | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/group/${encodeURIComponent(groupId)}/summary`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        this.logger.warn(`LINE getGroupSummary failed · groupId=${groupId} · status=${res.status}`);
        return null;
      }
      return (await res.json()) as LineGroupSummary;
    } catch (err) {
      this.logger.warn(`LINE getGroupSummary error · groupId=${groupId} · ${(err as Error).message}`);
      return null;
    }
  }

  // POST /v2/bot/message/reply · 用 replyToken 回覆訊息 (免費 · 不占 push quota)
  // 依 https://developers.line.biz/en/reference/messaging-api/#send-reply-message
  async replyMessage(accessToken: string, replyToken: string, messages: unknown[]): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v2/bot/message/reply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ replyToken, messages }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LINE replyMessage failed · status=${res.status} · body=${body.slice(0, 200)}`);
    }
  }

  // GET /v2/bot/group/{groupId}/member/{userId} · 拉群組成員 displayName + pictureUrl
  // 條件：bot 在群中 · user 已在群發過訊息 (webhook 收過 · 才有 userId)
  // 失敗回 { error } · 讓 caller 記 fetch_error (400=未 consent · 404=已退群 · 429=quota)
  async getGroupMemberProfile(accessToken: string, groupId: string, userId: string): Promise<{
    displayName: string;
    userId: string;
    pictureUrl?: string;
  } | { error: string }> {
    try {
      const res = await fetch(
        `${this.baseUrl}/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        this.logger.warn(`LINE getGroupMemberProfile failed · groupId=${groupId} · userId=${userId.slice(-6)} · status=${res.status}`);
        return { error: `HTTP ${res.status} ${errBody.slice(0, 100)}` };
      }
      return (await res.json()) as { displayName: string; userId: string; pictureUrl?: string };
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.warn(`LINE getGroupMemberProfile error · groupId=${groupId} · userId=${userId.slice(-6)} · ${msg}`);
      return { error: `fetch: ${msg}` };
    }
  }
}
