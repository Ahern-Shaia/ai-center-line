import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";
import { LineApiClient } from "../line-ingest/line-api.client.js";

/**
 * PersonalReportNotifyService · PDR-M5
 * 對照 docs/modules/personal-daily-report.md §7.2
 *
 * 員工送出日報後 · 私訊通知主管 (group_owner + tenant_admin) · 走 LINE bot push
 * · fire-and-forget · 通知失敗不 raise (save 已成功)
 * · 主管需已綁定 LINE (走 user_line_binding)
 * · aiproot_admin 不通知 (無關業務)
 */
@Injectable()
export class PersonalReportNotifyService {
  private readonly logger = new Logger(PersonalReportNotifyService.name);

  constructor(
    private readonly lineApi: LineApiClient,
  ) {}

  async notifySubmission(args: {
    reportId: string;
    tenantId: string;
    userId: string;         // 員工 (送出者)
    itemCount: number;
    reportDate: string;
  }): Promise<void> {
    try {
      // Step 1 · 撈受通知者：該員工的部門主管 + tenant_admin
      // 撈他們的 LINE binding (若沒綁定 · skip 該人)
      const recipients = await withTenant({ tenantId: args.tenantId, role: "tenant_admin" }, (tx) => tx.execute<{
        user_id: string;
        display_name: string | null;
        bot_id: string;
        line_user_id: string;
        access_token_enc: string;
        role: string;
      }>(sql`
        WITH employee_dept AS (
          SELECT u.department_id FROM users u WHERE u.user_id = ${args.userId}::uuid
        )
        SELECT DISTINCT u.user_id::text,
               u.display_name,
               b.bot_id::text,
               b.line_user_id,
               pgp_sym_decrypt(lb.channel_access_token_enc, ${process.env.LINE_CONFIG_ENC_KEY ?? "test-only-line-enc-key-32chars---"}) AS access_token_enc,
               u.role
        FROM users u
        JOIN user_line_binding b ON b.user_id = u.user_id AND b.status = 'active'
        JOIN line_bot lb ON lb.bot_id = b.bot_id
        WHERE u.tenant_id = ${args.tenantId}::uuid
          AND (
            u.role = 'tenant_admin'
            OR (u.role = 'group_owner' AND u.department_id = (SELECT department_id FROM employee_dept))
          )
          AND u.user_id != ${args.userId}::uuid   -- 不通知員工自己
      `));

      if (recipients.rows.length === 0) {
        this.logger.log(`PDR notify · reportId=${args.reportId} · 0 recipients (主管未綁 LINE · 靜默 skip)`);
        return;
      }

      // Step 2 · 找員工姓名 (通知內文用)
      const emp = await withTenant({ tenantId: args.tenantId, role: "tenant_admin" }, (tx) => tx.execute<{ display_name: string | null }>(sql`
        SELECT display_name FROM users WHERE user_id = ${args.userId}::uuid
      `));
      const empName = emp.rows[0]?.display_name ?? "員工";

      // Step 3 · 逐個 push
      const messageText = `📋 ${empName} 已送出 ${args.reportDate} 個人日報 · ${args.itemCount} 項\n進「戰情室 → 部門日報」查看`;
      let ok = 0, fail = 0;
      for (const r of recipients.rows) {
        try {
          await this.lineApi.pushMessage(r.access_token_enc, r.line_user_id, [
            { type: "text", text: messageText },
          ]);
          ok++;
        } catch (err) {
          fail++;
          this.logger.warn(`PDR notify · push 失敗 · to=${r.display_name} · ${(err as Error).message}`);
        }
      }
      this.logger.log(`PDR notify · reportId=${args.reportId} · ok=${ok} fail=${fail}`);
    } catch (err) {
      this.logger.error(`PDR notify · unrecovered · ${(err as Error).message}`);
    }
  }
}
