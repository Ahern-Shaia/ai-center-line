import { Injectable, Logger } from "@nestjs/common";

// LINE Messaging API Push Message wrapper（stateless；per-tenant config 由 caller 傳入）。
// 對應 docs/modules/notify-multi-tenant.md §5.1（M2 stateless 改造）+ notify.md §7-bis.3。
// 5 秒 timeout、不 retry（OQ-NOT-4 A）。
// 不再讀 process.env — token/groupId 由 tenant registry 提供，避免走錯租戶。
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const TIMEOUT_MS = 5000;

export interface LineTargetConfig {
  token: string;
  groupId: string;
}

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

  async pushText(cfg: LineTargetConfig, text: string): Promise<LinePushResult> {
    if (!cfg.token) return { ok: false, status: 0, message: "tenant token 為空" };
    if (!cfg.groupId) return { ok: false, status: 0, message: "tenant groupId 為空" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(LINE_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.token}`,
        },
        body: JSON.stringify({
          to: cfg.groupId,
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
