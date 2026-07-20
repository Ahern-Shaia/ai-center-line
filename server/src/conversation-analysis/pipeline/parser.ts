// LINE 匯出檔 parser（zh-TW · 12h 上午/下午 · 多行續行 · 媒體標記）
// ⚠️ Backend self-contained copy — keep in sync with ../../../../../src/parser.ts
// Pilot 階段複製 · 未來 SaaS 化統一到 shared package

export interface ChatMessage {
  id: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm 24 小時制
  sender: string;
  text: string;
  kind: "text" | "media" | "system";
}

export interface ParsedChat {
  groupName: string;
  messages: ChatMessage[];
}

const HEADER_RE = /^\[LINE\]\s*(.+?)\s*的聊天記錄$/;
const DATE_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:（[日一二三四五六]）)?$/;
const MSG_RE = /^(上午|下午)?(\d{1,2}):(\d{2})\t([^\t]+)\t(.*)$/;
const SYS_RE = /^(上午|下午)?(\d{1,2}):(\d{2})\t([^\t]+)$/;
const MEDIA_RE = /^\[(照片|圖片|貼圖|影片|檔案|語音訊息)\]$/;

function to24(ampm: string | undefined, hour: number): number {
  if (ampm === "上午") return hour === 12 ? 0 : hour;
  if (ampm === "下午") return hour === 12 ? 12 : hour + 12;
  return hour;
}

export function parseLineExport(raw: string): ParsedChat {
  const lines = raw.split(/\r?\n/);
  let groupName = "未命名群組";
  let currentDate = "";
  const messages: ChatMessage[] = [];
  let nextId = 0;

  for (const line of lines) {
    const header = line.match(HEADER_RE);
    if (header) {
      groupName = header[1];
      continue;
    }
    if (line.startsWith("儲存日期")) continue;

    const d = line.match(DATE_RE);
    if (d) {
      currentDate = `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
      continue;
    }

    const m = line.match(MSG_RE);
    if (m) {
      const hh = String(to24(m[1], parseInt(m[2], 10))).padStart(2, "0");
      const text = m[5];
      messages.push({
        id: nextId++,
        date: currentDate,
        time: `${hh}:${m[3]}`,
        sender: m[4],
        text,
        kind: MEDIA_RE.test(text.trim()) ? "media" : "text",
      });
      continue;
    }

    const s = line.match(SYS_RE);
    if (s) {
      const hh = String(to24(s[1], parseInt(s[2], 10))).padStart(2, "0");
      messages.push({
        id: nextId++,
        date: currentDate,
        time: `${hh}:${s[3]}`,
        sender: "(系統)",
        text: s[4],
        kind: "system",
      });
      continue;
    }

    if (line.trim() && messages.length > 0) {
      const last = messages[messages.length - 1];
      last.text += "\n" + line;
    }
  }

  return { groupName, messages };
}

/**
 * 以「天」為單位切分會話段。單日過長依 maxSize 切。
 */
export function segmentMessages(messages: ChatMessage[], maxSize = 60): ChatMessage[][] {
  const segments: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  let currentDate = "";

  for (const msg of messages) {
    if (current.length > 0 && (msg.date !== currentDate || current.length >= maxSize)) {
      segments.push(current);
      current = [];
    }
    current.push(msg);
    currentDate = msg.date;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}
