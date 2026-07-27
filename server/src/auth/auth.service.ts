import { BadRequestException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { currentTx, withAuthLookup, withTenant } from "../db/client.js";
import { auditLog, users } from "../db/schema.js";
import type { JwtUser } from "./jwt-user.js";
import { PASSWORD_POLICY, PasswordPolicyService } from "./password-policy.service.js";
import { PasswordHistoryRepository } from "./password-history.repository.js";

export interface LoginResult {
  access_token: string;
  must_change_password: boolean;
  password_expires_at: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly policy: PasswordPolicyService,
    private readonly historyRepo: PasswordHistoryRepository,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const rows = await withAuthLookup((tx) =>
      tx.select().from(users).where(eq(users.email, email)).limit(1),
    );
    const user = rows[0];
    if (!user?.passwordHash) {
      // 不透露「該 email 是否存在」· 一律回一樣的錯
      throw new UnauthorizedException("帳號或密碼錯誤");
    }

    // 1) 鎖定 check
    if (this.policy.isLocked(user.lockedUntil)) {
      const remain = Math.ceil((new Date(user.lockedUntil!).getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(`帳號已鎖定 · 請 ${remain} 分鐘後再試`);
    }

    // 2) 密碼比對
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      // 累加失敗計數 · 達 MAX 則設鎖定時間
      const newFailedCount = user.failedLoginCount + 1;
      const newLockedUntil = this.policy.nextLockedUntil(newFailedCount);
      await withAuthLookup((tx) =>
        tx.update(users)
          .set({ failedLoginCount: newFailedCount, lockedUntil: newLockedUntil })
          .where(eq(users.userId, user.userId)),
      );
      await this.auditLogin(user, "denied");
      if (newLockedUntil) {
        throw new UnauthorizedException(
          `帳號連續錯誤 ${PASSWORD_POLICY.MAX_FAILED_LOGINS} 次已鎖定 · 請 ${PASSWORD_POLICY.LOCK_DURATION_MIN} 分鐘後再試`,
        );
      }
      throw new UnauthorizedException("帳號或密碼錯誤");
    }

    // 3) 密碼正確 · 過期 check（不擋登入 · 但 return must_change_password=true 讓前端強制改）
    const isExpired = this.policy.isExpired(user.passwordExpiresAt);
    const mustChangePassword = user.mustChangePassword || isExpired;

    // 4) reset failed count · 更新 last_login_at
    await withAuthLookup((tx) =>
      tx.update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(users.userId, user.userId)),
    );

    await this.auditLogin(user, "allowed");

    const payload: JwtUser = {
      user_id: user.userId,
      role: user.role,
      tenant_id: user.tenantId,
      department_id: user.departmentId,
    };
    return {
      access_token: await this.jwt.signAsync(payload),
      must_change_password: mustChangePassword,
      password_expires_at: user.passwordExpiresAt ? new Date(user.passwordExpiresAt).toISOString() : null,
    };
  }

  /**
   * 登入寫稽核 · 成功與密碼錯誤都寫（CLAUDE.md R5）
   *
   * 為什麼要寫在這裡：登入是公開路由，TenantTxInterceptor 看到沒有 req.user 就直接跳過，
   * 所以在補上這段之前，**登入從來沒有留下任何紀錄** —— 稽核頁的「只看登入」永遠是空的。
   * 帳號不存在的情況不寫：既沒有租戶可掛，也等於在資料庫裡幫人列舉不存在的 email。
   *
   * 寫失敗不擋登入：稽核斷一筆是可以事後追的，全公司登不進來不行。失敗會留 error log。
   */
  private async auditLogin(
    // tenantId 為 null 的只有平台端帳號（aiproot_admin），policy 那條 actor_role 例外剛好接住
    user: { userId: string; tenantId: string | null; role: string; departmentId: string | null },
    result: "allowed" | "denied",
  ): Promise<void> {
    try {
      await withTenant(
        { tenantId: user.tenantId, role: user.role as never, departmentId: user.departmentId, userId: user.userId },
        (tx) => tx.insert(auditLog).values({
          actorUserId: user.userId,
          actorRole: user.role,
          action: "POST /auth/login",
          tenantId: user.tenantId,
          result,
        }),
      );
    } catch (e) {
      this.logger.error(`登入稽核寫入失敗 · user=${user.userId} result=${result}`, e as Error);
    }
  }

  // POST /auth/change-password · 自服務改自己密碼
  // 走 currentTx() 繼承 TenantTxInterceptor 已 set 的 tenant/user/actor_role context
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    if (oldPassword === newPassword) {
      throw new BadRequestException({ status: "same_password", message: "新密碼不可與舊密碼相同" });
    }
    const tx = currentTx();
    const rows = await tx.select().from(users).where(eq(users.userId, userId)).limit(1);
    const user = rows[0];
    if (!user?.passwordHash) {
      throw new UnauthorizedException("使用者不存在或未設密碼");
    }
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new UnauthorizedException("舊密碼錯誤");
    }
    this.policy.validate(newPassword, { email: user.email, displayName: user.displayName });
    if (await this.historyRepo.isReused(tx, userId, newPassword)) {
      throw new BadRequestException({
        status: "password_reused",
        message: `新密碼不可與最近 ${PASSWORD_POLICY.HISTORY_KEEP} 次舊密碼相同`,
      });
    }
    await this.historyRepo.add(tx, userId, user.passwordHash);
    const newHash = await bcrypt.hash(newPassword, 10);
    const now = new Date();
    const expiresAt = this.policy.computeExpiresAt(now);
    await tx.update(users)
      .set({
        passwordHash: newHash,
        passwordUpdatedAt: now,
        passwordExpiresAt: expiresAt,
        mustChangePassword: false,
      })
      .where(eq(users.userId, userId));
  }
}
