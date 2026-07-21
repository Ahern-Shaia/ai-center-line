import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { currentTx } from "../db/client.js";
import type { Role } from "../db/schema.js";
import { UserRepository, type UserRow } from "./user.repository.js";

export interface UserDto {
  userId: string;
  tenantId: string | null;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
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

  async delete(userId: string, tenantId: string): Promise<void> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const existing = await this.repo.getById(tx, userId);
    if (!existing) throw new NotFoundException("找不到使用者");
    await this.repo.delete(tx, userId);
  }

  private toDto(row: UserRow): UserDto {
    return { ...row };
  }
}
