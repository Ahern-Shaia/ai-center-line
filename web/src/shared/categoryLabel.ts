import { t, hasKey } from "../i18n";

// AI 抽取分類鍵 → 中文顯示（中文優先鐵則 · 單一來源避免各視圖走鐘）
// 分類集合對應 server schemas.ts；未知鍵 fallback 原值（不吞資料）
// ⚠️ 2026-08-26 i18n：文字搬進 i18n/*.ts（key = `category.<slug>`）· API 不變
/**
 * 分類顯示名。
 * 優先序：① 客戶在「任務設定→分類詞庫」自訂的名字（category_registry.category_name）
 *        ② i18n 的內建對照　③ 「其他（slug）」
 *
 * ⚠️ registryName 等於 slug 時視為「還沒命名」而非自訂 —— 註冊時預設就是塞 slug，
 *    若直接採用會讓 AI 新產生的分類在畫面上顯示英文（違反 UI 中文優先鐵則）。
 *
 * ⚠️ 客戶自訂名**不翻譯** —— 那是客戶自己打的字，不是我們的文案。
 */
export const catLabel = (c: string, registryName?: string | null): string => {
  if (registryName && registryName !== c) return registryName;
  if (hasKey(`category.${c}`, "zh-TW")) return t(`category.${c}`);
  // ⚠️ 最後一道：**不要把英文 slug 原樣印給客戶**（UI 中文優先鐵則）。
  //    2026-08-24 台灣福祉畫面上出現 production_meeting / document_control ——
  //    根因在後端 prompt（已修）＋內建分類缺項（已補 meeting / facility_management），
  //    但已經存下來的 ticket.category 仍可能是沒收編的英文。這裡把它變成看得懂的字。
  return /^[a-z0-9_-]+$/i.test(c) ? t("category.unknown", { name: c.replace(/_/g, " ") }) : c;
};
