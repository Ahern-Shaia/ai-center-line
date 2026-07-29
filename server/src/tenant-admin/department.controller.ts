import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { DepartmentService } from "./department.service.js";
import { DepartmentCreateSchema, DepartmentDeleteSchema, DepartmentUpdateSchema } from "./dto/department.dto.js";
import { resolveTenantId } from "../auth/resolve-tenant-id.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 部門 CRUD · v2 分權：
//   · list · departments:view (含 tenant_admin)
//   · create/update/delete · departments:manage-tenant (tenant_admin) OR departments:manage (aiproot)
// 對照 docs/roles-permissions-matrix.md §3.5
@Controller("tenant-admin/departments")
export class DepartmentController {
  constructor(private readonly svc: DepartmentService) {}

  // 列表 · aiproot / tenant_admin 皆可 (tenantId 過濾)
  @Get()
  @RequirePermission("departments:view")
  async list(@CurrentUser() user: JwtUser, @Query("tenantId") tenantId?: string) {
    // ⚠️ 不可直接用 client 傳的 tenantId —— svc.list 內部會 setTenantContext()
    //    覆蓋掉 interceptor 依 JWT 設好的 RLS 上下文，形成跨租戶 IDOR
    //    （2026-07-29 實測：A 的 tenant_admin 傳 B 的 tenantId 讀得到 B 的部門）。
    //    @RequirePermission 擋不住 —— 它問「有沒有權限」不問「是不是他家的」。
    const t = resolveTenantId(user, tenantId);
    if (!uuidRegex.test(t)) {
      throw new BadRequestException({ status: "tenant_id_required", message: "需傳 tenantId" });
    }
    const departments = await this.svc.list(t);
    return { departments };
  }

  @Post()
  @RequirePermission("departments:manage-tenant", "departments:manage")
  async create(@Body() body: unknown) {
    const parsed = DepartmentCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const { tenantId, ...rest } = parsed.data;
    const department = await this.svc.create(tenantId, rest);
    return { department };
  }

  @Patch(":id")
  @RequirePermission("departments:manage-tenant", "departments:manage")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const parsed = DepartmentUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const { tenantId, ...rest } = parsed.data;
    const department = await this.svc.update(id, tenantId, rest);
    return { department };
  }

  @Delete(":id")
  @RequirePermission("departments:manage-tenant", "departments:manage")
  async delete(@Param("id") id: string, @Body() body: unknown) {
    const parsed = DepartmentDeleteSchema.safeParse(body);
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
