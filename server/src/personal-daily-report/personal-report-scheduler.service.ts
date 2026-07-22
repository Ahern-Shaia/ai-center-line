import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import PQueue from "p-queue";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/client.js";
import { PersonalDailyReportService } from "./personal-daily-report.service.js";

/**
 * PersonalReportSchedulerService · PDR-M3
 * 對照 docs/modules/personal-daily-report.md §6
 *
 * 每日 17:30 台北 · 掃全綁定 user · 逐個生成日報
 * · PQueue 5 · 避免 LLM 併發爆
 * · 只掃 tenant.batch_enabled=true 的 tenant (config 對齊 warroom 一致)
 * · env PDR_SCHEDULER_ENABLED=false 可 kill
 */
@Injectable()
export class PersonalReportSchedulerService {
  private readonly logger = new Logger(PersonalReportSchedulerService.name);

  constructor(
    private readonly reportService: PersonalDailyReportService,
  ) {}

  @Cron("30 17 * * *", { timeZone: "Asia/Taipei" })
  async handleDailyGeneration(): Promise<void> {
    if (process.env.PDR_SCHEDULER_ENABLED === "false") {
      this.logger.log("PDR_SCHEDULER_ENABLED=false · skip");
      return;
    }
    const today = getTaipeiDate();
    await this.runForDate(today);
  }

  /**
   * 手動觸發 · aiproot 「重新生成」用 (M4 UI)
   * · 若 reportDate 缺 · 用今日
   */
  async runForDate(reportDate: string): Promise<{ total: number; succeeded: number; empty: number; failed: number }> {
    // Step 1 · 撈全綁定 user list (aiproot_admin 跨租戶讀)
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
    `));

    const rows = users.rows;
    this.logger.log(`PDR scheduler · ${reportDate} · ${rows.length} bound users to scan`);

    // Step 2 · PQueue concurrency 5
    const queue = new PQueue({ concurrency: 5 });
    let succeeded = 0, empty = 0, failed = 0;

    await Promise.all(rows.map((r) => queue.add(async () => {
      const res = await this.reportService.generate({
        tenantId: r.tenant_id,
        userId: r.user_id,
        reportDate,
      });
      if (res.status === "completed") succeeded++;
      else if (res.status === "empty") empty++;
      else failed++;
    })));

    this.logger.log(`PDR scheduler done · date=${reportDate} · ok=${succeeded} empty=${empty} failed=${failed}`);
    return { total: rows.length, succeeded, empty, failed };
  }
}

function getTaipeiDate(): string {
  const now = new Date();
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });   // en-CA → YYYY-MM-DD
}
