import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { currentTx } from "../db/client.js";
import { DepartmentRepository, type DepartmentRow } from "./department.repository.js";

export interface DepartmentDto {
  departmentId: string;
  tenantId: string;
  departmentName: string;
  displayName: string | null;
  lineGroupId: string | null;
  extractionSchema: string | null;
  ragicTable: string | null;
  memberCount: number;
  groupBindingCount: number;
}

@Injectable()
export class DepartmentService {
  constructor(private readonly repo: DepartmentRepository) {}

  async list(tenantId: string): Promise<DepartmentDto[]> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const rows = await this.repo.listByTenant(tx);
    return rows.map((r) => this.toDto(r));
  }

  async create(tenantId: string, input: {
    departmentName: string;
    displayName?: string;
  }): Promise<DepartmentDto> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const id = await this.repo.insert(tx, { tenantId, ...input });
    const row = await this.repo.getById(tx, id);
    if (!row) throw new Error("剛新增的部門找不到");
    return this.toDto(row);
  }

  async update(departmentId: string, tenantId: string, patch: {
    departmentName?: string;
    displayName?: string | null;
  }): Promise<DepartmentDto> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const existing = await this.repo.getById(tx, departmentId);
    if (!existing) throw new NotFoundException("找不到部門");
    await this.repo.update(tx, departmentId, patch);
    const updated = await this.repo.getById(tx, departmentId);
    if (!updated) throw new Error("剛更新的部門找不到");
    return this.toDto(updated);
  }

  async delete(departmentId: string, tenantId: string): Promise<void> {
    const tx = currentTx();
    await this.repo.setTenantContext(tx, tenantId);
    const existing = await this.repo.getById(tx, departmentId);
    if (!existing) throw new NotFoundException("找不到部門");
    if (existing.memberCount > 0) {
      throw new ConflictException({
        status: "department_has_members",
        message: `部門有 ${existing.memberCount} 名成員 · 需先移除或轉移成員才能刪除`,
      });
    }
    if (existing.groupBindingCount > 0) {
      throw new ConflictException({
        status: "department_has_group_bindings",
        message: `部門已綁定 ${existing.groupBindingCount} 個 LINE 群組 · 需先移除綁定才能刪除`,
      });
    }
    await this.repo.delete(tx, departmentId);
  }

  private toDto(row: DepartmentRow): DepartmentDto {
    return {
      departmentId: row.departmentId,
      tenantId: row.tenantId,
      departmentName: row.departmentName,
      displayName: row.displayName,
      lineGroupId: row.lineGroupId,
      extractionSchema: row.extractionSchema,
      ragicTable: row.ragicTable,
      memberCount: row.memberCount,
      groupBindingCount: row.groupBindingCount,
    };
  }
}
