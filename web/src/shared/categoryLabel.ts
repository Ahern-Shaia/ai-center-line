// AI 抽取分類鍵 → 中文顯示（中文優先鐵則 · 單一來源避免各視圖走鐘）
// 分類集合對應 server schemas.ts；未知鍵 fallback 原值（不吞資料）
export const CATEGORY_LABEL: Record<string, string> = {
  daily_report: "報工日報",
  maintenance: "維保異常",
  attendance: "出勤異動",
  rnd: "研發討論",
  procurement: "採購",
  sales: "業務",             // 對客戶／我方收錢方向（tenant-twh 分類軸「錢的方向」）
  it_support: "資訊支援",     // 帳號權限／電腦設備／系統操作（NAS／ERP／Ragic）
  meeting: "會議記錄",        // 會議產出的協調事項 · **有主題就歸主題**（分類規則 7）
  facility_management: "廠區設施",  // 廠房與場地本身 · 不是車輛也不是產線設備（分類規則 8）
  chitchat: "閒聊",
};

/**
 * 分類顯示名。
 * 優先序：① 客戶在「任務設定→分類詞庫」自訂的名字（category_registry.category_name）
 *        ② 內建中文對照表　③ 原始 slug（不吞資料）
 *
 * ⚠️ registryName 等於 slug 時視為「還沒命名」而非自訂 —— 註冊時預設就是塞 slug，
 *    若直接採用會讓 AI 新產生的分類在畫面上顯示英文（違反 UI 中文優先鐵則）。
 */
export const catLabel = (c: string, registryName?: string | null): string => {
  if (registryName && registryName !== c) return registryName;
  const known = CATEGORY_LABEL[c];
  if (known) return known;
  // ⚠️ 最後一道：**不要把英文 slug 印給客戶**（UI 中文優先鐵則）。
  //    2026-08-24 台灣福祉畫面上出現 production_meeting / document_control /
  //    facility_management —— 根因在後端 prompt（已修），但那只對之後的分析生效，
  //    已經存下來的 ticket.category 仍是英文。這裡把它變成看得懂的字。
  //    中文的分類名照原樣顯示（AI 現在會直接命名中文）。
  return /^[a-z0-9_-]+$/i.test(c) ? `其他（${c.replace(/_/g, " ")}）` : c;
};
