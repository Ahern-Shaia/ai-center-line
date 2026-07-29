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
        source_message_ids: string[] | null;
      }>(sql`
        SELECT au.tenant_id::text, au.group_id, lg.department_id::text, au.source_message_ids
        FROM analysis_upload au
        LEFT JOIN line_bot lb ON lb.tenant_id = au.tenant_id
        LEFT JOIN line_group lg ON lg.bot_id = lb.bot_id AND lg.group_id = au.group_id
        WHERE au.id = ${uploadId}
        LIMIT 1
      `);
      const uploadRow = upload.rows[0];
      if (!uploadRow) return null;

      const result = await tx.execute<{ records: unknown; message_count: number }>(sql`
        SELECT records, jsonb_array_length(messages) AS message_count
        FROM analysis_result WHERE upload_id = ${uploadId} LIMIT 1
      `);
      return {
        tenantId: uploadRow.tenant_id,
        groupId: uploadRow.group_id,
        departmentId: uploadRow.department_id,
        sourceMessageIds: uploadRow.source_message_ids,
        parsedMessageCount: result.rows[0]?.message_count ?? 0,
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

    // 0035 · M1 · 索引 → 真實 LINE 訊息 id 的對照表。
    // ⚠️ 只有在「parser 解出來的則數」與「來源訊息數」一致時才敢用 ——
    //    formatAsLineExport 每則輸出一行，正常情況下相等；不相等代表有行被合併或吃掉，
    //    那時候照索引翻會**錯位歸到別則訊息**，寧可留 null 也不要給錯的溯源。
    const idMap = bundle.sourceMessageIds;
    const idMapUsable = !!idMap && idMap.length === bundle.parsedMessageCount && idMap.length > 0;
    if (idMap && !idMapUsable) {
      this.logger.warn(
        `materialize · upload=${uploadId} 訊息數對不上（來源 ${idMap.length} vs 解析 ${bundle.parsedMessageCount}）· 本批不寫 source_message_ids`,
      );
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
        //
        // ⚠️ 對到之後**刻意不發 LINE 通知**（2026-07-29 用戶裁定）。不是漏接，不要「修好」它 ——
        //    只讓它出現在當事人的個人日報裡。
        //    理由：AI 判斷歸屬的準確度**從來沒有量測過**，而主動私訊是打擾人，
        //    打擾錯的人比不打擾貴得多。人工指派會推播，是因為那是**主管做的決定**、有人負責
        //    （界線見 docs/modules/task-assign-notify.md §2.2）。
        //    要開之前的前置條件是先量測準確度；接法就是在這裡呼叫 AssignNotifyService.onAssigned，
        //    很短，所以現在不預先加 config flag —— 沒人用的開關只會變成要維護的死碼。
        //
        // ⚠️ 對不到帳號（unclaimed）在試用期是**預期狀態**，不是缺陷：
        //    正式導入的前提就是全員綁定 LINE。**不可以**改用暱稱模糊比對去提高覆蓋率，
        //    那會直接踩 A-2（P0）把任務指派給錯的人、而且他會收到私訊。
        const resolved = await this.assigneeResolver.resolve(tx, bundle.tenantId, assignee);

        // R11 可溯源 · 把 source_ids 的索引翻成真實訊息 id（越界的丟掉不硬湊）
        const srcMsgIds = idMapUsable
          ? (rec.source_ids ?? [])
              .map((i) => idMap![i])
              .filter((v): v is string => typeof v === "string")
          : null;

        // 冪等 UPSERT · ux_tickets_source_record 撞則 UPDATE
        const res = await tx.execute<{ inserted: boolean }>(sql`
          INSERT INTO tickets (
            tenant_id, department_id, category, summary, confidence, status,
            confirm_status, needs_review, assignee_display_name,
            assignee_user_id, assign_status,
            source_upload_id, source_record_index, message_count,
            source_message_ids
          ) VALUES (
            ${bundle.tenantId}::uuid, ${bundle.departmentId}::uuid,
            ${category}, ${summary}, ${rec.confidence}, ${rec.status ?? null},
            ${lane}, false, ${assignee},
            ${resolved.userId}::uuid, ${resolved.status},
            ${uploadId}, ${idx}, ${rec.source_ids?.length ?? null},
            ${textArray(srcMsgIds)}
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
            -- 翻不出來時（EXCLUDED 為 null）保留舊值，不要把已經有的溯源洗掉
            source_message_ids = COALESCE(EXCLUDED.source_message_ids, tickets.source_message_ids),
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

/**
 * JS 字串陣列 → Postgres text[]
 *
 * ⚠️ 不能把陣列直接丟進 Drizzle 的 sql 模板：它會序列化成字串，
 * Postgres 回 22P02「Array value must start with "{"」。型別檢查看不出來。
 * （同一個坑的另一種形態：`= ANY(${jsArray})` 會展成 tuple → 42809）
 *
 * 走 jsonb 中轉而不是 string_to_array —— 後者遇到內容含分隔符就會裂開。
 */
function textArray(v: string[] | null) {
  return v === null
    ? sql`NULL::text[]`
    : sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(v)}::jsonb))::text[]`;
}
