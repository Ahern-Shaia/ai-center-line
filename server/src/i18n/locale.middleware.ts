import { Injectable, NestMiddleware } from "@nestjs/common";
import { localeStore, parseAcceptLanguage } from "./locale.js";

/**
 * 把當前請求的語言放進 AsyncLocalStorage，讓任何一層的 `msg()` 都取得到。
 *
 * ⚠️⚠️ **這支必須是 middleware，不能是 interceptor。**
 *    NestJS 的順序是 middleware → **guard** → interceptor → pipe → handler。
 *    第一版寫成 interceptor，結果 `JwtAuthGuard` / `RolesGuard` / `PermissionGuard`
 *    丟出來的訊息（「缺少 Bearer token」「角色無權限」「沒有權限執行此操作」）
 *    全都落在 locale 上下文之外 —— 英文使用者照樣看到中文。
 *
 *    ⭐ 這件事**單元測試驗不到**（測試直接呼叫 `msg()`，沒有走 guard），
 *      是實際起服務打 `curl -H "accept-language: en" /warroom/tasks` 才看出來的。
 *
 * ⚠️ 不看 `req.user` —— 登入失敗、首次改密碼失敗這些最需要正確語言的情境
 *    根本還沒有 user，而且 middleware 階段 guard 也還沒跑。
 */
@Injectable()
export class LocaleMiddleware implements NestMiddleware {
  use(req: { headers?: Record<string, string | string[] | undefined> }, _res: unknown, next: () => void): void {
    const raw = req?.headers?.["accept-language"];
    const locale = parseAcceptLanguage(Array.isArray(raw) ? raw[0] : raw);
    localeStore.run(locale, next);
  }
}
