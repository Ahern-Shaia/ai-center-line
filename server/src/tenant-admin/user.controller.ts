import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { UserService } from "./user.service.js";
import { UserCreateSchema, UserDeleteSchema, UserUpdateSchema } from "./dto/user.dto.js";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 使用者 CRUD · v2 分權：
//   · list · users:view (含 tenant_admin)
//   · create · users:create-group-owner (tenant_admin · 限 role=group_owner) 或 users:manage (aiproot 全)
//   · update / delete · users:manage (aiproot only · 避免 tenant_admin 亂動)
// 對照 docs/roles-permissions-matrix.md §2 + §3.5
@Controller("tenant-admin/users")
export class UserController {
  constructor(private readonly svc: UserService) {}

  @Get()
  @RequirePermission("users:view")
  async list(@Query("tenantId") tenantId: string) {
    if (!tenantId || !uuidRegex.test(tenantId)) {
      throw new BadRequestException({ status: "tenant_id_required", message: "需傳 tenantId" });
    }
    const users = await this.svc.list(tenantId);
    return { users };
  }

  @Post()
  @RequirePermission("users:create-group-owner", "users:manage")
  async create(@Body() body: unknown, @CurrentUser() caller: JwtUser) {
    const parsed = UserCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const { tenantId, ...rest } = parsed.data;

    // v2 安全 · tenant_admin 只能建自 tenant 的 group_owner
    // aiproot_admin 全能 (users:manage) · caller.role='aiproot_admin' 走這條
    if (caller.role !== "aiproot_admin") {
      // 限自 tenant
      if (caller.tenant_id && tenantId !== caller.tenant_id) {
        throw new ForbiddenException("只能在自己 tenant 建帳號");
      }
      // 限 role='group_owner'
      if (rest.role !== "group_owner") {
        throw new ForbiddenException("你只能建 group_owner 帳號 · 建高階帳號請聯繫 aiproot");
      }
    }

    const user = await this.svc.create(tenantId, rest);
    return { user };
  }

  @Patch(":id")
  @RequirePermission("users:manage")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const parsed = UserUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const { tenantId, ...rest } = parsed.data;
    const user = await this.svc.update(id, tenantId, rest);
    return { user };
  }

  @Delete(":id")
  @RequirePermission("users:manage")
  async delete(@Param("id") id: string, @Body() body: unknown) {
    const parsed = UserDeleteSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    await this.svc.delete(id, parsed.data.tenantId);
    return { status: "deleted" };
  }
}
