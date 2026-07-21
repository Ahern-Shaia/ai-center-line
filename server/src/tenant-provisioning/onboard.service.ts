import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { currentTx } from "../db/client.js";
import { PasswordPolicyService } from "../auth/password-policy.service.js";
import { PasswordHistoryRepository } from "../auth/password-history.repository.js";

// tenant-provisioning M2 · 一鍵開通新客戶
// 全流程 transaction · FMEA #1 P0 · 全成或全 rollback

export const DEFAULT_DEPARTMENTS = [
  "人資總務", "售後服務", "報工生產", "技術工程", "技術研發", "業務一部",
] as const;

export interface OnboardResult {
  tenantId: string;
  adminUserId: string;
  adminEmail: string;
  initialPassword: string;            // 一次性 · 前端顯示後 · 不入 audit body
  mustChangeAtFirstLogin: true;
  departments: Array<{ departmentId: string; departmentName: string }>;
}

export interface ResetPasswordResult {
  newPassword: string;                // 一次性
  userId: string;
  email: string | null;
  mustChangeAtNextLogin: true;
}

@Injectable()
export class OnboardService {
  constructor(
    private readonly policy: PasswordPolicyService,
    private readonly historyRepo: PasswordHistoryRepository,
  ) {}

  async onboardTenant(input: {
    tenantName: string;
    industry?: string;
    adminEmail: string;
    adminDisplayName?: string;
    departments?: string[];
  }): Promise<OnboardResult> {
    const tx = currentTx();

    // 1) 唯一性檢查
    const nameConflict = await tx.execute<{ tenant_id: string }>(sql`
      SELECT tenant_id FROM tenants WHERE tenant_name = ${input.tenantName} LIMIT 1
    `);
    if (nameConflict.rows.length > 0) {
      throw new ConflictException({ status: "tenant_name_taken", message: `租戶名「${input.tenantName}」已存在` });
    }
    const emailConflict = await tx.execute<{ user_id: string }>(sql`
      SELECT user_id FROM users WHERE email = ${input.adminEmail} LIMIT 1
    `);
    if (emailConflict.rows.length > 0) {
      throw new ConflictException({ status: "email_taken", message: `email「${input.adminEmail}」已被使用` });
    }

    // 2) 建 tenant
    const tenantRes = await tx.execute<{ tenant_id: string }>(sql`
      INSERT INTO tenants (tenant_name, industry, onboard_status)
      VALUES (${input.tenantName}, ${input.industry ?? null}, '測試中')
      RETURNING tenant_id
    `);
    const tenantId = tenantRes.rows[0]?.tenant_id;
    if (!tenantId) throw new Error("tenant 建立失敗");

    // 3) 產強隨機密碼 · bcrypt
    const initialPassword = this.policy.generateStrongPassword(16);
    const passwordHash = await bcrypt.hash(initialPassword, 10);

    // 4) 建 admin user · must_change=true · expires=NULL (grandfathered · 首次改後啟動 90d 週期)
    // SET current_tenant 讓 RLS 通 · users p_users 需 tenant match
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
    const userRes = await tx.execute<{ user_id: string }>(sql`
      INSERT INTO users
        (tenant_id, role, email, display_name, password_hash, must_change_password, password_updated_at)
      VALUES
        (${tenantId}, 'tenant_admin', ${input.adminEmail},
         ${input.adminDisplayName ?? null}, ${passwordHash}, true, now())
      RETURNING user_id
    `);
    const adminUserId = userRes.rows[0]?.user_id;
    if (!adminUserId) throw new Error("admin user 建立失敗");

    // 5) password_history 首筆 · 讓「不可重用最近 5 次」policy 立刻生效
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${adminUserId}, true)`);
    await this.historyRepo.add(tx, adminUserId, passwordHash);

    // 6) 預塞 default 6 部門（或用戶指定的清單）
    const deptNames = input.departments && input.departments.length > 0
      ? input.departments
      : DEFAULT_DEPARTMENTS;
    const departments: Array<{ departmentId: string; departmentName: string }> = [];
    // Legacy 表有 UNIQUE(tenant_id, line_group_id) · 用 -N 唯一 placeholder 避開衝突
    // (Phase 2 line-ingest 已替代 · Phase 3 該欄位可 drop · 現在 workaround)
    for (let i = 0; i < deptNames.length; i++) {
      const name = deptNames[i];
      const dRes = await tx.execute<{ department_id: string }>(sql`
        INSERT INTO departments (tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
        VALUES (${tenantId}, ${name}, ${`__placeholder__${i}`}, 'default', 'default')
        RETURNING department_id
      `);
      const departmentId = dRes.rows[0]?.department_id;
      if (departmentId) departments.push({ departmentId, departmentName: name });
    }

    return {
      tenantId,
      adminUserId,
      adminEmail: input.adminEmail,
      initialPassword,
      mustChangeAtFirstLogin: true,
      departments,
    };
  }

  // aiproot rotate 他人密碼 · 走 tenant context · 產強隨機並 return 一次
  async resetUserPassword(userId: string, tenantId: string): Promise<ResetPasswordResult> {
    const tx = currentTx();
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);

    const userRes = await tx.execute<{ email: string | null; password_hash: string | null }>(sql`
      SELECT email, password_hash FROM users WHERE user_id = ${userId} AND tenant_id = ${tenantId} LIMIT 1
    `);
    const user = userRes.rows[0];
    if (!user) throw new NotFoundException("找不到該租戶下的使用者");

    const newPassword = this.policy.generateStrongPassword(16);
    const newHash = await bcrypt.hash(newPassword, 10);

    // 舊 hash 進歷史 (若存在) · 免使用者又改回舊的
    if (user.password_hash) {
      await this.historyRepo.add(tx, userId, user.password_hash);
    }
    await tx.execute(sql`
      UPDATE users SET
        password_hash = ${newHash},
        password_updated_at = now(),
        password_expires_at = NULL,
        must_change_password = true,
        failed_login_count = 0,
        locked_until = NULL
      WHERE user_id = ${userId}
    `);
    return { newPassword, userId, email: user.email, mustChangeAtNextLogin: true };
  }

  // 解鎖 · 清 failed_count + locked_until
  async unlockUser(userId: string, tenantId: string): Promise<{ userId: string }> {
    const tx = currentTx();
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
    const res = await tx.execute<{ user_id: string }>(sql`
      UPDATE users SET failed_login_count = 0, locked_until = NULL
      WHERE user_id = ${userId} AND tenant_id = ${tenantId}
      RETURNING user_id
    `);
    if (res.rows.length === 0) throw new NotFoundException("找不到該租戶下的使用者");
    return { userId };
  }
}
