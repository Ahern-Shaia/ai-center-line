import { z } from "zod";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DepartmentCreateSchema = z.object({
  tenantId: z.string().regex(uuidRegex),
  departmentName: z.string().trim().min(1).max(100),
  displayName: z.string().trim().max(100).optional(),
});

export const DepartmentUpdateSchema = z.object({
  tenantId: z.string().regex(uuidRegex),      // 需 tenantId 才能 SET current_tenant
  departmentName: z.string().trim().min(1).max(100).optional(),
  displayName: z.string().trim().max(100).nullable().optional(),
});

export const DepartmentDeleteSchema = z.object({
  tenantId: z.string().regex(uuidRegex),
});

export type DepartmentCreateDto = z.infer<typeof DepartmentCreateSchema>;
export type DepartmentUpdateDto = z.infer<typeof DepartmentUpdateSchema>;
