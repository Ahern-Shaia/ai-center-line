import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { withSystemTx } from "../db/client.js";
import { AnalysisBatchRepository } from "./analysis-batch.repository.js";
import { AnalysisBatchService } from "./analysis-batch.service.js";
import { BatchSchedulerService } from "./batch-scheduler.service.js";

/**
 * 對話分析歷程 · aiproot 專屬 · CAR-M3-2
 *
 * Endpoint:
 * - GET  /aiproot-console/batches?tenantId=<uuid>       · list batches
 * - POST /aiproot-console/batches/rerun                  · 手動重跑指定 (tenant, group, date)
 * - POST /aiproot-console/batches/run-pending            · 掃 pending 全跑 (cron 手動觸發)
 */
@Controller("aiproot-console/batches")
export class AnalysisBatchController {
  constructor(
    private readonly batchRepo: AnalysisBatchRepository,
    private readonly batchService: AnalysisBatchService,
    private readonly scheduler: BatchSchedulerService,
  ) {}

  @Get()
  @Roles("aiproot_admin", "consultant")
  async list(@Query("tenantId") tenantId?: string) {
    const rows = await withSystemTx((tx) => this.batchRepo.listByTenant(tx, { tenantId, limit: 200 }));
    return { batches: rows };
  }

  @Post("rerun")
  @Roles("aiproot_admin")
  async rerun(
    @Body() body: { tenantId: string; groupId: string; batchDate: string },
    @CurrentUser() user: JwtUser,
  ) {
    const triggeredBy = `manual:${user.user_id}`;
    const result = await this.batchService.runBatch({
      tenantId: body.tenantId,
      groupId: body.groupId,
      batchDate: body.batchDate,
      triggeredBy,
    });
    return result;
  }

  @Post("run-pending")
  @Roles("aiproot_admin")
  async runPending(
    @Body() body: { lookbackDays?: number },
    @CurrentUser() user: JwtUser,
  ) {
    const triggeredBy = `manual:${user.user_id}`;
    return this.scheduler.runPending(triggeredBy, body.lookbackDays ?? 2);
  }
}
