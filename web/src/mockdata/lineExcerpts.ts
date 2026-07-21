// Level 2 demo fixture — 每個 ticket 對應的原始 LINE 訊息 + AI 抽取欄位 + 信心度理由。
// 原始訊息取材自 samples/台灣福祉-改裝群.txt（已假名化），或以相同語彙補寫。
// R11 溯源鐵則：每筆 extracted 都要能反查回這些 raw 訊息。

export interface LineMessage {
  time: string;         // 顯示格式：07/02 09:40
  sender: string;       // LINE 群暱稱（工廠員工的公開暱稱，仍屬假名）
  text: string;
  kind?: "text" | "photo" | "video" | "sticker" | "audio";
}

export interface TicketExcerpt {
  ticketId: string;
  raw: LineMessage[];
  extracted: { field: string; value: string }[];
  confidenceReason: string;
  ragicTarget: string;   // 簽核後同步至的記錄類型（客戶可懂的中文，非內部 schema）
}

// 用 summary 字首當查表 key（各 entry 可用長度不一的字首）
// 因為 DB 內 ticket_id 為 UUID（seed 時 generated），但 summary 穩定。
// 找 EXCERPTS_BY_SUMMARY 裡任一「summary.startsWith(key)」的 key，避免固定字數導致對不上。
export function findExcerpt(summary: string): TicketExcerpt | undefined {
  for (const key of Object.keys(EXCERPTS_BY_SUMMARY)) {
    if (summary.startsWith(key)) return EXCERPTS_BY_SUMMARY[key];
  }
  return undefined;
}

export const EXCERPTS: Record<string, TicketExcerpt> = {
  "T-001": {
    ticketId: "T-001",
    raw: [
      { time: "07/02 17:55", sender: "組長-阿豪", text: "各位改裝日報記得交" },
      { time: "07/02 18:20", sender: "阿源", text: "7/2改裝日報 阿源 示範車號A 輪椅升降機水平調校2.5h、斜坡板焊接1.5h\n備註:鋼索已換標準件 平台恢復正常" },
    ],
    extracted: [
      { field: "工人", value: "王○○（LINE 暱稱：阿源 → 主檔 P-042）" },
      { field: "車號", value: "示範車號 A" },
      { field: "任務 1", value: "輪椅升降機水平調校 · 2.5h" },
      { field: "任務 2", value: "斜坡板焊接 · 1.5h" },
      { field: "總工時", value: "4.0h" },
      { field: "備註", value: "鋼索已換標準件，平台恢復正常" },
    ],
    confidenceReason: "格式完整（日期、姓名、車號、任務、工時、備註齊全）；工時明確標示；車號可對應主檔。",
    ragicTarget: "報工日報記錄 · 7/2 王○○",
  },
  "T-002": {
    ticketId: "T-002",
    raw: [
      { time: "07/02 18:32", sender: "阿賢", text: "日報 阿賢 到宅沐浴車CV-2507-02 水電整合3h 熱水模組配管" },
    ],
    extracted: [
      { field: "工人", value: "林○○（阿賢 → P-058）" },
      { field: "車號", value: "CV-2507-02（到宅沐浴車）" },
      { field: "任務", value: "水電整合（熱水模組配管）" },
      { field: "工時", value: "3.0h" },
    ],
    confidenceReason: "工時明確；車號、車型完整；任務描述具體。",
    ragicTarget: "報工日報記錄 · 7/2 林○○",
  },
  "T-003": {
    ticketId: "T-003",
    raw: [
      { time: "07/02 18:45", sender: "小凱", text: "日報 小凱 福祉車CV-2506-18 扶手安裝加無障礙固定 工時大概2h(沒記很清楚)" },
    ],
    extracted: [
      { field: "工人", value: "陳○○（小凱 → P-071）" },
      { field: "車號", value: "CV-2506-18（福祉車）" },
      { field: "任務", value: "扶手安裝 + 無障礙固定" },
      { field: "工時（推估）", value: "~2.0h ⚠ 原始為「大概」" },
    ],
    confidenceReason: "工時填「大概 2h」「沒記很清楚」，數值可信度下降；姓名、車號、任務清楚。→ 標中信心，需簽核確認。",
    ragicTarget: "報工日報記錄 · 7/2 陳○○（工時待確認）",
  },
  "T-004": {
    ticketId: "T-004",
    raw: [
      { time: "07/02 19:02", sender: "阿仁", text: "日報:阿仁 協助示範車號A試車 煞車跟升降都OK 順便看了下B案" },
    ],
    extracted: [
      { field: "工人", value: "張○○（阿仁 → P-089）" },
      { field: "主任務", value: "協助試車（示範車號 A）" },
      { field: "檢查項目", value: "煞車 ✓、升降 ✓" },
      { field: "順帶事項", value: "查看 B 案（未寫工時）" },
      { field: "總工時", value: "未填 ⚠" },
    ],
    confidenceReason: "無工時；「順便看了下 B 案」屬口語含糊描述，AI 無法判斷是否算獨立任務。→ 標中信心，需人工歸類。",
    ragicTarget: "報工日報記錄 · 7/2 張○○（歸類待確認）",
  },
  "T-010": {
    ticketId: "T-010",
    raw: [
      { time: "07/02 09:40", sender: "阿源", text: "示範車號A升降機報一下 鋼索斷裂確認 升降平台卡住 要換標準鋼索" },
      { time: "07/02 09:42", sender: "組長-阿豪", text: "OK 淑惠幫忙叫料" },
      { time: "07/02 09:50", sender: "採購-淑惠", text: "升降機標準鋼索我下單給原廠 交期2天" },
    ],
    extracted: [
      { field: "車號", value: "示範車號 A" },
      { field: "部位", value: "輪椅升降機 · 鋼索" },
      { field: "症狀", value: "鋼索斷裂 → 升降平台卡住" },
      { field: "處置", value: "更換標準鋼索" },
      { field: "採購", value: "採購-淑惠已下單原廠，交期 2 天" },
      { field: "工單建議", value: "→ 建立售後工單，通知採購備標準鋼索並指派技師" },
    ],
    confidenceReason: "三則訊息交叉佐證：症狀（斷裂/卡住）、處置（換鋼索）、後續（採購下單+交期）都明確。",
    ragicTarget: "客服工單記錄 · 示範車號 A / 鋼索更換",
  },
  "T-011": {
    ticketId: "T-011",
    raw: [
      { time: "07/03 15:15", sender: "客服-婷婷", text: "剛剛客戶打電話說門壞了 幫忙看" },
    ],
    extracted: [
      { field: "車號", value: "❌ 未辨識" },
      { field: "部位", value: "❌ 「門」未指定（滑門？後尾門？升降門？）" },
      { field: "症狀", value: "❌ 「壞了」未具體描述" },
    ],
    confidenceReason: "三個關鍵欄位（車號、部位、症狀）都無法從單一訊息還原；沒有前後文可交叉。→ 攔截，需回頭補資訊才可入 Ragic。",
    ragicTarget: "🛑 已即時攔截，尚未同步記錄",
  },
  "T-020": {
    ticketId: "T-020",
    raw: [
      { time: "07/03 08:31", sender: "美惠", text: "B案復康巴士殼件焊接完成 已進塗裝" },
      { time: "07/03 08:35", sender: "組長-阿豪", text: "好 塗裝顧一下溫度" },
    ],
    extracted: [
      { field: "批次", value: "B 案" },
      { field: "車型", value: "復康巴士" },
      { field: "上一工序", value: "殼件焊接（完成）" },
      { field: "當前工序", value: "進入塗裝" },
      { field: "叮嚀", value: "塗裝溫度需監控（組長交代）" },
    ],
    confidenceReason: "工序轉換明確；批次、車型、動作皆具體。",
    ragicTarget: "生產進度記錄 · B案 復康巴士 · 塗裝",
  },
  "T-021": {
    ticketId: "T-021",
    raw: [
      { time: "07/03 10:20", sender: "阿賢", text: "沐浴車熱水模組裝好了", kind: "video" },
      { time: "07/03 10:22", sender: "阿賢", text: "影片是試運轉 出水溫度正常" },
    ],
    extracted: [
      { field: "車型", value: "到宅沐浴車" },
      { field: "模組", value: "熱水模組（安裝完成）" },
      { field: "影像佐證", value: "試運轉影片（已存物件儲存）" },
      { field: "AI 影像判定", value: "出水溫度正常" },
    ],
    confidenceReason: "含影片佐證＋文字補充；狀態、車型、模組皆明確。",
    ragicTarget: "生產進度記錄 · 沐浴車 · 熱水模組完成",
  },
  "T-022": {
    ticketId: "T-022",
    raw: [
      { time: "07/03 14:05", sender: "阿義", text: "B線今天大概三百多台", kind: "audio" },
    ],
    extracted: [
      { field: "產線", value: "B 線" },
      { field: "日產能（推估）", value: "~320 台 ⚠ 音檔含雜訊，Whisper 對「三百多台」信心 0.71" },
      { field: "來源", value: "語音訊息（07/03 14:05）" },
    ],
    confidenceReason: "語音訊息，Whisper 辨識信心中等；「三百多台」屬模糊數字，需口頭複核。→ 標中信心，人工確認實際數字。",
    ragicTarget: "生產進度記錄 · B 線 產能（待確認）",
  },
  "T-030": {
    ticketId: "T-030",
    raw: [
      { time: "07/02 11:05", sender: "業務-建國", text: "某長照機構問復康巴士STARIA高頂交期 我回月底" },
      { time: "07/02 15:30", sender: "業務-建國", text: "對方要 STARIA 高頂 2 台 我報了估價單過去" },
    ],
    extracted: [
      { field: "客戶", value: "某長照機構" },
      { field: "車型", value: "復康巴士 STARIA 高頂" },
      { field: "數量", value: "2 台" },
      { field: "承諾交期", value: "月底" },
      { field: "業務進度", value: "已提報估價單" },
      { field: "負責", value: "業務-建國" },
    ],
    confidenceReason: "跨兩則訊息前後文一致；客戶、數量、車型、交期都對得起來。",
    ragicTarget: "客戶機會記錄 · 某長照機構 · STARIA×2",
  },
  "T-031": {
    ticketId: "T-031",
    raw: [
      { time: "07/03 14:10", sender: "業務-建國", text: "這是客戶手寫採購單 麻煩OCR一下 復康巴士配件補貨", kind: "photo" },
      { time: "07/03 14:15", sender: "採購-淑惠", text: "收到 我拆到採購子表" },
    ],
    extracted: [
      { field: "來源", value: "客戶手寫採購單（照片 OCR）" },
      { field: "品項", value: "復康巴士配件（安全帶扣具 ×3、輪椅固定帶 ×2、扶手墊片 ×6）" },
      { field: "處理狀態", value: "採購-淑惠已拆解到採購子表" },
    ],
    confidenceReason: "OCR 結果與人工複核一致；品項齊全；有後續動作訊息閉環。",
    ragicTarget: "採購單記錄 · 復康巴士配件補貨",
  },
  "T-060": {
    ticketId: "T-060",
    raw: [
      { time: "07/02 17:30", sender: "研發-家豪", text: "消防安全法規第11條 到宅沐浴車高壓閥位置要向上調15公分 這批都要改 我更新到技術文件" },
    ],
    extracted: [
      { field: "法規", value: "消防安全法規 第 11 條" },
      { field: "影響部件", value: "到宅沐浴車 · 高壓閥" },
      { field: "調整", value: "位置向上調 15 公分" },
      { field: "影響範圍", value: "本批全數需調整" },
      { field: "確認人", value: "研發-家豪" },
      { field: "已同步", value: "工研院 RAG（技術 KM #0142）" },
    ],
    confidenceReason: "法規條文明確、部件位置量化、決策者具名、已同步到 KM。",
    ragicTarget: "技術知識庫 · 消防法規對應 · 高壓閥調整",
  },
  "T-061": {
    ticketId: "T-061",
    raw: [
      { time: "07/03 19:05", sender: "研發-家豪", text: "升降機馬達選型 跟原廠討論完 高頂車體建議用大扭力款 摘要放技術KM" },
    ],
    extracted: [
      { field: "議題", value: "升降機馬達選型" },
      { field: "適用車型", value: "高頂車體" },
      { field: "建議款式", value: "大扭力款（未附具體型號 ⚠）" },
      { field: "依據", value: "與原廠討論" },
      { field: "儲存位置", value: "技術 KM" },
    ],
    confidenceReason: "「大扭力款」缺具體型號、扭力值、規格；決策方向明確但技術細節不完整。→ 標中信心，需補型號。",
    ragicTarget: "技術知識庫 · 升降機馬達 · 選型（待補型號）",
  },
};

// summary 前 12 字 → excerpt。summary 由 seed JSON 灌入，內容穩定；改 seed 時本表要同步。
const EXCERPTS_BY_SUMMARY: Record<string, TicketExcerpt> = {
  "王○○：輪椅升降機水平調校": EXCERPTS["T-001"],
  "林○○：到宅沐浴車水電整合 3": EXCERPTS["T-002"],
  "陳○○：福祉車扶手安裝，工時": EXCERPTS["T-003"],
  "張○○：協助試車，項目描述含": EXCERPTS["T-004"],
  "示範車號 A：輪椅升降機鋼索斷": EXCERPTS["T-010"],
  "「門壞了」— 車號與部位無法": EXCERPTS["T-011"],
  "復康巴士 B 批殼件焊接完成": EXCERPTS["T-020"],
  "到宅沐浴車 熱水模組安裝": EXCERPTS["T-021"],
  "語音回報產能，數字聽辨不確": EXCERPTS["T-022"],
  "某長照客戶 復康巴士 2 台採": EXCERPTS["T-030"],
  "福祉車配件補貨單，品項與數": EXCERPTS["T-031"],
  "因應消防安全法規第 11 條，": EXCERPTS["T-060"],
  "升降機馬達選型比較，含跨群": EXCERPTS["T-061"],
};

