import { z } from "zod";

/**
 * 介面語言 · 對齊 migration 0071 的 CHECK。
 *
 * ⚠️ 加語言時**三個地方要一起改**：這裡、0071 的 CHECK、web/src/i18n 的 LOCALES。
 *    只改一處的話：漏了 CHECK → 500；漏了這裡 → 400；漏了前端 → 選不到。
 */
export const LocaleSchema = z.object({
  locale: z.enum(["zh-TW", "en"]),
});
