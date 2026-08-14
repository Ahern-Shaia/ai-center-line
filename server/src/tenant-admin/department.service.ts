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
  /** 綁在此部門的 LINE 群名 · 前端要能指名是哪一群，不然使用者得在十幾群裡自己找 */
  boundGroupNames: string[];
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
    // 兩道檢查一次講完，而且要指出「去哪裡、按什麼」。
    // 原本一次只回一道：使用者解完群綁定回來，再撞一次成員那道牆。
    // 而且「解除綁定」在 LINE 機器人管理頁根本不是這個字 —— 那裡叫「分派部門」選「未分派」。
    const blockers: string[] = [];
    if (existing.memberCount > 0) {
      blockers.push(`成員 ${existing.memberCount} 人（到「部門 / 成員」的「成員」分頁改分派或移除）`);
    }
    if (existing.groupBindingCount > 0) {
      const names = existing.boundGroupNames.join("、");
      blockers.push(
        `綁定 LINE 群 ${existing.groupBindingCount} 個${names ? `：${names}` : ""}`
        + `（到「LINE 機器人管理」把該群的「分派部門」改成「未分派」）`,
      );
    }
    if (blockers.length > 0) {
      throw new ConflictException({
        status: existing.memberCount > 0 ? "department_has_members" : "department_has_group_bindings",
        message: `部門「${existing.departmentName}」目前不可刪除 —— ${blockers.join("；")}`,
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
      boundGroupNames: row.boundGroupNames,
    };
  }
}
