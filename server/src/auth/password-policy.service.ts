import { BadRequestException, Injectable } from "@nestjs/common";

// Password policy · OQ-TP-2/3/4/5 全採建議
// 12+ · 大小寫 + 數字 + 符號四選三 · 90 天過期 · 5 筆歷史 · 5 次錯鎖 10 min
export const PASSWORD_POLICY = {
  MIN_LENGTH: 12,
  REQUIRED_CATEGORIES: 3,          // 大寫 · 小寫 · 數字 · 符號 四選三
  EXPIRE_DAYS: 90,
  HISTORY_KEEP: 5,
  MAX_FAILED_LOGINS: 5,
  LOCK_DURATION_MIN: 10,
} as const;

// 常見弱密碼（top 20 · 拒收）
const WEAK_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789",
  "qwerty", "qwerty123", "letmein", "welcome", "admin", "admin123",
  "root", "toor", "iloveyou", "monkey", "dragon", "sunshine",
  "princess", "football", "baseball",
]);

export interface PolicyContext {
  email?: string | null;
  displayName?: string | null;
}

@Injectable()
export class PasswordPolicyService {
  // 驗複雜度 · 違反則拋 BadRequest（訊息使用者友善）
  validate(password: string, ctx: PolicyContext = {}): void {
    const failures: string[] = [];

    if (password.length < PASSWORD_POLICY.MIN_LENGTH) {
      failures.push(`長度需 ≥ ${PASSWORD_POLICY.MIN_LENGTH} 字元（目前 ${password.length}）`);
    }

    const categories = this.countCategories(password);
    if (categories < PASSWORD_POLICY.REQUIRED_CATEGORIES) {
      failures.push(`需包含大寫、小寫、數字、符號 四選三（目前 ${categories} 類）`);
    }

    const lower = password.toLowerCase();
    if (WEAK_PASSWORDS.has(lower)) {
      failures.push("此密碼屬常見弱密碼 · 已被禁用");
    }

    if (ctx.email) {
      const emailPrefix = ctx.email.split("@")[0]?.toLowerCase();
      if (emailPrefix && emailPrefix.length >= 4 && lower.includes(emailPrefix)) {
        failures.push("密碼不可含 email 帳號部分");
      }
    }

    if (ctx.displayName) {
      const dn = ctx.displayName.toLowerCase();
      if (dn.length >= 4 && lower.includes(dn)) {
        failures.push("密碼不可含使用者顯示名稱");
      }
    }

    if (failures.length > 0) {
      throw new BadRequestException({
        status: "password_policy_violation",
        message: "密碼不符合安全政策",
        failures,
      });
    }
  }

  // 產強隨機密碼 · 給租戶開通用（M2 用）· 保證滿足 policy
  generateStrongPassword(length = 16): string {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";     // 排除 I O
    const lower = "abcdefghjkmnpqrstuvwxyz";      // 排除 i l o
    const digits = "23456789";                    // 排除 0 1
    const symbols = "!@#$%^&*-_=+";
    const all = upper + lower + digits + symbols;

    const pickFrom = (pool: string) => pool[Math.floor(Math.random() * pool.length)];

    // 保證四類各一個
    const required = [pickFrom(upper), pickFrom(lower), pickFrom(digits), pickFrom(symbols)];
    const rest = Array.from({ length: length - 4 }, () => pickFrom(all));
    const combined = [...required, ...rest];

    // Fisher-Yates shuffle
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }
    return combined.join("");
  }

  // 依 EXPIRE_DAYS 算下次過期時間
  computeExpiresAt(from: Date = new Date()): Date {
    const d = new Date(from);
    d.setDate(d.getDate() + PASSWORD_POLICY.EXPIRE_DAYS);
    return d;
  }

  // 是否已過期
  isExpired(passwordExpiresAt: Date | string | null): boolean {
    if (!passwordExpiresAt) return false;              // NULL = grandfathered
    return new Date(passwordExpiresAt).getTime() <= Date.now();
  }

  // 是否被鎖定
  isLocked(lockedUntil: Date | string | null): boolean {
    if (!lockedUntil) return false;
    return new Date(lockedUntil).getTime() > Date.now();
  }

  // 累加 failed_login_count · 若超過 MAX 則回 locked_until 時戳
  nextLockedUntil(newFailedCount: number): Date | null {
    if (newFailedCount < PASSWORD_POLICY.MAX_FAILED_LOGINS) return null;
    const d = new Date();
    d.setMinutes(d.getMinutes() + PASSWORD_POLICY.LOCK_DURATION_MIN);
    return d;
  }

  private countCategories(password: string): number {
    let count = 0;
    if (/[A-Z]/.test(password)) count++;
    if (/[a-z]/.test(password)) count++;
    if (/[0-9]/.test(password)) count++;
    if (/[^A-Za-z0-9]/.test(password)) count++;
    return count;
  }
}
