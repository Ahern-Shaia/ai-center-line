import { SetMetadata } from "@nestjs/common";
import type { Role } from "../db/schema.js";

// 宣告路由允許的角色，由 RolesGuard 檢查。
export const ROLES_KEY = "roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
