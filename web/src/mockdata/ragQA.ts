// Level 2 RAG demo — 5 對預錄 Q&A（沿用合夥人 mockup 2 對 + 補 3 對）。
// 純前端 mock；正式版走 /rag/query，回傳同 shape。

export interface Citation {
  id: number;            // [1] [2]
  kind: "ticket" | "km" | "message" | "external";
  ref: string;           // 顯示用短碼：WO-2506-041 / KM #0142 / 群組 07/02 11:05
  title: string;         // 標題
  source: string;        // 來自哪個部門/系統
  snippet: string;       // hover / drawer 內文摘要
}

export interface RagQA {
  category: "查資料" | "查法規" | "找人" | "統計" | "技術諮詢";
  question: string;
  answerParts: (string | { citeId: number })[];  // 混排：純字串 + citation 標記
  citations: Citation[];
  followup?: string;
}

export const RAG_QA: RagQA[] = [
  {
    category: "查資料",
    question: "彰化那台復康巴士 ABC-1234，升降機保養紀錄查一下？",
    answerParts: [
      "該車輛升降機於 2026-06-18 完成鋼索更換，使用標準規格件",
      { citeId: 1 },
      "。保養週期建議每 3 個月檢查液壓油與鋼索張力一次",
      { citeId: 2 },
      "。",
    ],
    citations: [
      {
        id: 1, kind: "ticket", ref: "WO-2506-041", title: "示範車號 A · 升降機鋼索更換工單",
        source: "售後服務群組",
        snippet: "2026-06-18 完工 · 更換件：標準鋼索 x1 · 技師：阿源 · 症狀：斷裂/平台卡住 → 更換後試升降 OK",
      },
      {
        id: 2, kind: "km", ref: "KM #0089", title: "升降機保養規範 v2",
        source: "技術研發群組",
        snippet: "液壓油：每 3 個月 / 5000 km 檢查；鋼索張力：每 3 個月檢查；異音、卡頓：立即停用回廠。",
      },
    ],
    followup: "需要我一併列出同款升降機近三個月的異常紀錄嗎？",
  },
  {
    category: "查法規",
    question: "到宅沐浴車鍋爐改裝，法規那次調整是誰確認的？",
    answerParts: [
      "研發-家豪於技術研發群組回報：因應消防安全法規第 11 條，高壓閥位置向上調整 15 公分，以維持標準出水壓力",
      { citeId: 1 },
      "。此決策已同步工研院 RAG",
      { citeId: 2 },
      "。",
    ],
    citations: [
      {
        id: 1, kind: "km", ref: "KM #0142", title: "消防法規對應 · 高壓閥位置調整",
        source: "技術研發群組（研發-家豪 於 07/02 17:30 建立）",
        snippet: "法規：消防安全法規第 11 條 · 動作：高壓閥向上調 15 公分 · 影響：本批到宅沐浴車全數需調整。",
      },
      {
        id: 2, kind: "external", ref: "ITRI RAG · 消防安全對應庫",
        title: "法規對應同步 · 已核可",
        source: "工研院 RAG（外部）",
        snippet: "本案已納入工研院產發署補助計畫的法規對應資料庫，供跨案場沿用。",
      },
    ],
  },
  {
    category: "找人",
    question: "STARIA 高頂那個標案現在誰在跟？",
    answerParts: [
      "業務-建國於 07/02 11:05 回覆某長照機構關於復康巴士 STARIA 高頂交期",
      { citeId: 1 },
      "，並於同日下午提報 2 台估價單",
      { citeId: 2 },
      "。組長-阿豪 已排 07/04 帶客戶看 B 案交車。負責跟進：業務-建國。",
    ],
    citations: [
      {
        id: 1, kind: "message", ref: "業務一部 07/02 11:05", title: "客戶意向詢問",
        source: "業務一部群組",
        snippet: "某長照機構問復康巴士 STARIA 高頂交期 我回月底 —— 業務-建國",
      },
      {
        id: 2, kind: "ticket", ref: "T-030", title: "某長照機構 · STARIA 高頂 ×2 意向",
        source: "業務一部群組（已同步 CRM_opportunities）",
        snippet: "客戶：某長照機構 · 車型：復康巴士 STARIA 高頂 · 數量：2 台 · 交期：月底 · 業務：建國",
      },
    ],
    followup: "要不要看業務-建國近 7 天的所有客戶追蹤清單？",
  },
  {
    category: "統計",
    question: "7 月改裝日報總工時多少？",
    answerParts: [
      "截至 2026-07-03，改裝群（D1 技術工程）已產出 4 筆報工日報，其中 2 筆高信心已簽核、2 筆中信心待人工複核。已確認工時合計 7.0h",
      { citeId: 1 },
      "；另有 2 筆推估工時（陳○○ ~2h、張○○ 未填）待簽核後併入",
      { citeId: 2 },
      "。",
    ],
    citations: [
      {
        id: 1, kind: "ticket", ref: "T-001, T-002", title: "已簽核 · 高信心",
        source: "技術工程群組",
        snippet: "T-001 王○○ 4.0h（升降機水平調校 2.5 + 斜坡板焊接 1.5）· T-002 林○○ 3.0h（水電整合）· 合計 7.0h",
      },
      {
        id: 2, kind: "ticket", ref: "T-003, T-004", title: "待簽核 · 中信心",
        source: "技術工程群組",
        snippet: "T-003 陳○○ ~2.0h（工時填「大概」）· T-004 張○○ 未填工時（含「順便看了下 B 案」需歸類）",
      },
    ],
  },
  {
    category: "技術諮詢",
    question: "CADDY MAXI 扶手鎖點高度可以再低 3cm 嗎？",
    answerParts: [
      "可以，但研發-家豪於 07/02 提醒：固定帶錨點需一併下移，避免固定不牢",
      { citeId: 1 },
      "。詳細規範見技術 KM 固定帶安全篇",
      { citeId: 2 },
      "。",
    ],
    citations: [
      {
        id: 1, kind: "message", ref: "改裝群 07/02 10:23-10:30", title: "扶手高度與錨點聯動",
        source: "台灣福祉-改裝報工群",
        snippet: "小凱：這台福祉車 CADDY MAXI 扶手鎖點 客戶要高度再低 3 公分可以嗎 → 研發-家豪：可以 但固定帶錨點要跟著移 我畫個圖給你",
      },
      {
        id: 2, kind: "km", ref: "KM #0089-3", title: "固定帶安全規範",
        source: "技術研發群組",
        snippet: "扶手位置變動 > 2cm 時，固定帶錨點必須同步調整並經強度複驗；標準複驗流程見附錄 A。",
      },
    ],
    followup: "要不要一併調出這批 CADDY MAXI 車已改裝的規格對照？",
  },
];
