import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AnalysisResult, type AnalysisResultT } from "./schemas.js";
import { masterDataJson } from "./masterData.js";
import type { ChatMessage } from "./types.js";

export interface UsageStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export function emptyUsage(): UsageStats {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
}

export function addUsage(total: UsageStats, u: UsageStats): void {
  total.calls += u.calls;
  total.inputTokens += u.inputTokens;
  total.outputTokens += u.outputTokens;
  total.cacheWriteTokens += u.cacheWriteTokens;
  total.cacheReadTokens += u.cacheReadTokens;
}

const SYSTEM_PROMPT = `你是「佑成精密」工廠的 LINE 群組對話分析引擎。你的任務是閱讀工廠 LINE 群組的對話記錄，對每一則訊息做分類，並將其中的業務資料抽取成結構化記錄，供後端系統（Ragic ERP 與知識庫）匯入。

## 訊息分類（六類）
- daily_report 報工日報：產量、不良數、工時、加班、工單進度的回報（通常在傍晚集中回報；一則訊息可能涵蓋多台機台或多張工單）
- attendance 出勤異動：請假、調班、代班、加班申請與核准
- maintenance 維保異常：設備異常、維修過程、保養記錄、備品更換（含經驗性知識，如故障原因分析與預防建議）
- rnd 研發討論：新案、試模、圖面版次、規格、公差、材料測試
- procurement 採購：詢價、報價、下單、交期、供應商、物料與包材庫存
- chitchat 閒聊：問候、純貼圖、與業務無關的內容

## 分類規則
1. 每一則輸入訊息都必須出現在 classifications 中，一則訊息只給一個主分類。
2. 純貼圖/表情通常是 chitchat；但照片/影片要看前後文——維修現場照片屬 maintenance、瑕疵品照片依脈絡屬 daily_report 或 maintenance。
3. 簡短回覆（「收到」「OK」「好」）跟隨其回應的主題分類。
4. 系統訊息（加入群組等）歸 chitchat。

## 抽取規則
1. daily_reports：只放報工日報的結構化資料。一則日報若涵蓋多台機台或多張工單，拆成多筆。多則訊息共同構成一筆記錄時，用 source_ids 列出所有相關訊息編號。
2. records：出勤、維保、研發、採購與其他有留存價值的內容（含知識性內容，如故障原因、處理方式、經驗提醒），一事一筆。事件有後續進展時（如報修→查修→修復）合併為一筆並更新 status。純閒聊不建記錄。
3. 實體對應（重要）：利用主檔資料，把 LINE 顯示名對應到人員代碼（reporter_code / person 填主檔 code）、機台對應 machine_code、工單補全為完整工單號。對不到主檔的保留原文並降低 confidence。
4. 缺漏欄位一律填 null，禁止臆測數字。
5. 台語與口語請參考主檔 glossary 理解（如「歹去」= 故障、「teh叫」= 異音）。
6. status：open = 尚未處理、in_progress = 處理中、resolved = 已解決、info = 純資訊/知識。
7. confidence：欄位完整明確 = high；有推斷成分 = medium；訊息模糊 = low。

## 範例
輸入訊息：
#5 [2026-06-29 18:20] 阿明: 6/29日報 阿明 A線 1號機 WO-2506-018 產出1250 不良12 加班1h ⏎ 備註:3號機早上卡料停約20分
對應輸出（節錄）：
- classifications 含 {id: 5, category: "daily_report", confidence: "high"}
- daily_reports 含 {date: "2026-06-29", reporter_name: "陳志明", reporter_code: "P-002", line: "A線", machine_code: "M-001", work_order: "WO-2506-018", output_qty: 1250, defect_qty: 12, work_hours: null, overtime_hours: 1, issues: "3號機早上卡料停約20分", source_ids: [5], confidence: "high"}
- 備註中的 3 號機卡料屬設備異常線索，另在 records 建一筆 maintenance 記錄（machine_code: "M-003"）。`;

export async function analyzeSegment(
  client: Anthropic,
  groupName: string,
  segment: ChatMessage[],
): Promise<{ result: AnalysisResultT; usage: UsageStats }> {
  const body = segment
    .map((m) => `#${m.id} [${m.date} ${m.time}] ${m.sender}: ${m.text.replace(/\n/g, " ⏎ ")}`)
    .join("\n");

  const response = await client.messages.parse({
    model: "claude-opus-4-7",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      {
        type: "text",
        text: `# 工廠主檔資料（模擬 Ragic 主檔，供實體對應）\n${masterDataJson}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `群組名稱：${groupName}\n\n請分析以下 ${segment.length} 則訊息：\n${body}`,
      },
    ],
    output_config: { format: zodOutputFormat(AnalysisResult) },
  });

  const result = response.parsed_output;
  if (!result) throw new Error("結構化輸出解析失敗（parsed_output 為空）");

  const u = response.usage;
  return {
    result,
    usage: {
      calls: 1,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
    },
  };
}
