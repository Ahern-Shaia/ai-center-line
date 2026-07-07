import { Injectable, Logger } from "@nestjs/common";

// LINE Messaging API Push Message wrapper。
// 對應 docs/modules/notify.md §4.1、§7-bis.3（5 秒 timeout、不 retry — OQ-NOT-4 A）。
// 只讀 env：Channel Access Token / Group ID 都不接受從 body 覆蓋（避免變跳板）。
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const TIMEOUT_MS = 5000;

export type LinePushResult =
  | { ok: true; requestId?: string }
  | { ok: false; status: number; message: string };

@Injectable()
export class LineClient {
  private readonly logger = new Logger(LineClient.name);
  // fetch 走欄位注入（DI 不看 constructor param 的 function type）；測試用 setFetchImpl 換
  private fetchImpl: typeof fetch = fetch;

  constructor() {}

  /** 僅測試用 */
  setFetchImpl(fn: typeof fetch): void {
    this.fetchImpl = fn;
  }

  async pushText(text: string): Promise<LinePushResult> {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const groupId = process.env.LINE_GROUP_ID_BUSINESS_ASSIST;
    if (!token) return { ok: false, status: 0, message: "env LINE_CHANNEL_ACCESS_TOKEN 未設定" };
    if (!groupId) return { ok: false, status: 0, message: "env LINE_GROUP_ID_BUSINESS_ASSIST 未設定" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(LINE_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: groupId,
          messages: [{ type: "text", text }],
        }),
        signal: controller.signal,
      });
      const requestId = res.headers.get("x-line-request-id") ?? undefined;
      if (res.ok) return { ok: true, requestId };
      // LINE 4xx/5xx：不 retry（OQ-NOT-4 A）；body 可能含 JSON error details
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) message = `${message}: ${body.message}`;
      } catch {
        // 忽略非 JSON body
      }
      return { ok: false, status: res.status, message };
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name === "AbortError") {
        return { ok: false, status: 0, message: `timeout after ${TIMEOUT_MS}ms` };
      }
      return { ok: false, status: 0, message: `network: ${err?.message ?? String(e)}` };
    } finally {
      clearTimeout(timeout);
    }
  }
}
