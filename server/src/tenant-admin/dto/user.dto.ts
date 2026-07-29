import { z } from "zod";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ⚠️ 這裡刻意**列舉內建角色**而不是去查 roles 表 ——
// 自訂角色功能已凍結（docs/modules/custom-roles.md §4）。
// 動態查表會把「任何人建的任何角色都能指派」這條路打開，而那條路帶著 4 個 P0。
// 要加角色就在這裡加一個，同時記得改 users_role_check 與前端 ROLE_LABEL。
const RoleEnum = z.enum(["aiproot_admin", "consultant", "tenant_admin", "group_owner", "assistant"]);

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
