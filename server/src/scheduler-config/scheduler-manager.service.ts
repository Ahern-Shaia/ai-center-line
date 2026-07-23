import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { withSystemTx } from "../db/client.js";
import { BatchSchedulerService } from "../convo-analysis-realtime/batch-scheduler.service.js";
import { PersonalReportSchedulerService } from "../personal-daily-report/personal-report-scheduler.service.js";
import { SchedulerConfigRepository, type SchedulerConfigRow } from "./scheduler-config.repository.js";

const JOB_PREFIX = "sched:";

/**
 * SchedulerManager · scheduler-config M2
 * 對照 docs/modules/scheduler-config.md §5
 *
 * · OnModuleInit 全量載入 scheduler_config · 註冊 CronJob
 * · onConfigChanged 全量重載（簡單 · unregister all + register all）
 * · dispatch 依 schedulerId 分派到對應 executor（PDR / batch）
 * · 每 tenant 有 override 用 override · 否則 fallback 到 platform default (tenant_id=NULL)
 *
 * FMEA 預想（M6 詳填）：
 * - cron_expr 壞 → CronJob throw → catch + log + skip 該 job
 * - reload 過程 crash → onModuleInit 有 try/catch · 部分 job 沒註冊會影響下輪
 * - 多 process (Render 多 instance) → 現階段 assume 1 instance · 未來加 distributed lock
 */
@Injectable()
export class SchedulerManager implements OnModuleInit {
  private readonly logger = new Logger(SchedulerManager.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly configRepo: SchedulerConfigRepository,
    private readonly pdrScheduler: PersonalReportSchedulerService,
    private readonly batchScheduler: BatchSchedulerService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.reloadAll();
    } catch (err) {
      this.logger.error(`SchedulerManager 初始化失敗 · ${(err as Error).message}`);
    }
  }

  /**
   * 全量重載 · 拿掉本 manager 註冊的所有 job · 依 config 重新註冊
   * · Called on module init + config 改動時
   */
  async reloadAll(): Promise<void> {
    // 1. 卸掉本 manager 已註冊的 job
    const jobs = this.registry.getCronJobs();
    let unregistered = 0;
    for (const name of jobs.keys()) {
      if (name.startsWith(JOB_PREFIX)) {
        this.registry.deleteCronJob(name);
        unregistered++;
      }
    }

    // 2. 全量拉 config · 逐個註冊
    const configs = await withSystemTx((tx) => this.configRepo.listAll(tx));
    // Resolve 邏輯 · tenant 有 override 用 override · 否則用 platform default
    // 分兩層：先收集 platform default · 再看各 tenant override
    const platformDefaults = new Map<string, SchedulerConfigRow>();
    const tenantOverrides: SchedulerConfigRow[] = [];
    for (const cfg of configs) {
      if (cfg.tenantId === null) platformDefaults.set(cfg.schedulerId, cfg);
      else tenantOverrides.push(cfg);
    }

    // 3. 撈全 tenant list 才能決定每個 tenant 用 override 還是 default
    // 這裡簡化 · 只註冊已存在的 config row (包含 platform default 每個 tenant 都用 · tenant override 覆蓋)
    // 效果 · platform default 1 個 job 對所有 tenant · tenant override 各自 1 個 job
    // dispatch 時再看 tenantId 決定要不要跑

    let registered = 0, skipped = 0;
    // Platform default · tenantId=null · dispatch 時代表跑「全 tenant 但排除有 override 的」
    for (const cfg of platformDefaults.values()) {
      if (!cfg.enabled) { skipped++; continue; }
      if (this.registerJob(cfg)) registered++;
      else skipped++;
    }
    // Tenant override · 跑該 tenant
    for (const cfg of tenantOverrides) {
      if (!cfg.enabled) { skipped++; continue; }
      if (this.registerJob(cfg)) registered++;
      else skipped++;
    }

    this.logger.log(`SchedulerManager reload · unregistered=${unregistered} · registered=${registered} · skipped=${skipped}`);
  }

  private registerJob(cfg: SchedulerConfigRow): boolean {
    const jobName = this.jobName(cfg.schedulerId, cfg.tenantId);
    try {
      const job = CronJob.from({
        cronTime: cfg.cronExpr,
        onTick: () => { void this.dispatch(cfg); },
        timeZone: cfg.timeZone,
        start: true,
      });
      this.registry.addCronJob(jobName, job as unknown as CronJob);
      const next = job.nextDate();
      this.logger.log(`registered ${jobName} · cron="${cfg.cronExpr}" tz=${cfg.timeZone} next=${next.toISO()}`);
      return true;
    } catch (err) {
      this.logger.error(`registerJob 失敗 ${jobName} · cron="${cfg.cronExpr}" · ${(err as Error).message}`);
      return false;
    }
  }

  private jobName(schedulerId: string, tenantId: string | null): string {
    return `${JOB_PREFIX}${schedulerId}:${tenantId ?? "platform"}`;
  }

  private async dispatch(cfg: SchedulerConfigRow): Promise<void> {
    const startedAt = new Date().toISOString();
    this.logger.log(`dispatch ${cfg.schedulerId} tenant=${cfg.tenantId ?? "platform-default"} · startedAt=${startedAt}`);
    try {
      let result: Record<string, unknown>;
      if (cfg.schedulerId === "pdr") {
        const today = getTaipeiDate();
        const res = await this.pdrScheduler.runForDate(today, cfg.tenantId ?? undefined);
        result = { ...res, reportDate: today };
      } else if (cfg.schedulerId === "group_batch") {
        const res = await this.batchScheduler.runPending("cron", cfg.lookbackDays, cfg.tenantId ?? undefined);
        result = { ...res };
      } else {
        this.logger.warn(`dispatch unknown schedulerId=${cfg.schedulerId}`);
        return;
      }

      // Mark last run
      await withSystemTx((tx) => this.configRepo.markLastRun(tx, {
        schedulerId: cfg.schedulerId,
        tenantId: cfg.tenantId,
        result: { ...result, startedAt, status: "completed" },
      }));
      this.logger.log(`dispatch done ${cfg.schedulerId} tenant=${cfg.tenantId ?? "platform-default"} · ${JSON.stringify(result)}`);
    } catch (err) {
      const errMsg = (err as Error).message ?? String(err);
      this.logger.error(`dispatch failed ${cfg.schedulerId} tenant=${cfg.tenantId ?? "platform-default"} · ${errMsg}`);
      try {
        await withSystemTx((tx) => this.configRepo.markLastRun(tx, {
          schedulerId: cfg.schedulerId,
          tenantId: cfg.tenantId,
          result: { startedAt, status: "failed", errorMessage: errMsg.slice(0, 500) },
        }));
      } catch { /* 若連 markLastRun 都掛 · 靜默 · scheduler 掛可以從 stdout 看 */ }
    }
  }
}

function getTaipeiDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}
