import { SetMetadata } from "@nestjs/common";

/**
 * 「任何登入者都可以用」—— **明示**這個端點刻意不限角色。
 *
 * ⚠️ 為什麼需要它：`RolesGuard` 從 fail-open 改成 fail-closed 之後，
 * 沒有宣告存取層級的端點會被拒絕。而確實有一批端點是**每個人都該能用**的
 * （打卡、改自己密碼、查自己權限）—— 那些要用這個裝飾器**說出來**。
 *
 * 差別在於「沒寫」與「刻意不限」不再長得一樣：
 * 忘記寫會在開發階段就炸，而不是安靜地放行到 prod。
 *
 * ⚠️ 用這個的端點必須**自己保證租戶邊界** ——
 * 一律走 `@CurrentUser()` 取 `tenant_id`，**不可**接受 client 傳 tenantId。
 */
export const ALLOW_ANY_USER_KEY = "allowAnyUser";
export const AllowAnyUser = () => SetMetadata(ALLOW_ANY_USER_KEY, true);
