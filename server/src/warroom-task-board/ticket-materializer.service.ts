import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";

/**
 * TicketMaterializerService · WTB-M1
 * 對照 docs/modules/warroom-task-board.md §4
 *
 * Batch complete 後 · 把 analysis_result.records[] 高信度項目材料化為 tickets 卡片
 * 冪等：同 (source_upload_id, source_record_index) 已存在 → UPDATE (不新增第 2 筆)
 *
 * OQ-WTB-1 = B · records schema 已含 person / status · v1 用 person 對 assignee_display_name
 * OQ-WTB-5 = A · confidence 從 high 降 → 標「已撤銷」不刪（M5 加）
 */
@Injectable()
export class TicketMaterializerService {
  private readonly logger = new Logger(TicketMaterializerService.name);

  /**
   * Materialize an upload's records → tickets
   * · 只材料化 confidence='high' 的 records
   * · department 從 upload.group_id → line_group.department_id 拿 (snapshot 當下)
   * · 冪等 · rerun 走 ON CONFLICT DO UPDATE
   */
  async materialize(uploadId: number): Promise<{ inserted: number; updated: number; skipped: number }> {
    // Step 1 · aiproot_admin 讀 upload + result + group→dept (跨租戶 endpoint)
    const bundle = await withTenant({ tenantId: null, role: "aiproot_admin" }, async (tx) => {
      const upload = await tx.execute<{
        tenant_id: string;
        group_id: string | null;
        department_id: string | null;
      }>(sql`
        SELECT au.tenant_id::text, au.group_id, lg.department_id::text
        FROM analysis_upload au
        LEFT JOIN line_bot lb ON lb.tenant_id = au.tenant_id
        LEFT JOIN line_group lg ON lg.bot_id = lb.bot_id AND lg.group_id = au.group_id
        WHERE au.id = ${uploadId}
        LIMIT 1
      `);
      const uploadRow = upload.rows[0];
      if (!uploadRow) return null;

      const result = await tx.execute<{ records: unknown }>(sql`
        SELECT records FROM analysis_result WHERE upload_id = ${uploadId} LIMIT 1
      `);
      return {
        tenantId: uploadRow.tenant_id,
        groupId: uploadRow.group_id,
        departmentId: uploadRow.department_id,
        records: (result.rows[0]?.records as Array<{
          category: string;
          title: string;
          detail: string;
          status: string | null;
          person: string | null;
          machine_code: string | null;
          work_order: string | null;
          source_ids: number[];
          confidence: string;
        }> | undefined) ?? [],
      };
    });

    if (!bundle) {
      this.logger.warn(`materialize · upload=${uploadId} 不存在`);
      return { inserted: 0, updated: 0, skipped: 0 };
    }

    if (bundle.records.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }

    // 需 department_id · 若 group 未分派部門 · v1 skip 該 upload (M5 開放 admin 手動指派)
    if (!bundle.departmentId) {
      this.logger.warn(`materialize · upload=${uploadId} group=${bundle.groupId} 未分派部門 · skip`);
      return { inserted: 0, updated: 0, skipped: bundle.records.length };
    }

    // Step 2 · tenant_admin 上下文寫 tickets
    return withTenant({ tenantId: bundle.tenantId, role: "tenant_admin" }, async (tx) => {
      let inserted = 0, updated = 0, skipped = 0;

      for (let idx = 0; idx < bundle.records.length; idx++) {
        const rec = bundle.records[idx];
        if (rec.confidence !== "high") { skipped++; continue; }

        const summary = truncate(rec.title || rec.detail || "（無摘要）", 500);
        const assignee = rec.person ? truncate(rec.person, 100) : null;
        const category = rec.category ? truncate(rec.category, 100) : null;

        // 冪等 UPSERT · ux_tickets_source_record 撞則 UPDATE
        const res = await tx.execute<{ inserted: boolean }>(sql`
          INSERT INTO tickets (
            tenant_id, department_id, category, summary, confidence,
            confirm_status, needs_review, assignee_display_name,
            source_upload_id, source_record_index, message_count
          ) VALUES (
            ${bundle.tenantId}::uuid, ${bundle.departmentId}::uuid,
            ${category}, ${summary}, ${rec.confidence},
            '待簽核', false, ${assignee},
            ${uploadId}, ${idx}, ${rec.source_ids?.length ?? null}
          )
          ON CONFLICT (source_upload_id, source_record_index)
          WHERE source_upload_id IS NOT NULL AND source_record_index IS NOT NULL
          DO UPDATE SET
            category = EXCLUDED.category,
            summary = EXCLUDED.summary,
            confidence = EXCLUDED.confidence,
            assignee_display_name = EXCLUDED.assignee_display_name,
            message_count = EXCLUDED.message_count,
            updated_at = now()
          RETURNING (xmax = 0) AS inserted
        `);
        if (res.rows[0]?.inserted) inserted++;
        else updated++;
      }

      this.logger.log(`materialize · upload=${uploadId} · inserted=${inserted} updated=${updated} skipped=${skipped}`);
      return { inserted, updated, skipped };
    });
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
