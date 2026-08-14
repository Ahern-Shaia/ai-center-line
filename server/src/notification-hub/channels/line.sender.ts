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
      const message = `HTTP ${res.status}: ${await describeLineError(res)}`;
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

/**
 * 把 LINE 的錯誤 body 講成看得懂的原因。
 *
 * ⚠️ LINE 的 400 幾乎都長這樣，**真正的原因在 details[] 裡**：
 *   { "message": "Failed to send messages",
 *     "details": [ { "message": "...", "property": "..." } ] }
 * 舊版只取 body.message，於是使用者永遠只看到「Failed to send messages」——
 * 那句話等於沒說（2026-08-12 鮮湧報價單推送失敗，查了半天才發現原因被吞掉）。
 *
 * 另外附上常見成因的提示：400 + 目標是群組時，最常見是 **bot 已不在該群**
 * （我方的 line_group.status 只在收到 leave 事件時才更新，可能是舊的）。
 */
export async function describeLineError(res: Response): Promise<string> {
  let body: LineErrorBody | null = null;
  try {
    body = (await res.json()) as LineErrorBody;
  } catch {
    const text = await res.text().catch(() => "");
    return text.slice(0, 200) || "（LINE 未回傳內容）";
  }
  // 429 有兩種，靠 body 文字分辨：打太快 vs 當月推播則數用完。
  // 後者直接把英文原句丟給使用者等於沒講 —— 看的人不會知道那是 LINE 的方案額度、
  // 更不會知道 1 號才會恢復，也不會知道這支帳號的**所有**通知都會一起停。
  if (res.status === 429 && /monthly limit/i.test(body?.message ?? "")) {
    return "LINE 官方帳號本月推播則數已用完 · 這支帳號的所有通知都會失敗，每月 1 日重置"
      + " · 要提前恢復需到 LINE Official Account Manager 升級方案"
      + "（免費方案每月額度很小，一次 Ragic 批次修改就可能用完）";
  }
  const parts: string[] = [];
  if (body?.message) parts.push(body.message);
  for (const d of body?.details ?? []) {
    parts.push(d.property ? `${d.property} → ${d.message ?? ""}` : (d.message ?? ""));
  }
  if (parts.length === 0) parts.push("（LINE 未說明原因）");
  if (res.status === 400 && !(body?.details?.length)) {
    parts.push("常見原因：機器人已不在該群組／該對象未加好友 · 請確認機器人仍在群裡");
  }
  return parts.filter(Boolean).join(" · ");
}

interface LineErrorBody {
  message?: string;
  details?: Array<{ message?: string; property?: string }>;
}
