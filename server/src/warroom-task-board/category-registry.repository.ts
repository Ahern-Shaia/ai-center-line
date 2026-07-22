import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export interface CategoryRegistryRow {
  categoryId: string;
  tenantId: string;
  categoryName: string;
  categorySlug: string;
  description: string | null;
  usageCount: number;
  firstSeenAt: string;
  lastUsedAt: string;
  createdBy: string | null;
  status: "active" | "archived" | "pending_review";
  [key: string]: unknown;
}

/**
 * CategoryRegistryRepository · WTB-M2
 * 對照 docs/modules/warroom-task-board.md §5
 * OQ-WTB-2 = A · 新分類 auto-active · aiproot 事後可 archive
 * OQ-WTB-10 = B · slug 走 slugify (英文 lowercase + 底線 · 中文保留去空格)
 */
@Injectable()
export class CategoryRegistryRepository {
  async listActive(tx: Db, tenantId: string): Promise<CategoryRegistryRow[]> {
    const res = await tx.execute<CategoryRegistryRow>(sql`
      SELECT category_id AS "categoryId",
             tenant_id::text AS "tenantId",
             category_name AS "categoryName",
             category_slug AS "categorySlug",
             description,
             usage_count AS "usageCount",
             first_seen_at::text AS "firstSeenAt",
             last_used_at::text AS "lastUsedAt",
             created_by::text AS "createdBy",
             status
      FROM category_registry
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
      ORDER BY usage_count DESC, last_used_at DESC
    `);
    return res.rows;
  }

  async listAll(tx: Db, tenantId: string): Promise<CategoryRegistryRow[]> {
    const res = await tx.execute<CategoryRegistryRow>(sql`
      SELECT category_id AS "categoryId",
             tenant_id::text AS "tenantId",
             category_name AS "categoryName",
             category_slug AS "categorySlug",
             description,
             usage_count AS "usageCount",
             first_seen_at::text AS "firstSeenAt",
             last_used_at::text AS "lastUsedAt",
             created_by::text AS "createdBy",
             status
      FROM category_registry
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY status, usage_count DESC
    `);
    return res.rows;
  }

  /**
   * 冪等 upsert · 若 slug 已存在 → usage_count++ + last_used_at = now
   * OQ-WTB-2 = A · 新分類 auto-active (不走 pending_review)
   */
  async upsert(tx: Db, args: {
    tenantId: string;
    name: string;
    slug: string;
    createdBy: string | null;
  }): Promise<{ categoryId: string; isNew: boolean }> {
    const res = await tx.execute<{ category_id: string; is_new: boolean }>(sql`
      INSERT INTO category_registry
        (tenant_id, category_name, category_slug, created_by, status, usage_count, last_used_at)
      VALUES
        (${args.tenantId}::uuid, ${args.name}, ${args.slug}, ${args.createdBy ?? null}::uuid, 'active', 1, now())
      ON CONFLICT (tenant_id, category_slug) DO UPDATE SET
        usage_count = category_registry.usage_count + 1,
        last_used_at = now()
      RETURNING category_id, (xmax = 0) AS is_new
    `);
    return { categoryId: res.rows[0].category_id, isNew: res.rows[0].is_new };
  }

  async rename(tx: Db, categoryId: string, newName: string): Promise<void> {
    await tx.execute(sql`
      UPDATE category_registry SET category_name = ${newName}
      WHERE category_id = ${categoryId}::uuid
    `);
  }

  async archive(tx: Db, categoryId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE category_registry SET status = 'archived'
      WHERE category_id = ${categoryId}::uuid
    `);
  }
}

/**
 * Slugify · OQ-WTB-10 = B
 * · 英文 lowercase + 空格轉底線
 * · 中文保留 · 去所有空白
 * · 移除特殊字元 (只留 [a-z0-9一-龥_-])
 * · max 50 char (超過 truncate)
 */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9一-龥_-]/g, "");
  return s.slice(0, 50);
}
