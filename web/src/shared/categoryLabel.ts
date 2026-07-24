// AI 抽取分類鍵 → 中文顯示（中文優先鐵則 · 單一來源避免各視圖走鐘）
// 分類集合對應 server schemas.ts；未知鍵 fallback 原值（不吞資料）
export const CATEGORY_LABEL: Record<string, string> = {
  daily_report: "報工日報",
  maintenance: "維保異常",
  attendance: "出勤異動",
  rnd: "研發討論",
  procurement: "採購",
  chitchat: "閒聊",
};

export const catLabel = (c: string): string => CATEGORY_LABEL[c] ?? c;
