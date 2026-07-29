import { BadRequestException, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { currentTx, type Db } from "../db/client.js";
import { TEMPLATE_REGISTRY, type ExtractionTemplate } from "../conversation-analysis/pipeline/templates.js";
import type { JwtUser } from "../auth/jwt-user.js";

export interface TaskConfig {
  /** 幾天沒簽核算逾時 */
  graceDays: number;
  /** 提醒升級階梯 [normal 上限, aged 上限] */
  tierDays: [number, number];
}

/**
 * ⚠️ 預設值的**唯一**出處。
 * migration 刻意沒給 SQL DEFAULT —— 兩邊各寫一次的話，改了其中一個就會出現
 * 「新租戶 7 天、舊租戶 5 天」這種沒人講得出原因的差異。
 */
export const DEFAULT_TASK_CONFIG: TaskConfig = { graceDays: 7, tierDays: [3, 7] };

const RANGE = { min: 1, max: 90 };

@Injectable()
export class TaskConfigService {
  /**
   * 沒有設定列 = 用預設，不是錯誤。
   * 絕大多數租戶不會去動這組數字，強迫每家都先建一列只會讓 onboarding 多一步。
   */
  async forTenant(tx: Db, tenantId: string | null): Promise<TaskConfig> {
    if (!tenantId) return DEFAULT_TASK_CONFIG;
    const r = await tx.execute<{ overdue_grace_days: number; reminder_tier_days: number[] }>(sql`
      SELECT overdue_grace_days, reminder_tier_days
      FROM tenant_task_config WHERE tenant_id = ${tenantId}::uuid LIMIT 1`);
    const row = r.rows[0];
    if (!row) return DEFAULT_TASK_CONFIG;
    return {
      graceDays: row.overdue_grace_days,
      tierDays: [row.reminder_tier_days[0], row.reminder_tier_days[1]],
    };
  }

  /**
   * 用 RLS 的租戶上下文自己找，不用外面傳 tenantId。
   * ⚠️ 不可以只寫 `SELECT ... LIMIT 1` 靠 RLS 過濾 —— aiproot 的 read policy
   * 有跨租戶逃生門，那樣會撈到**別家**的設定當成自己的。
   */
  async forCurrentTenant(tx: Db): Promise<TaskConfig> {
    const r = await tx.execute<{ overdue_grace_days: number; reminder_tier_days: number[] }>(sql`
      SELECT overdue_grace_days, reminder_tier_days FROM tenant_task_config
      WHERE tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
      LIMIT 1`);
    const row = r.rows[0];
    return row
      ? { graceDays: row.overdue_grace_days, tierDays: [row.reminder_tier_days[0], row.reminder_tier_days[1]] }
      : DEFAULT_TASK_CONFIG;
  }

  /** ⚠️ tenantId 必須是 controller 用 resolveTenantId 解過的，不可直接吃 client 傳的值 */
  async read(tenantId: string): Promise<TaskConfig & {
    isDefault: boolean; template: { key: string; label: string; description: string } | null;
  }> {
    const tx = currentTx();
    const cfg = await this.forTenant(tx, tenantId);
    // 「任務長什麼樣」由抽取模板決定 —— 客戶看得到自己是哪一種，但改由 aiproot 操作
    // （OQ-NAV-10：走 task-config:template，**預設不給**，按客戶成熟度再開）
    const t = await tx.execute<{ extraction_template: string }>(sql`
      SELECT extraction_template FROM tenants WHERE tenant_id = ${tenantId}::uuid LIMIT 1`);
    const key = t.rows[0]?.extraction_template ?? null;
    const meta = key && key in TEMPLATE_REGISTRY ? TEMPLATE_REGISTRY[key as ExtractionTemplate] : null;
    // isDefault 讓 UI 能說「目前用平台預設」而不是假裝這是客戶設過的值
    const same = cfg.graceDays === DEFAULT_TASK_CONFIG.graceDays
      && cfg.tierDays[0] === DEFAULT_TASK_CONFIG.tierDays[0]
      && cfg.tierDays[1] === DEFAULT_TASK_CONFIG.tierDays[1];
    return {
      ...cfg,
      isDefault: same,
      template: meta ? { key: key!, label: meta.label, description: meta.description } : null,
    };
  }

  /**
   * 改設定會**即時影響歷史任務**的「逾時 N 天」（OQ-NAV-8 裁定：即時重算）。
   * 所以回傳受影響筆數，讓 UI 能在改動後說清楚動到了什麼（N-6）。
   * 稽核由 TenantTxInterceptor 每請求寫一筆（R5），這裡不重複寫。
   */
  async update(user: JwtUser, tenantId: string, body: {
    graceDays: number; tierDays: [number, number];
  }): Promise<TaskConfig & { affectedTickets: number }> {
    const { graceDays, tierDays } = validate(body);
    const tx = currentTx();

    await tx.execute(sql`
      INSERT INTO tenant_task_config
        (tenant_id, overdue_grace_days, reminder_tier_days, updated_by)
      VALUES (${tenantId}::uuid, ${graceDays},
              ARRAY[${tierDays[0]}, ${tierDays[1]}]::int[], ${user.user_id}::uuid)
      ON CONFLICT (tenant_id) DO UPDATE SET
        overdue_grace_days = EXCLUDED.overdue_grace_days,
        reminder_tier_days = EXCLUDED.reminder_tier_days,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by`);

    // ⚠️ 條件必須跟看板的逾時欄**完全一致**（warroom-tasks.service.ts：
    //    confirm_status = 待簽核 且 已過期）。第一版寫成 `status <> 'closed'`，
    //    而 status 多半是 NULL —— `NULL <> 'closed'` 的結果是 NULL，整批被濾掉，
    //    於是 toast 說「沒有任務落在逾時範圍」而看板同時顯示「逾時 15 天」。
    //    數字對不上比沒有數字更糟：它會讓人不再相信畫面上的其他數字。
    const r = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM tickets
      WHERE confirm_status = '待簽核'
        AND (
          (due_at IS NOT NULL AND due_at < now())
          OR (due_at IS NULL AND created_at < now() - make_interval(days => ${graceDays}))
        )`);

    return { graceDays, tierDays, affectedTickets: r.rows[0]?.n ?? 0 };
  }
}

function validate(b: { graceDays: number; tierDays: [number, number] }): TaskConfig {
  const nums = [b.graceDays, b.tierDays?.[0], b.tierDays?.[1]];
  if (nums.some((n) => !Number.isInteger(n) || n < RANGE.min || n > RANGE.max)) {
    throw new BadRequestException(`天數需為 ${RANGE.min}–${RANGE.max} 的整數`);
  }
  if (b.tierDays[0] >= b.tierDays[1]) {
    // 寫反了不會報錯但 tierFor 會永遠回同一級 —— 失敗跟成功長得一樣，所以擋在入口
    throw new BadRequestException("提醒階梯的第一段要小於第二段");
  }
  return { graceDays: b.graceDays, tierDays: [b.tierDays[0], b.tierDays[1]] };
}
