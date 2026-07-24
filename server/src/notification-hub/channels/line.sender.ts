import { Injectable, Logger } from "@nestjs/common";

// 統一 LINE 推送 sender（收斂 notify/LineClient 與 line-ingest/LineApiClient 的重複）
// 關鍵：LINE push API 的 `to` 同時接受 groupId 與 userId → line_group / line_user 共用同一實作。
// 5 秒 timeout · 不 retry（沿用 notify v1/v2 裁定 OQ-NOT-4 A）
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const TIMEOUT_MS = 5000;

export type SendResult =
  | { ok: true; requestId?: string }
  | { ok: false; status: number; message: string };

@Injectable()
export class LineSender {
  private readonly logger = new Logger(LineSender.name);
  private fetchImpl: typeof fetch = fetch;

  /** 僅測試用 */
  setFetchImpl(fn: typeof fetch): void {
    this.fetchImpl = fn;
  }

  async pushText(token: string, to: string, text: string): Promise<SendResult> {
    if (!token) return { ok: false, status: 0, message: "LINE token 為空（該租戶未設 bot？）" };
    if (!to) return { ok: false, status: 0, message: "通知對象為空" };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(LINE_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
        signal: ctrl.signal,
      });
      const requestId = res.headers.get("x-line-request-id") ?? undefined;
      if (res.ok) return { ok: true, requestId };
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) message = `${message}: ${body.message}`;
      } catch { /* 非 JSON body */ }
      return { ok: false, status: res.status, message };
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name === "AbortError") return { ok: false, status: 0, message: `timeout after ${TIMEOUT_MS}ms` };
      return { ok: false, status: 0, message: `network: ${err?.message ?? String(e)}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
