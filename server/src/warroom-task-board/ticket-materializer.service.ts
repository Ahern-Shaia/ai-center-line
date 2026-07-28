import { Injectable, Logger } from "@nestjs/common";
import { AssigneeResolverService } from "./assignee-resolver.service.js";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";
import { laneFor, RECOMPUTABLE_LANES } from "./ticket-lane.js";

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

  constructor(private readonly assigneeResolver: AssigneeResolverService) {}

  /**
   * Materialize an upload's records → tickets
   * · 分區由 laneFor() 決定（confidence × status），不再只看 confidence
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
        // 兩個維度：confidence 回答「抽得準不準」、status 回答「該不該追」。
        // 先前只看 confidence，才會讓「開會通知」這種抽得很準的公告去排隊等簽核。
        const lane = laneFor(rec.confidence, rec.status);
        if (!lane) { skipped++; continue; }

        const summary = truncate(rec.title || rec.detail || "（無摘要）", 500);
        const assignee = rec.person ? truncate(rec.person, 100) : null;
        const category = rec.category ? truncate(rec.category, 100) : null;
        // 對到系統帳號才自動歸屬；對不到一律 unclaimed 由主管手動派（doc §2 寧可不歸屬不可歸錯人）
        const resolved = await this.assigneeResolver.resolve(tx, bundle.tenantId, assignee);

        // 冪等 UPSERT · ux_tickets_source_record 撞則 UPDATE
        const res = await tx.execute<{ inserted: boolean }>(sql`
          INSERT INTO tickets (
            tenant_id, department_id, category, summary, confidence, status,
            confirm_status, needs_review, assignee_display_name,
            assignee_user_id, assign_status,
            source_upload_id, source_record_index, message_count
          ) VALUES (
            ${bundle.tenantId}::uuid, ${bundle.departmentId}::uuid,
            ${category}, ${summary}, ${rec.confidence}, ${rec.status ?? null},
            ${lane}, false, ${assignee},
            ${resolved.userId}::uuid, ${resolved.status},
            ${uploadId}, ${idx}, ${rec.source_ids?.length ?? null}
          )
          ON CONFLICT (source_upload_id, source_record_index)
          WHERE source_upload_id IS NOT NULL AND source_record_index IS NOT NULL
          DO UPDATE SET
            category = EXCLUDED.category,
            summary = EXCLUDED.summary,
            confidence = EXCLUDED.confidence,
            status = EXCLUDED.status,
            -- 沒人動過的區可以重算；已簽核／已忽略／逾時是人的決定，重跑不可復活。
            -- 少了這行，主管標「不用追」的事下次分析又冒出來，第二次就沒人要點了（doc F-3）
            -- 用 string_to_array 而非把 JS 陣列丟進 ANY()：Drizzle 會展成 tuple ANY((.,.))，
            --    Postgres 42809。型別檢查看不出來，要 runtime 才炸
            confirm_status = CASE WHEN tickets.confirm_status
                                       = ANY(string_to_array(${RECOMPUTABLE_LANES.join(",")}, ','))
                                  THEN EXCLUDED.confirm_status ELSE tickets.confirm_status END,
            assignee_display_name = EXCLUDED.assignee_display_name,
            -- 重跑不可蓋掉主管已經手動派好的結果（人的決定優先於 AI）
            assignee_user_id = CASE WHEN tickets.assigned_by IS NULL
                                    THEN EXCLUDED.assignee_user_id ELSE tickets.assignee_user_id END,
            assign_status    = CASE WHEN tickets.assigned_by IS NULL
                                    THEN EXCLUDED.assign_status ELSE tickets.assign_status END,
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
