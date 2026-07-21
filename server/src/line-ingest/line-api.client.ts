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
}
