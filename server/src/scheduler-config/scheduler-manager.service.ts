import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { sql } from "drizzle-orm";
import { withSystemTx } from "../db/client.js";
import { BatchSchedulerService } from "../convo-analysis-realtime/batch-scheduler.service.js";
import { PersonalReportSchedulerService } from "../personal-daily-report/personal-report-scheduler.service.js";
import { SchedulerConfigRepository, type SchedulerConfigRow, type SchedulerId } from "./scheduler-config.repository.js";

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

  /**
   * P1-fix D3 · Multi-instance double run
   * 用 pg_try_advisory_lock 讓多 pod 情境只有一個拿到鎖
   * · lock key = schedulerId + tenantId 的 hash · int8 (postgres advisory lock 用)
   * · try_advisory_lock 拿不到 → 靜默 return · 讓另一 pod 跑
   */
  private lockKey(schedulerId: SchedulerId, tenantId: string | null): bigint {
    // FNV-1a 64-bit hash → BigInt
    const key = `${schedulerId}:${tenantId ?? "platform"}`;
    let h = 14695981039346656037n;
    for (let i = 0; i < key.length; i++) {
      h ^= BigInt(key.charCodeAt(i));
      h = (h * 1099511628211n) & 0xffffffffffffffffn;
    }
    // Postgres advisory lock 用 int8 (bigint) · 範圍 -2^63 ~ 2^63-1
    return h > 0x7fffffffffffffffn ? h - 0x10000000000000000n : h;
  }

  /**
   * P1-fix D4 · Platform default vs tenant override 排除
   * 撈已有 override 的 tenant list · dispatch 時排除
   */
  private async listOverriddenTenants(schedulerId: SchedulerId): Promise<Set<string>> {
    const rows = await withSystemTx((tx) => tx.execute<{ tenant_id: string }>(sql`
      SELECT tenant_id::text
      FROM scheduler_config
      WHERE scheduler_id = ${schedulerId}
        AND tenant_id IS NOT NULL
        AND enabled = true
    `));
    return new Set(rows.rows.map((r) => r.tenant_id));
  }

  private async dispatch(cfg: SchedulerConfigRow): Promise<void> {
    const startedAt = new Date().toISOString();

    // P1-fix D3 · advisory lock · multi-pod 只讓一個跑
    const lockKey = this.lockKey(cfg.schedulerId, cfg.tenantId);
    const lockRes = await withSystemTx((tx) => tx.execute<{ locked: boolean }>(sql`
      SELECT pg_try_advisory_lock(${lockKey.toString()}::bigint) AS locked
    `));
    if (!lockRes.rows[0]?.locked) {
      this.logger.log(`dispatch ${cfg.schedulerId} tenant=${cfg.tenantId ?? "platform-default"} · another instance holds lock · skip`);
      return;
    }

    try {
      this.logger.log(`dispatch ${cfg.schedulerId} tenant=${cfg.tenantId ?? "platform-default"} · startedAt=${startedAt}`);
      let result: Record<string, unknown>;

      // P1-fix D4 · Platform default 跑時排除有 override 的 tenant
      const excludeTenants = cfg.tenantId === null
        ? await this.listOverriddenTenants(cfg.schedulerId)
        : new Set<string>();

      if (cfg.schedulerId === "pdr") {
        const today = getTaipeiDate();
        const res = await this.pdrScheduler.runForDate(today, cfg.tenantId ?? undefined, excludeTenants);
        result = { ...res, reportDate: today, excludedTenants: [...excludeTenants] };
      } else if (cfg.schedulerId === "group_batch") {
        const res = await this.batchScheduler.runPending("cron", cfg.lookbackDays, cfg.tenantId ?? undefined, excludeTenants);
        result = { ...res, excludedTenants: [...excludeTenants] };
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
    } finally {
      // 釋放 advisory lock · 讓下次 fire 可拿到
      try {
        await withSystemTx((tx) => tx.execute(sql`SELECT pg_advisory_unlock(${lockKey.toString()}::bigint)`));
      } catch { /* 忽略 · session 結束 lock 自動釋放 */ }
    }
  }
}

function getTaipeiDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}
