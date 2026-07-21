import { z } from "zod";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RoleEnum = z.enum(["aiproot_admin", "consultant", "tenant_admin", "group_owner"]);

export const UserCreateSchema = z.object({
  tenantId: z.string().regex(uuidRegex),
  role: RoleEnum,
  email: z.string().trim().min(3).max(200),
  displayName: z.string().trim().max(100).optional(),
  departmentId: z.string().regex(uuidRegex).optional(),
  password: z.string().min(6).max(200),
});

export const UserUpdateSchema = z.object({
  tenantId: z.string().regex(uuidRegex),
  role: RoleEnum.optional(),
  displayName: z.string().trim().max(100).nullable().optional(),
  departmentId: z.string().regex(uuidRegex).nullable().optional(),
  password: z.string().min(6).max(200).optional(),
});

export const UserDeleteSchema = z.object({
  tenantId: z.string().regex(uuidRegex),
});

export type UserCreateDto = z.infer<typeof UserCreateSchema>;
export type UserUpdateDto = z.infer<typeof UserUpdateSchema>;
