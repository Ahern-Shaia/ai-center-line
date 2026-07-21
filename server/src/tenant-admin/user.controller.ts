import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { UserService } from "./user.service.js";
import { UserCreateSchema, UserDeleteSchema, UserUpdateSchema } from "./dto/user.dto.js";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("tenant-admin/users")
export class UserController {
  constructor(private readonly svc: UserService) {}

  @Get()
  @Roles("aiproot_admin", "consultant")
  async list(@Query("tenantId") tenantId: string) {
    if (!tenantId || !uuidRegex.test(tenantId)) {
      throw new BadRequestException({ status: "tenant_id_required", message: "需傳 tenantId" });
    }
    const users = await this.svc.list(tenantId);
    return { users };
  }

  @Post()
  @Roles("aiproot_admin")
  async create(@Body() body: unknown) {
    const parsed = UserCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        status: "invalid_body",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const { tenantId, ...rest } = parsed.data;
    const user = await this.svc.create(tenantId, rest);
    return { user };
  }

  @Patch(":id")
  @Roles("aiproot_admin")
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
  @Roles("aiproot_admin")
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
