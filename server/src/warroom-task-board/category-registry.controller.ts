import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { withTenant } from "../db/client.js";
import { CategoryRegistryRepository } from "./category-registry.repository.js";

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
  @Roles("aiproot_admin", "consultant")
  async list(@Query("tenantId") tenantId?: string, @Query("status") status?: "active" | "archived" | "all") {
    if (!tenantId) throw new BadRequestException("tenantId 必要");
    const rows = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => {
      if (status === "active") return this.repo.listActive(tx, tenantId);
      return this.repo.listAll(tx, tenantId);
    });
    return { categories: rows };
  }

  @Post(":categoryId/rename")
  @Roles("aiproot_admin")
  async rename(@Param("categoryId") categoryId: string, @Body() body: { name?: string }) {
    if (!body?.name || body.name.trim().length === 0) throw new BadRequestException("name 必要");
    await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.rename(tx, categoryId, body.name!.trim()));
    return { success: true };
  }

  @Post(":categoryId/archive")
  @Roles("aiproot_admin")
  async archive(@Param("categoryId") categoryId: string) {
    await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => this.repo.archive(tx, categoryId));
    return { success: true };
  }
}
