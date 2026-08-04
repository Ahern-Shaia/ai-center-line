import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { currentTx } from "../db/client.js";
import type { Role } from "../db/schema.js";
import { UserRepository, type UserRow } from "./user.repository.js";

// tenant_admin 只能動這兩種角色的成員（碰不到 總經理室/助理/aiproot＝不構成提權）
const MEMBER_ROLES: readonly string[] = ["employee", "group_owner"];

export interface UserDto {
  userId: string;
  tenantId: string | null;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
  departmentSource: "auto" | "manual";
  email: string | null;
  displayName: string | null;
  lineUserId: string | null;
  createdAt: string;
  hasPassword: boolean;
}

@Injectable()
export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async list(tenantId: string): Promise<UserDto[]> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const rows = await this.repo.listByTenant(tx, tenantId);
    return rows.map((r) => this.toDto(r));
  }

  async create(tenantId: string, input: {
    email: string;
    role: Role;
    displayName?: string;
    departmentId?: string;
    password: string;
  }): Promise<UserDto> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const passwordHash = await bcrypt.hash(input.password, 10);
    const id = await this.repo.insert(tx, {
      tenantId,
      role: input.role,
      email: input.email,
      displayName: input.displayName,
      departmentId: input.departmentId ?? null,
      passwordHash,
    });
    const row = await this.repo.getById(tx, id);
    if (!row) throw new Error("剛新增的使用者找不到");
    return this.toDto(row);
  }

  async update(userId: string, tenantId: string, patch: {
    role?: Role;
    displayName?: string | null;
    departmentId?: string | null;
    password?: string;
  }): Promise<UserDto> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const existing = await this.repo.getById(tx, userId);
    if (!existing) throw new NotFoundException("找不到使用者");
    const patchDb: {
      role?: Role;
      displayName?: string | null;
      departmentId?: string | null;
      passwordHash?: string;
    } = {
      role: patch.role,
      displayName: patch.displayName,
      departmentId: patch.departmentId,
    };
    if (patch.password) {
      patchDb.passwordHash = await bcrypt.hash(patch.password, 10);
    }
    await this.repo.update(tx, userId, patchDb);
    const updated = await this.repo.getById(tx, userId);
    if (!updated) throw new Error("剛更新的使用者找不到");
    return this.toDto(updated);
  }

  /**
   * MDA · 手動指派成員部門（tenant_admin 可用）· 只改部門，不碰角色/密碼。
   * 兩道防 IDOR：① setTenantContext + RLS 讓改不到別租戶的成員
   *            ② 明驗目標部門屬同租戶（departmentBelongsToTenant）
   */
  async assignDepartment(userId: string, tenantId: string, departmentId: string | null, actorUserId: string): Promise<UserDto> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const existing = await this.repo.getById(tx, userId);
    // RLS 之下看不到＝不在這個租戶（或不存在）· 都回 404，不洩漏「存在但跨租戶」
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundException("找不到該成員");
    // 不能改自己的部門（與 assignRole/deleteMember 的 self-guard 一致）——
    // 管理者調整的是「別人」的歸屬；自己的歸屬由上一層管，避免自我改動造成 scope 混亂。
    if (userId === actorUserId) throw new ForbiddenException("不能修改自己的部門");
    if (departmentId) {
      const ok = await this.repo.departmentBelongsToTenant(tx, departmentId, tenantId);
      if (!ok) throw new BadRequestException("該部門不屬於這個公司");
    }
    await this.repo.assignDepartment(tx, { userId, departmentId, actorUserId });
    const updated = await this.repo.getById(tx, userId);
    if (!updated) throw new Error("剛更新的使用者找不到");
    return this.toDto(updated);
  }

  async delete(userId: string, tenantId: string): Promise<void> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const existing = await this.repo.getById(tx, userId);
    if (!existing) throw new NotFoundException("找不到使用者");
    await this.repo.delete(tx, userId);
  }

  /**
   * 改成員角色（tenant_admin 可用）· 護欄三道，全在伺服器（不信前端）：
   *   ① setTenantContext + RLS + 明驗同租戶 → 改不到別租戶的人（防 IDOR）
   *   ② 目標現在的角色必須是 員工/部門主管 → 碰不到 總經理室/助理/aiproot（防動同級或上級）
   *   ③ 目標角色只能設 員工/部門主管（DTO 已鎖）+ 不能改自己 → 防自我升級
   */
  async assignRole(userId: string, tenantId: string, newRole: "employee" | "group_owner", callerUserId: string): Promise<UserDto> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const existing = await this.repo.getById(tx, userId);
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundException("找不到該成員");
    if (userId === callerUserId) throw new ForbiddenException("不能修改自己的角色");
    if (!MEMBER_ROLES.includes(existing.role)) {
      throw new ForbiddenException("只能調整員工或部門主管的角色 · 高階帳號請聯繫 aiproot");
    }
    await this.repo.update(tx, userId, { role: newRole as Role });
    const updated = await this.repo.getById(tx, userId);
    if (!updated) throw new Error("剛更新的使用者找不到");
    return this.toDto(updated);
  }

  /** 刪除自家成員（tenant_admin 可用）· 護欄同 assignRole：限自租戶 + 限 員工/部門主管 + 不能刪自己 */
  async deleteMember(userId: string, tenantId: string, callerUserId: string): Promise<void> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const existing = await this.repo.getById(tx, userId);
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundException("找不到該成員");
    if (userId === callerUserId) throw new ForbiddenException("不能刪除自己");
    if (!MEMBER_ROLES.includes(existing.role)) {
      throw new ForbiddenException("只能刪除員工或部門主管 · 高階帳號請聯繫 aiproot");
    }
    // 任務會記下「誰簽核 / 誰指派 / 誰代簽」，那三個外鍵都是 NO ACTION —— 有引用就刪不掉人。
    // 先算清楚再擋，否則使用者拿到的是 `tickets_confirmed_by_fkey` 這種 Postgres 原文，
    // 既看不懂也不知道下一步要做什麼。
    const refs = await this.repo.countTicketReferences(tx, userId);
    if (refs > 0) {
      throw new ConflictException(
        `${existing.displayName ?? "這位成員"}還被 ${refs} 張任務記為簽核人或指派人，因此無法刪除`
        + " · 任務需要保留是誰經手的 · 請先處理掉那些任務，或改為保留帳號不用",
      );
    }
    await this.repo.delete(tx, userId);
  }

  private toDto(row: UserRow): UserDto {
    return { ...row };
  }
}
