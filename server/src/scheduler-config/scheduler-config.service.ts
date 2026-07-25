import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { CronJob } from "cron";
import { currentTx } from "../db/client.js";
import type { JwtUser } from "../auth/jwt-user.js";
import { SchedulerConfigRepository, type SchedulerConfigRow, type SchedulerId } from "./scheduler-config.repository.js";
import type { SchedulerManager } from "./scheduler-manager.service.js";

/**
 * SchedulerConfigService · scheduler-config M2
 * · list · read · upsert 三個入口
 * · 欄位級 whitelist · tenant_admin 不能改成本控管欄位（concurrency / lookback_days）
 * · Upsert 完呼 SchedulerManager.reloadAll 讓 CronJob 立即 reschedule
 */
@Injectable()
export class SchedulerConfigService {
  private manager: SchedulerManager | null = null;

  constructor(
    private readonly repo: SchedulerConfigRepository,
  ) {}

  // SchedulerManager 有 circular reference 風險 · 用 setter 在 module wire 時注入
  setManager(manager: SchedulerManager): void {
    this.manager = manager;
  }

  async list(user: JwtUser): Promise<Array<SchedulerConfigRow & { nextRunAt: string | null }>> {
    const rows = await this.repo.list(currentTx(), user.tenant_id);
    // 下次觸發時間：讓使用者不必看懂 cron 也能確認自己設對（見 scheduler-config UI 小白化）
    return rows.map((r) => ({ ...r, nextRunAt: nextRunOf(r.cronExpr, r.timeZone, r.enabled) }));
  }

  async upsert(user: JwtUser, args: {
    schedulerId: SchedulerId;
    tenantId: string | null;
    enabled: boolean;
    cronExpr: string;
    timeZone: string;
    minSourceCount: number;
    lookbackDays: number;
    concurrency: number;
  }): Promise<SchedulerConfigRow> {
    // 1. Validate cron_expr
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _testJob = CronJob.from({ cronTime: args.cronExpr, onTick: () => undefined, timeZone: args.timeZone, start: false });
    } catch (err) {
      throw new BadRequestException(`cron 表達式格式錯 · ${(err as Error).message}`);
    }

    // 2. Whitelist 欄位 · tenant_admin 不能改 concurrency / lookback_days
    const isPlatformScope = args.tenantId === null;
    const isAiproot = user.role === "aiproot_admin";
    if (isPlatformScope && !isAiproot) {
      throw new ForbiddenException("只有 aiproot_admin 可改 platform default (tenant_id=NULL)");
    }
    if (!isAiproot) {
      // tenant_admin · 撈原 row · concurrency / lookback_days 強制沿用舊值 (若有) 或 platform default
      const existing = await this.repo.resolveForTenant(currentTx(), args.schedulerId, args.tenantId);
      if (existing) {
        args.concurrency = existing.concurrency;
        args.lookbackDays = existing.lookbackDays;
      }
    }

    // 3. Validate range
    if (args.minSourceCount < 0) throw new BadRequestException("min_source_count 不可 < 0");
    if (args.lookbackDays < 0 || args.lookbackDays > 30) throw new BadRequestException("lookback_days 需 0-30");
    if (args.concurrency < 1 || args.concurrency > 20) throw new BadRequestException("concurrency 需 1-20");

    // 4. Upsert
    const row = await this.repo.upsert(currentTx(), {
      ...args,
      updatedBy: user.user_id,
    });

    // 5. 通知 SchedulerManager 重排 · fire-and-forget
    if (this.manager) {
      void this.manager.reloadAll().catch(() => undefined);
    }

    return row;
  }
}

/** 依 cron + 時區算下次觸發時間（停用或 cron 壞 → null）*/
export function nextRunOf(cronExpr: string, timeZone: string, enabled: boolean): string | null {
  if (!enabled) return null;
  try {
    const job = CronJob.from({ cronTime: cronExpr, onTick: () => undefined, timeZone, start: false });
    return job.nextDate().toISO();
  } catch {
    return null;
  }
}
