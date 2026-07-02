export interface ChatMessage {
  id: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm（24 小時制）
  sender: string;
  text: string;
  kind: "text" | "media" | "system";
}

export interface ParsedChat {
  groupName: string;
  messages: ChatMessage[];
}
