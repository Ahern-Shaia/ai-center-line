import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import type { JwtUser } from "../auth/jwt-user.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { resolveTenantId } from "../auth/resolve-tenant-id.js";
import { RequirePermission } from "../permission/require-permission.decorator.js";
import { withTenant } from "../db/client.js";
import { CategoryRegistryRepository } from "./category-registry.repository.js";
import { msg } from "../i18n/index.js";

/**
 * Category Registry Controller · WTB-M5
 * 對照 docs/modules/warroom-task-board.md §5.3
 *
 * Aiproot 分類管理 UI 用：
 *   GET  /categories?tenantId=  → 列 tenant 全分類 (active + archived)
 *   POST /categories/:id/rename → 改顯示名
 *   POST /categories/:id/archive → status='archived' (不刪 · UI 隱)
 *   POST /categories/:id/reactivate → status='active'
 *
 * Aiproot 角色 · 跨租戶操作 · 走 aiproot_admin
 */
@Controller("categories")
export class CategoryRegistryController {
  constructor(private readonly repo: CategoryRegistryRepository) {}

  @Get()
  @RequirePermission("categories:view")
  async list(@CurrentUser() user: JwtUser, @Query("tenantId") tenantId?: string, @Query("status") status?: "active" | "archived" | "all") {
    const t = resolveTenantId(user, tenantId);
    const rows = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => {
      if (status === "active") return this.repo.listActive(tx, t);
      return this.repo.listAll(tx, t);
    });
    return { categories: rows };
  }

  @Post(":categoryId/rename")
  @RequirePermission("categories:manage")
  async rename(@Param("categoryId") categoryId: string, @Body() body: { name?: string }) {
    if (!body?.name || body.name.trim().length === 0) throw new BadRequestException(msg("srv.v.needName"));
    await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.rename(tx, categoryId, body.name!.trim()));
    return { success: true };
  }

  @Post(":categoryId/archive")
  @RequirePermission("categories:manage")
  async archive(@Param("categoryId") categoryId: string) {
    await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.archive(tx, categoryId));
    return { success: true };
  }
}
