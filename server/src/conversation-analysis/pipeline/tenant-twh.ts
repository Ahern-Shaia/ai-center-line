// Tenant TWH（台灣福祉科技）· masterData + systemPrompt
// ⚠️ Backend self-contained copy — keep in sync with ../../../../../src/masterData.taiwanhomecare.ts
// 人名皆為假名（姓＋○○）· pilot demo/regression 用

export interface Tenant {
  systemPrompt: string;
  masterDataJson: string;
}

const taiwanHomecareMasterData = {
  company: "台灣福祉科技股份有限公司",
  stations: [
    { code: "ST-01", name: "升降機／機構工位", scope: "輪椅升降機、尾門機構、鋼索" },
    { code: "ST-02", name: "電路／電系改裝工位", scope: "車輛電路、控制、燈號" },
    { code: "ST-03", name: "車體焊接／鈑金工位", scope: "殼件、斜坡板、結構補強" },
    { code: "ST-04", name: "塗裝工位", scope: "車體噴漆、防鏽" },
    { code: "ST-05", name: "沐浴設備／熱水模組工位", scope: "到宅沐浴車給排水、熱水模組" },
    { code: "ST-06", name: "內裝／無障礙固定工位", scope: "扶手、安全固定帶、無障礙內裝" },
  ],
  persons: [
    { code: "P-01", line_name: "組長-阿豪", full_name: "洪○○", role: "改裝組長" },
    { code: "P-02", line_name: "阿源", full_name: "王○○", role: "升降機／機構技師（ST-01）" },
    { code: "P-03", line_name: "阿賢", full_name: "林○○", role: "水電／沐浴設備技師（ST-02/ST-05）" },
    { code: "P-04", line_name: "小凱", full_name: "陳○○", role: "車體／內裝技師（ST-03/ST-06）" },
    { code: "P-05", line_name: "阿仁", full_name: "張○○", role: "試車／交車前檢驗" },
    { code: "P-06", line_name: "美惠", full_name: "黃○○", role: "塗裝／品檢（ST-04）" },
    { code: "P-07", line_name: "廠長", full_name: "周○○", role: "廠長" },
    { code: "P-08", line_name: "研發-家豪", full_name: "劉○○", role: "研發工程師（法規／技術）" },
    { code: "P-09", line_name: "採購-淑惠", full_name: "蔡○○", role: "採購專員" },
    { code: "P-10", line_name: "業務-建國", full_name: "李○○", role: "業務專員" },
  ],
  vehicles: [
    { plate: "示範車號 A", model: "復康巴士 Delica", note: "售後維修（升降機鋼索）" },
    { plate: "復康巴士 B", model: "STARIA 高頂", note: "改裝中，對應 CV-2507-01" },
  ],
  work_orders: [
    { no: "CV-2507-01", product: "復康巴士（STARIA 高頂，輪椅升降＋安全固定帶）", customer: "某長照機構", status: "改裝中" },
    { no: "CV-2507-02", product: "到宅沐浴車（熱水模組＋給排水）", customer: "某居家照護單位", status: "改裝中" },
    { no: "CV-2506-18", product: "福祉車（CADDY MAXI 升降尾門＋扶手）", customer: "個人客戶", status: "交車前檢驗" },
  ],
  glossary: {
    "尾門機／升降機": "輪椅升降機（升降平台）",
    "坡板／斜坡": "斜坡板",
    "綁帶／固定帶": "輪椅安全固定帶",
    "高頂": "高頂車體改裝",
    "沐浴車": "到宅沐浴車",
    "水路／水管": "沐浴車給排水管路",
    "鍋爐／熱水": "熱水模組",
    "無障礙": "無障礙改裝",
    "鋼索": "升降機鋼索",
    "歹去": "壞掉、故障",
    "teh叫／咧叫": "發出異音",
    "頂": "代班、支援",
    "喬": "協調、安排",
  },
};

const SYSTEM_PROMPT = `你是「台灣福祉科技」（福祉車／復康巴士改裝廠，合格改裝廠）的 LINE 群組對話分析引擎。你的任務是閱讀工廠 LINE 群組的對話記錄，對每一則訊息做分類，並將其中的業務資料抽取成結構化記錄，供後端系統（Ragic ERP 與知識庫）匯入。

## 訊息分類（六類）
- daily_report 改裝報工日報：車輛改裝進度、施作項目、工時、完工回報（通常在傍晚集中回報；一則訊息可能涵蓋多台車或多個工位）
- attendance 出勤異動：請假、調班、代班、加班申請與核准
- maintenance 維保異常：車輛售後報修、設備／工具異常、維修保養過程、備品更換（含經驗性知識，如故障原因分析與預防建議）
- rnd 研發討論：新車型改裝規格、法規（消防安全、長照、福祉車檢驗）、圖面版次、材料與技術測試
- procurement 採購：零件詢價、報價、下單、交期、供應商、物料庫存（升降機／鋼索／熱水模組等）
- chitchat 閒聊：問候、純貼圖、與業務無關的內容

## 分類規則
1. 每一則輸入訊息都必須出現在 classifications 中，一則訊息只給一個主分類。
2. 純貼圖/表情通常是 chitchat；但照片/影片要看前後文——維修/改裝現場照片屬 maintenance 或 daily_report、瑕疵回報依脈絡分類。
3. 簡短回覆（「收到」「OK」「好」）跟隨其回應的主題分類。
4. 系統訊息（加入群組等）歸 chitchat。

## 抽取規則
1. daily_reports：只放改裝報工日報的結構化資料。一則日報若涵蓋多台車或多個工位，拆成多筆。多則訊息共同構成一筆記錄時，用 source_ids 列出所有相關訊息編號。
2. records：出勤、維保、研發、採購與其他有留存價值的內容（含知識性內容，如故障原因、處理方式、經驗提醒），一事一筆。事件有後續進展時（如報修→查修→修復）合併為一筆並更新 status。純閒聊不建記錄。
3. 實體對應（重要）：利用主檔資料，把 LINE 顯示名對應到人員代碼（reporter_code / person 填主檔 code）、施作工位對應 machine_code（工位站碼 ST-xx）、改裝案或維修補全 work_order（改裝案號 CV-xxxx 或車號）。對不到主檔的保留原文並降低 confidence。
4. 缺漏欄位一律填 null，禁止臆測數字。改裝情境通常沒有產量/不良數，output_qty 與 defect_qty 無明確數字時一律填 null。
5. 口語請參考主檔 glossary 理解（如「尾門機」= 輪椅升降機、「坡板」= 斜坡板）。
6. status：open = 尚未處理、in_progress = 處理中、resolved = 已解決、info = 純資訊/知識。
7. confidence：欄位完整明確 = high；有推斷成分 = medium；訊息模糊 = low。

## 範例
輸入訊息：
#3 [2026-07-02 18:20] 阿源: 7/2改裝日報 阿源 示範車號A 輪椅升降機水平調校2.5h、斜坡板焊接1.5h ⏎ 備註:鋼索已換標準件 平台恢復正常
對應輸出（節錄）：
- classifications 含 {id: 3, category: "daily_report", confidence: "high"}
- daily_reports 含 {date: "2026-07-02", reporter_name: "王○○", reporter_code: "P-02", line: null, machine_code: "ST-01", work_order: "示範車號 A", output_qty: null, defect_qty: null, work_hours: 2.5, overtime_hours: null, issues: "另斜坡板焊接1.5h；鋼索已換標準件、平台恢復正常", source_ids: [3], confidence: "high"}
- 斜坡板焊接屬車體/焊接工位，可另拆一筆 daily_report（machine_code: "ST-03", work_hours: 1.5）。備註中「鋼索已換」屬升降機維修，另在 records 建一筆 maintenance 記錄（machine_code: "ST-01"）。`;

export const TWH_TENANT: Tenant = {
  systemPrompt: SYSTEM_PROMPT,
  masterDataJson: JSON.stringify(taiwanHomecareMasterData, null, 2),
};
