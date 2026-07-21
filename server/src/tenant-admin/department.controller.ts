import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { DepartmentService } from "./department.service.js";
import { DepartmentCreateSchema, DepartmentDeleteSchema, DepartmentUpdateSchema } from "./dto/department.dto.js";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// tenant-admin console · aiproot 統包 · 客戶方部門 CRUD
@Controller("tenant-admin/departments")
export class DepartmentController {
  constructor(private readonly svc: DepartmentService) {}

  // 列表 · aiproot 需傳 tenantId 指定看哪家
  @Get()
  @Roles("aiproot_admin", "consultant")
  async list(@Query("tenantId") tenantId: string) {
    if (!tenantId || !uuidRegex.test(tenantId)) {
      throw new BadRequestException({ status: "tenant_id_required", message: "需傳 tenantId" });
    }
    const departments = await this.svc.list(tenantId);
    return { departments };
  }

  @Post()
  @Roles("aiproot_admin")
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
  @Roles("aiproot_admin")
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
  @Roles("aiproot_admin")
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
