import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { currentTx, withAuthLookup } from "../db/client.js";
import { users } from "../db/schema.js";
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
