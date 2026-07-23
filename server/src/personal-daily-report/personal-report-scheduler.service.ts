import { Injectable, Logger } from "@nestjs/common";
import PQueue from "p-queue";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";
import { PersonalDailyReportService } from "./personal-daily-report.service.js";

/**
 * PersonalReportSchedulerService · PDR-M3
 * 對照 docs/modules/personal-daily-report.md §6
 *
 * 平台化後（scheduler-config M2）· @Cron decorator 已移除
 * · 由 SchedulerManager 依 scheduler_config 表動態註冊 CronJob
 * · 保留 runForDate 作為純 executor · 由 SchedulerManager.dispatch / 手動 endpoint 呼叫
 * · PQueue 5 · 避免 LLM 併發爆
 * · 只掃 tenant.batch_enabled=true 的 tenant
 */
@Injectable()
export class PersonalReportSchedulerService {
  private readonly logger = new Logger(PersonalReportSchedulerService.name);

  constructor(
    private readonly reportService: PersonalDailyReportService,
  ) {}

  /**
   * 手動觸發 · aiproot 「重新生成」用 · 或 SchedulerManager 呼叫
   * · tenantId 傳則 scope 到單 tenant · 未傳掃全 tenant
   */
  async runForDate(
    reportDate: string,
    tenantId?: string,
    excludeTenants?: Set<string>,
  ): Promise<{ total: number; succeeded: number; empty: number; failed: number; skipped: number }> {
    // Step 1 · 撈綁定 user list (aiproot_admin 跨租戶讀)
    const tenantFilter = tenantId
      ? sql`AND u.tenant_id = ${tenantId}::uuid`
      : sql``;
    const users = await withTenant({ tenantId: null, role: "aiproot_admin" }, (tx) => tx.execute<{
      tenant_id: string;
      user_id: string;
    }>(sql`
      SELECT DISTINCT b.user_id::text AS user_id, u.tenant_id::text AS tenant_id
      FROM user_line_binding b
      JOIN users u ON u.user_id = b.user_id
      JOIN tenants t ON t.tenant_id = u.tenant_id
      WHERE b.status = 'active'
        AND t.batch_enabled = true
        ${tenantFilter}
    `));

    // P1-fix D4 · 排除已有 override 的 tenant
    const filteredRows = excludeTenants && excludeTenants.size > 0
      ? users.rows.filter((r) => !excludeTenants.has(r.tenant_id))
      : users.rows;
    const skipped = users.rows.length - filteredRows.length;

    this.logger.log(`PDR scheduler · ${reportDate} · ${filteredRows.length} to scan (skipped ${skipped} · has override)`);

    // Step 2 · PQueue concurrency 5
    const queue = new PQueue({ concurrency: 5 });
    let succeeded = 0, empty = 0, failed = 0;

    await Promise.all(filteredRows.map((r) => queue.add(async () => {
      const res = await this.reportService.generate({
        tenantId: r.tenant_id,
        userId: r.user_id,
        reportDate,
      });
      if (res.status === "completed") succeeded++;
      else if (res.status === "empty") empty++;
      else failed++;
    })));

    this.logger.log(`PDR scheduler done · date=${reportDate} · ok=${succeeded} empty=${empty} failed=${failed} skipped=${skipped}`);
    return { total: filteredRows.length, succeeded, empty, failed, skipped };
  }
}
