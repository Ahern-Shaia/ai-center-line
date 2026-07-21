import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

// tenant-admin/department repository · aiproot 統包 · CRUD 客戶方部門
// 依 RLS · aiproot_admin 需先 set current_tenant 才看得到 · service 層做

export interface DepartmentRow {
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

export interface DepartmentInsertInput {
  tenantId: string;
  departmentName: string;
  displayName?: string;
  // Legacy 欄位 · placeholder 讓 schema NOT NULL 通過 · Phase 2 才用
  lineGroupId?: string;
  extractionSchema?: string;
  ragicTable?: string;
}

@Injectable()
export class DepartmentRepository {
  async setTenantContext(tx: Db, tenantId: string): Promise<void> {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
  }

  async listByTenant(tx: Db): Promise<DepartmentRow[]> {
    const res = await tx.execute<{
      department_id: string; tenant_id: string; department_name: string;
      display_name: string | null; line_group_id: string | null;
      extraction_schema: string | null; ragic_table: string | null;
      member_count: string; group_binding_count: string;
    }>(sql`
      SELECT d.department_id, d.tenant_id, d.department_name, d.display_name,
             d.line_group_id, d.extraction_schema, d.ragic_table,
             (SELECT COUNT(*)::text FROM users WHERE department_id = d.department_id) AS member_count,
             (SELECT COUNT(*)::text FROM line_group WHERE department_id = d.department_id) AS group_binding_count
      FROM departments d
      ORDER BY d.department_name
    `);
    return res.rows.map((r) => ({
      departmentId: r.department_id,
      tenantId: r.tenant_id,
      departmentName: r.department_name,
      displayName: r.display_name,
      lineGroupId: r.line_group_id,
      extractionSchema: r.extraction_schema,
      ragicTable: r.ragic_table,
      memberCount: Number(r.member_count),
      groupBindingCount: Number(r.group_binding_count),
    }));
  }

  async getById(tx: Db, departmentId: string): Promise<DepartmentRow | null> {
    const res = await tx.execute<{
      department_id: string; tenant_id: string; department_name: string;
      display_name: string | null; line_group_id: string | null;
      extraction_schema: string | null; ragic_table: string | null;
      member_count: string; group_binding_count: string;
    }>(sql`
      SELECT d.department_id, d.tenant_id, d.department_name, d.display_name,
             d.line_group_id, d.extraction_schema, d.ragic_table,
             (SELECT COUNT(*)::text FROM users WHERE department_id = d.department_id) AS member_count,
             (SELECT COUNT(*)::text FROM line_group WHERE department_id = d.department_id) AS group_binding_count
      FROM departments d
      WHERE d.department_id = ${departmentId}
      LIMIT 1
    `);
    const r = res.rows[0];
    if (!r) return null;
    return {
      departmentId: r.department_id,
      tenantId: r.tenant_id,
      departmentName: r.department_name,
      displayName: r.display_name,
      lineGroupId: r.line_group_id,
      extractionSchema: r.extraction_schema,
      ragicTable: r.ragic_table,
      memberCount: Number(r.member_count),
      groupBindingCount: Number(r.group_binding_count),
    };
  }

  async insert(tx: Db, input: DepartmentInsertInput): Promise<string> {
    const res = await tx.execute<{ department_id: string }>(sql`
      INSERT INTO departments (tenant_id, department_name, display_name,
                                line_group_id, extraction_schema, ragic_table)
      VALUES (${input.tenantId}, ${input.departmentName}, ${input.displayName ?? null},
              ${input.lineGroupId ?? "-"}, ${input.extractionSchema ?? "default"}, ${input.ragicTable ?? "default"})
      RETURNING department_id
    `);
    const row = res.rows[0];
    if (!row) throw new Error("insert department 未回 department_id");
    return row.department_id;
  }

  async update(tx: Db, departmentId: string, patch: {
    departmentName?: string;
    displayName?: string | null;
  }): Promise<void> {
    await tx.execute(sql`
      UPDATE departments SET
        department_name = COALESCE(${patch.departmentName ?? null}, department_name),
        display_name = CASE WHEN ${patch.displayName !== undefined}::boolean
          THEN ${patch.displayName ?? null} ELSE display_name END
      WHERE department_id = ${departmentId}
    `);
  }

  async delete(tx: Db, departmentId: string): Promise<void> {
    await tx.execute(sql`DELETE FROM departments WHERE department_id = ${departmentId}`);
  }
}
