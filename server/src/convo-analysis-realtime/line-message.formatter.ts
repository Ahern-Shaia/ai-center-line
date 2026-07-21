// LINE 匯出格式 formatter · line_message row → parser.ts 認得的 zh-TW blob
// 對齊 src/parser.ts §HEADER_RE / DATE_RE / MSG_RE 三 pattern

export interface LineMessageRow {
  messageId: string;
  senderLineId: string | null;
  messageType: string;                   // 'text' | 'sticker' | 'image' | 'video' | 'audio' | 'file' | 'location'
  textContent: string | null;
  stickerRef: { packageId?: string; stickerId?: string } | null;
  sentAt: Date;
}

/**
 * 拼成 parser 認得的 LINE 匯出格式：
 *
 * ```
 * [LINE] <groupName> 的聊天記錄
 * 儲存日期：<datetime>
 *
 * 2026/07/21（一）
 * 上午10:30\t<sender>\t今天要維修A線
 * 下午2:15\t<sender>\t[照片]
 * ```
 */
export function formatAsLineExport(
  groupName: string,
  batchDate: string,             // "2026-07-21"
  messages: LineMessageRow[],
): string {
  const header = `[LINE] ${groupName} 的聊天記錄`;
  const saveDate = `儲存日期：${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
  const [y, m, d] = batchDate.split("-").map((s) => parseInt(s, 10));
  const dayLabel = weekdayCn(new Date(y, m - 1, d));
  const dateLine = `${y}/${m}/${d}（${dayLabel}）`;

  const lines: string[] = [];
  for (const msg of messages) {
    const time = fmtAmPm(msg.sentAt);
    const sender = pseudonymSender(msg.senderLineId);
    const text = renderText(msg);
    lines.push(`${time}\t${sender}\t${text}`);
  }

  return [header, saveDate, "", dateLine, ...lines].join("\n");
}

function fmtAmPm(d: Date): string {
  // 用 Asia/Taipei 時區顯示 (即 UTC+8) · LINE 匯出本身即 local time · 對齊客戶當地
  const utc8 = new Date(d.getTime() + 8 * 3600_000);
  const h = utc8.getUTCHours();
  const min = utc8.getUTCMinutes();
  const ampm = h < 12 ? "上午" : "下午";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${ampm}${h12}:${String(min).padStart(2, "0")}`;
}

function weekdayCn(d: Date): string {
  return "日一二三四五六"[d.getDay()];
}

// sender_line_id (Uxx...) 匿名化 · 只取後 6 位 · 對齊「不做 per-user 追蹤」設計原則
function pseudonymSender(lineId: string | null): string {
  if (!lineId) return "(未知)";
  const tail = lineId.slice(-6);
  return `成員_${tail}`;
}

function renderText(msg: LineMessageRow): string {
  switch (msg.messageType) {
    case "text":
      return msg.textContent ?? "";
    case "sticker":
      return "[貼圖]";
    case "image":
      return "[照片]";
    case "video":
      return "[影片]";
    case "audio":
      return "[語音訊息]";
    case "file":
      return "[檔案]";
    case "location":
      return "[位置訊息]";
    default:
      return `[${msg.messageType}]`;
  }
}
