// 模擬 Ragic 主檔資料。正式版由 Ragic API 拉取，作為抽取時的實體對應（grounding）依據。
export const masterData = {
  company: "佑成精密工業股份有限公司",
  lines: [
    { code: "LINE-A", name: "A線", machines: ["M-001", "M-002", "M-003"] },
    { code: "LINE-B", name: "B線", machines: ["M-004"] },
  ],
  machines: [
    { code: "M-001", name: "1號機", type: "射出成型機 200T", line: "A線" },
    { code: "M-002", name: "2號機", type: "射出成型機 200T", line: "A線" },
    { code: "M-003", name: "3號機", type: "射出成型機 150T", line: "A線" },
    { code: "M-004", name: "4號機", type: "射出成型機 350T", line: "B線" },
    { code: "M-005", name: "5號機", type: "射出成型機 450T", line: "獨立區" },
  ],
  persons: [
    { code: "P-001", line_name: "組長-志豪", full_name: "林志豪", role: "生產組長" },
    { code: "P-002", line_name: "阿明", full_name: "陳志明", role: "A線技術員（1號機/3號機）" },
    { code: "P-003", line_name: "小華", full_name: "王俊華", role: "A線技術員（2號機）" },
    { code: "P-004", line_name: "阿吉", full_name: "張家吉", role: "B線技術員（4號機）" },
    { code: "P-005", line_name: "阿宏", full_name: "李政宏", role: "技術員（輪班）" },
    { code: "P-006", line_name: "美玲", full_name: "黃美玲", role: "品檢員" },
    { code: "P-007", line_name: "維修-老周", full_name: "周金水", role: "維修技師" },
    { code: "P-008", line_name: "廠長", full_name: "吳國棟", role: "廠長" },
    { code: "P-009", line_name: "研發-建宏", full_name: "劉建宏", role: "研發工程師" },
    { code: "P-010", line_name: "採購-淑芬", full_name: "蔡淑芬", role: "採購專員" },
  ],
  work_orders: [
    { no: "WO-2506-018", product: "連接器外殼 CN-3020", customer: "宏達光電", status: "生產中" },
    { no: "WO-2506-022", product: "齒輪箱端蓋 GB-115", customer: "大眾機電", status: "生產中" },
    { no: "WO-2507-003", product: "齒輪箱外殼 GH-220（新案打樣）", customer: "昌隆工業", status: "打樣中" },
  ],
  // 工廠詞庫：台語/黑話 → 標準語意。每家工廠可累積自己的詞庫。
  glossary: {
    "歹去": "壞掉、故障",
    "teh叫/咧叫": "發出異音",
    "掛了/掛掉": "故障停機",
    "NG": "不良品",
    "全檢": "全數檢驗",
    "首件": "首件檢驗（換模或開線後第一件的品質確認）",
    "模仁": "模具內的成型核心零件",
    "頂": "代班、支援",
    "喬": "協調、安排",
    "試打/試產": "試模生產",
    "卡料": "進料卡住",
  },
};

export const masterDataJson = JSON.stringify(masterData, null, 2);
