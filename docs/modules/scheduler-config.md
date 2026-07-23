# scheduler-config.md — [Phase 2-1] 定時任務設定平台化 · 設計文件

> ✅ **狀態：SHIPPED（v1.0 · 2026-07-23）· M1–M6 完成 · P0 全清**
>
> 現行兩個 scheduler（個人日報 17:30 / 群組日誌 08:00）用 `@Cron` decorator 硬編時間 · 也硬編權限（僅 aiproot 可手動觸發）。用戶要求：(1) tenant_admin 可手動觸發自 tenant 分析；(2) 時間 / 啟用狀態 / 跳過條件從 DB config 讀 · 前端可設；(3) 動態 reschedule · 不需重啟。
>
> 作者：Claude Code（草擬）
> 版本：v0.1（2026-07-23）

---

## 1. 目標與範圍

### 1.1 目標

1. **平台化 scheduler config**：兩個 scheduler（PDR / group_batch）的**觸發時間 / 啟用狀態 / 跳過條件 / lookback / 併發**從 DB `scheduler_config` 表讀 · 非 hard-code
2. **動態 reschedule**：config 改動經 UI 儲存 → 系統立即 unregister + re-register CronJob · 不需重啟 Nest process
3. **tenant_admin 可手動觸發自 tenant 分析**：現 `POST /aiproot-console/batches/rerun` 僅 aiproot · 新增 `POST /warroom/batches/rerun` 給 tenant_admin（RLS 限自 tenant）
4. **UI 讓管理員自服務調整**：`設定 → 租戶設定 → 定時任務` 子頁 + 戰情室今日日誌 pane-hdr 加「立即分析」按鈕
5. **權限分層**：tenant_admin 可改自 tenant 時間 / 啟用 / 跳過門檻 · **成本控管欄位（併發 / lookback）僅 aiproot 可改** · 平台成本控管

### 1.2 對應主管 / Stakeholder 訴求

| 子題 | 主要訴求 | 對應點 |
|---|---|---|
| A1 config schema | 客戶自控 · 不同工廠日常節奏不同 | 委員鐵律「客戶不受工程配合限制」 |
| A2 dynamic reschedule | 改設定不能停系統 | Render deployment 冷啟 30-60s · 用戶等不得 |
| A3 tenant_admin 手動觸發 | 主管突發需求（會前一 hour 想看今日活動） | 「當日突發訊息潮」不能等隔天 08:00 |
| A4 UI 自服務 | tenant_admin 不用發 ticket 給 aiproot | 每次改設定寫工單成本高 |
| A5 權限分層 | 成本控管留 aiproot | 併發 / lookback 直接影響 AI API 成本 |

### 1.3 不做的事

- ❌ **不引入外部 scheduler 服務**（Airflow / Temporal） · 現有 `@nestjs/schedule` 的 `SchedulerRegistry` 足以支撐 dynamic reschedule
- ❌ **不改 scheduler 的 core logic**（`runForDate` / `runPending` 內部） · 本次只換觸發層
- ❌ **不做 platform-wide default config UI** · 首版只做 per-tenant · aiproot 若要改全站 default 直接改 DB row（tenant_id=NULL 那筆）
- ❌ **不加新 scheduler 類型** · 只把現有兩個平台化 · 未來新增 scheduler 走同 pattern

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況 | Gap |
|---|---|---|
| PDR scheduler | ✅ `personal-report-scheduler.service.ts` · `@Cron("30 17 * * *", tz='Asia/Taipei')` hard-code | 需改成從 DB 讀 · SchedulerRegistry 動態註冊 |
| Group scheduler | ✅ `batch-scheduler.service.ts` · `@Cron("0 0 * * *", tz='Asia/Taipei')` = 08:00 · hard-code | 同上 |
| PDR 手動觸發 | ✅ `POST /personal-daily-report/aiproot/run-scheduler` · `@Roles("aiproot_admin")` | 已有 aiproot 入口 · 是否延伸給 tenant_admin? OQ-SCH-4 |
| Group 手動觸發 | ✅ `POST /aiproot-console/batches/rerun` · `@Roles("aiproot_admin")` | 需新 endpoint 給 tenant_admin |
| Config schema | ❌ 無 | 新表 `scheduler_config` |
| Config UI | ❌ 無 | 新頁面 |
| Dynamic reschedule | ❌ 無 · 現行 `@Cron` decorator 只在 process 啟動時註冊一次 | 用 `SchedulerRegistry.addCronJob` / `deleteCronJob` API |
| Permission model | ✅ Permission engine v2 已支持 role→permission mapping | 需加 `scheduler-config:view` / `manage-tenant` / `manage-platform` 3 個 perm |
| Audit log | ✅ 現有 `audit_log` 表（假設 · 需驗證） · 或 fire log 到 stdout | Config 改動 / 手動觸發需 audit · OQ-SCH-5 |

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 估算 |
|---|---|---|
| **A1 config schema + migration** | Migration 0021 · scheduler_config table + RLS + permission perms + seed 兩筆 platform default | 0.03 mo |
| **A2 Dynamic SchedulerManager** | 新 service · 啟動時 load config + register CronJob · config 改動時 unregister/re-register · dispatch 分派到 PDR / batch service | 0.05 mo |
| **A3 Manual trigger endpoints** | `POST /warroom/batches/rerun` 給 tenant_admin · `POST /personal-daily-report/mine/rerun-scheduler` 若 OQ-SCH-4 允許 tenant_admin | 0.02 mo |
| **A4 Config UI** | `web/src/settings/scheduler-config/Page.tsx` · 兩 card layout · form + save · React Aria | 0.04 mo |
| **A5 戰情室 「立即分析」button** | Warroom pane-hdr 分區加按鈕 + confirm dialog + call endpoint | 0.02 mo |
| **A6 M4 docs + smoke** | 更新 SOP + FMEA + MODULES.md | 0.02 mo |

**合計**：M1+M2+M3+M4+M5 = **0.18 mo**（約 3.5 個工作天）

---

## 4. A1 · scheduler_config schema

### 4.1 資料模型

```sql
-- migration 0021_scheduler_config.sql
CREATE TABLE scheduler_config (
  scheduler_id      text        NOT NULL,       -- 'pdr' | 'group_batch' | (未來擴)
  tenant_id         uuid        REFERENCES tenants(tenant_id) ON DELETE CASCADE,
                                                 -- NULL = platform default (fallback)
  enabled           boolean     NOT NULL DEFAULT true,
  cron_expr         text        NOT NULL,       -- e.g. '30 17 * * *'
  time_zone         text        NOT NULL DEFAULT 'Asia/Taipei',
  min_source_count  int         NOT NULL DEFAULT 0,     -- 跳過條件：訊息數 < N 不觸發
  lookback_days     int         NOT NULL DEFAULT 1,     -- group_batch 用 · PDR 不用（永遠當日）
  concurrency       int         NOT NULL DEFAULT 3,     -- group_batch 用
  updated_by        uuid        REFERENCES users(user_id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (scheduler_id, tenant_id)   -- 每 tenant 每 scheduler 一筆
);

CREATE INDEX ix_scheduler_config_tenant ON scheduler_config (tenant_id);

-- Seed platform defaults
INSERT INTO scheduler_config (scheduler_id, tenant_id, cron_expr, min_source_count)
VALUES ('pdr', NULL, '30 17 * * *', 2),
       ('group_batch', NULL, '0 0 * * *', 0);

-- RLS
ALTER TABLE scheduler_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_config FORCE ROW LEVEL SECURITY;

CREATE POLICY sched_read ON scheduler_config FOR SELECT
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR tenant_id IS NULL   -- platform default 大家都可讀（fallback 顯示）
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  );

CREATE POLICY sched_write ON scheduler_config FOR ALL
  USING (
    (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid AND current_setting('app.actor_role', true) = 'tenant_admin')
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'system')
  );
```

**Fallback 邏輯**：SchedulerManager 拉 config 時 · 若 (scheduler_id, tenant_id=X) 無 row · 用 (scheduler_id, tenant_id=NULL) 的 platform default。

### 4.2 Permission seed

Migration 0021 內接續：

```sql
INSERT INTO permissions (permission_id, resource, action, description, scope) VALUES
  ('scheduler-config:view', 'scheduler-config', 'view', '看定時任務設定', 'tenant'),
  ('scheduler-config:manage-tenant', 'scheduler-config', 'manage-tenant', '改自 tenant 定時任務設定', 'tenant'),
  ('scheduler-config:manage-platform', 'scheduler-config', 'manage-platform', '改 platform 全設定 + 成本欄位', 'platform');

-- tenant_admin 拿 view + manage-tenant
INSERT INTO role_permissions ...  -- 略

-- aiproot_admin 已 auto get platform-level perms
```

---

## 5. A2 · Dynamic SchedulerManager

### 5.1 邏輯

```typescript
@Injectable()
export class SchedulerManager implements OnModuleInit {
  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly configRepo: SchedulerConfigRepository,
    private readonly pdrScheduler: PersonalReportSchedulerService,
    private readonly batchScheduler: BatchSchedulerService,
  ) {}

  async onModuleInit() {
    await this.reloadAll();
  }

  /**
   * 全量重載 · 啟動 + config 改動時呼叫
   */
  async reloadAll() {
    const configs = await withSystemTx(tx => this.configRepo.listAllResolved(tx));
    // 拿掉本 manager 註冊的舊 job
    const managed = [...this.registry.getCronJobs().keys()].filter(k => k.startsWith('sched:'));
    for (const name of managed) this.registry.deleteCronJob(name);
    // 逐 config 註冊
    for (const cfg of configs) {
      if (!cfg.enabled) continue;
      const jobName = `sched:${cfg.schedulerId}:${cfg.tenantId ?? 'platform'}`;
      const job = new CronJob(cfg.cronExpr, () => this.dispatch(cfg), null, false, cfg.timeZone);
      this.registry.addCronJob(jobName, job);
      job.start();
    }
  }

  private async dispatch(cfg: SchedulerConfig) {
    if (cfg.schedulerId === 'pdr') {
      await this.pdrScheduler.runForDate(getTaipeiDate(), cfg.tenantId ?? undefined);
    } else if (cfg.schedulerId === 'group_batch') {
      await this.batchScheduler.runPending('cron', cfg.lookbackDays, cfg.tenantId ?? undefined);
    }
  }

  /**
   * 由 controller 呼 · config 改動即 reschedule
   */
  async onConfigChanged(schedulerId: string, tenantId: string | null) {
    await this.reloadAll();   // 簡單重載 · 或 targeted 卸 + 重註
  }
}
```

### 5.2 現有 scheduler 改動

移除 `@Cron` decorator · scheduler service 變成純 executor（`runForDate` / `runPending` 已存在 · 只是不再被 decorator 觸發）。

---

## 6. A3 · Manual trigger endpoints

### 6.1 群組日誌 · 新 endpoint

```typescript
@Controller("warroom/batches")
export class WarroomBatchController {
  constructor(private readonly scheduler: BatchSchedulerService) {}

  @Post("rerun")
  @Roles("aiproot_admin", "tenant_admin")
  async rerun(
    @Body() body: { batchDate?: string },
    @CurrentUser() user: JwtUser,
  ) {
    if (!user.tenant_id) throw new BadRequestException("需綁定 tenant");
    const triggeredBy = `manual-tenant:${user.user_id}`;
    // RLS 已擋 · 只跑自 tenant
    return this.scheduler.runPending(triggeredBy, 0, user.tenant_id);
  }
}
```

**注意** · lookback = 0 · tenant_admin 只跑當日；lookback > 0 屬 aiproot 補救用途 · 不開放給 tenant_admin。

### 6.2 個人日報 · 是否延伸？

OQ-SCH-4 · 現有 `/personal-daily-report/aiproot/run-scheduler` 只給 aiproot · 若延伸給 tenant_admin · 需限「只跑自 tenant 員工」。

---

## 7. 資料模型變動

### 7.1 SQL Migration

- `0021_scheduler_config.sql` · CREATE TABLE + RLS + seed defaults + permission perms + role mapping
- `0021_scheduler_config.down.sql` · DROP TABLE + DELETE role_permissions + DELETE permissions

### 7.2 RLS / Permission

- 新表 `scheduler_config` · RLS 如 §4.1
- 新 perms 3 個 · 如 §4.2
- tenant_admin 拿 view + manage-tenant
- aiproot_admin 自動 (platform-scope)

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | SchedulerManager 動態 register / unregister · configRepo CRUD | `scheduler-config.service.test.ts` |
| Integration | Config UI 改儲存 → API 更新 → SchedulerManager reload · 手動觸發 endpoint RLS | `tests/scheduler-config.e2e.test.ts` |
| Smoke | tenant_admin 進 UI 改時間 · 觀察 log 顯 next fire time 更新；按「立即分析」跑成功 | M6 收尾手動 |

至少 6 個 unit test：
- CronExpr parse + validate
- reloadAll 卸舊 + 註新
- fallback 找 platform default
- tenant_admin RLS blocks other tenant
- Manual trigger 用 lookback=0 只跑當日
- Config update 觸發 SchedulerManager.reloadAll

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED（用戶定 OQ-SCH-1..6）| 0.02 mo | ⏳ |
| **M1** schema + migration | 0021 migration + repository + tests | 0.03 mo | ⏳ |
| **M2** SchedulerManager | 新 service + 舊 scheduler 拿掉 @Cron + integration test | 0.05 mo | ⏳ |
| **M3** Manual trigger endpoints | 2 endpoints + role gate + tests | 0.02 mo | ⏳ |
| **M4** Config UI + 立即分析 button | Page + form + warroom pane 按鈕 + confirm | 0.04 mo | ⏳ |
| **M5** docs + smoke | SOP 更新 + MODULES.md 標 ✅ | 0.02 mo | ⏳ |
| **M6** FMEA 收尾（R17）| §12 失效場景反思；P0 未緩解不得上 prod | 0.02 mo | ⏳ |

---

## 10. 開放問題（OQ-SCH-N）— 待裁定

| # | 訴求 | 議題 | 選項 | 建議 |
|---|:-:|---|---|---|
| **OQ-SCH-1** | ①⑤ | Config scope 粒度？ | A. Per-tenant only（每 tenant 都要獨立設） <br> B. Platform default + per-tenant override（tenant 未設用 default） <br> C. Platform only（不給 tenant 分別設） | **B** — 兼顧新 tenant 免配置 · 老 tenant 可客製 · 對齊 multi-tenant SaaS pattern |
| **OQ-SCH-2** | ⑤ | tenant_admin 可改哪些欄位？ | A. 全部 <br> B. 除成本控管（併發 / lookback）· 其餘可 <br> C. 只讀 · 全部由 aiproot 改 | **B** — 時間 / 啟用 / 跳過條件 vs 成本控管分層 · 常見 SaaS 模式（用戶自主 vs 平台成本） |
| **OQ-SCH-3** | ①③ | 群組日誌 scheduler 現行 08:00 · 是否改預設值？ | A. 保 08:00 · 用戶自訂改 17:30 <br> B. 改預設 17:30 · 對齊 PDR <br> C. 保 08:00 + 新增 17:30「當日快照」二段跑 | **A** — 兩個 job 語意不同（PDR 送當日 / 群組看昨全） · 保 default · 想同步的用戶自改 |
| **OQ-SCH-4** | ③ | tenant_admin 手動觸發 · PDR endpoint 是否延伸？ | A. 只延伸 group_batch endpoint · PDR 保留 aiproot only <br> B. 兩個都延伸 <br> C. 不延伸 · 只 UI 觸發 group_batch | **A** — PDR 走「員工端」自服務按鈕（現已有）· tenant_admin 幫員工重跑 意圖不明 · scope 過寬易誤觸 |
| **OQ-SCH-5** | ⑥ | Config 改動 / 手動觸發 audit 存哪？ | A. 沿用現有 `audit_log`（若無新建）<br> B. 新建 `scheduler_run_log` · scheduler 專屬 <br> C. 只 log 到 stdout（Render logs 保 7 天） | **A** — 走現有 audit_log 一致；若無 audit_log 表 · 走 stdout（M5 補建 audit 統一化 · 另外開 module） |
| **OQ-SCH-6** | ⑤ | 停用 scheduler 是否需二次 confirm？ | A. 是 · 停用會影響下游主管通知 · 必二次 confirm <br> B. 否 · 開關即生效 · 用戶自負 | **A** — 停用 PDR → 主管收不到員工日報通知 · 這是流程斷點 · 值得 confirm |

---

## 11. SOP — 日常操作

### 11.1 tenant_admin 改自 tenant scheduler 時間

1. 登入 aiproot 網頁 · sidebar「設定 → 定時任務」
2. 兩張 card（個人日報 / 群組日誌）· 點對應 card 內 Cron 表達式欄
3. 改時間（e.g. `30 17 * * *` = 17:30）· 下方顯人類可讀值
4. 按「儲存變更」· SchedulerManager 立即 reload · next fire time 即刻更新
5. 觀察「上次執行」欄 · 隔天此時間應該有紀錄

### 11.2 tenant_admin 突發需求 · 立即分析今日群組活動

1. 進「戰情室 → 今日日誌」
2. pane-hdr 右上「當日操作 · 立即分析」按鈕
3. 彈 dialog 提示（新訊息 17:30 後再觸發較穩）· 確定分析
4. 30–60 秒後 toast 顯結果（掃 N 群組 · N 成功 / N 無資料 / N 失敗）
5. 頁面自動 refresh 顯最新 batches

### 11.3 停用 scheduler（不再自動跑）

1. 進「設定 → 定時任務」
2. 點對應 card 右上「停用」按鈕
3. 彈 confirm dialog 明確警告「下游主管通知會斷 · 員工仍可手動觸發」
4. 確定 · card 狀態變「停用」· CronJob 已 unregister

### 11.4 失敗模式排查

| 症狀 | 含意 | 處置 |
|---|---|---|
| 「上次執行」欄空 | scheduler 從未跑過 · 或 config 剛建 | 手動觸發一次驗證 |
| 「上次執行」status=failed | 上次跑掛了 · errorMessage 顯原因 | 看錯誤 · 常見：Anthropic API 429 / DB timeout · 隔天 auto retry |
| next fire time 沒更新 | reload 失敗 · manager crash | 看 Render stdout log 找 `SchedulerManager` 錯誤 · 重啟 service |
| tenant_admin 按「立即分析」403 | 缺 `scheduler-config:manage-tenant` perm · 或 role invalidate cache 未過 | 等 5 min 或呼 `/roles/invalidate` |

### 11.5 審計查詢

```sql
-- 過去 7 天所有 scheduler 執行紀錄
SELECT scheduler_id, tenant_id, last_run_at, last_run_result
FROM scheduler_config
WHERE last_run_at > now() - interval '7 days'
ORDER BY last_run_at DESC;
```

---

## 12. 失效場景反思（FMEA）— R17

> 心態 = pre-mortem（假設它已壞，反推為什麼）· 逐路徑列失效場景 · P0 未緩解**不得上 prod**

### 12.1 SchedulerManager 啟動（onModuleInit）

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| S1 | DB 連線失敗 | `listAll` throw · onModuleInit catch · log 錯 · 無 job 註冊 | ⚠️ 已知殘留 · Nest 啟動仍成功但 scheduler 全停 | P1 |
| S2 | `scheduler_config` 表不存在（migration 未跑）| listAll throw · scheduler 全停 · Render 冷啟仍成功 | ✅ M1 migration 0021 · 部署前必 R10 人工跑 | P0 |
| S3 | cron_expr 壞（DB seed 有效但 admin 改壞了） | `CronJob.from` throw · catch + log · skip 該 job · 其他 job 正常 | ✅ `registerJob` try/catch · service 層 validate | P1 |

### 12.2 SchedulerManager · dispatch （scheduled + manual）

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| D1 | executor（PDR / batch）throw | catch + `markLastRun(failed)` + log · scheduler 存活 · 下次仍跑 | ✅ dispatch try/catch | P1 |
| D2 | `markLastRun` 自己也 throw | inner catch 靜默 · stdout log 保留 | ✅ 靜默 catch | P2 |
| D3 | Multi-instance（Render 未來 2 pods）· 同時 fire · double run | 同 batch 跑兩次 · cost double · DB unique key 撞 | ✅ **P1-fix** · dispatch 內用 `pg_try_advisory_lock` · 多 pod 只讓一個拿到鎖 · 拿不到 skip；finally 內釋放 | P1 |
| D4 | Platform default job fire 但某 tenant 有 override · double run | Platform default 對已 override 的 tenant 也跑 · cost 2 倍 | ✅ **P1-fix** · `listOverriddenTenants` 撈已 override 的 tenant set · 傳給 PDR / batch scheduler 排除 | P1 |

### 12.3 手動觸發 endpoint（`POST /warroom/batches/rerun`）

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| M1 | tenant_admin B 傳 tenant A tenantId 想跨租戶觸發 | body 不接 tenantId · 純從 JWT 取 · 不可能跨 | ✅ controller `user.tenant_id` 取 | P0 |
| M2 | 同時 cron scheduled + 手動 · double run · same batch | cron 若已 completed 直接 skip · manual 允 rerun（用戶明說要） | ✅ **P1-fix** · `runBatch` 開頭呼 `getExisting` · cron 情境 completed/empty 直接 return existing | P1 |
| M3 | tenant_admin 頻繁點按 · DDoS 自己 tenant | 每 5 分鐘 rate limit · 拒回 429 | ✅ **P1-fix** · in-memory `lastTriggered` map · 每 tenant 5 min 限一次 | P2 |

### 12.4 Config upsert（`POST /scheduler-config`）

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| C1 | tenant_admin 改 cron_expr 壞 | service `CronJob.from` dry-run · throw BadRequestException | ✅ service 內 validate | P0 |
| C2 | tenant_admin 硬改 concurrency / lookback | service whitelist · 沿用舊值 · silent ignore | ✅ service 內 whitelist | P1 |
| C3 | tenant_admin 送 tenantId=null 想改 platform | controller 強制覆蓋 targetTenantId = user.tenant_id | ✅ controller 內處理 | P0 |
| C4 | Upsert 完 SchedulerManager reload 途中 crash · 部分 job 沒註冊 | `reloadAll` 全量掃 · 掛在中間會有一些 job 沒註冊 | ⚠️ 已知殘留 · onModuleInit + 下次改 config 再 reload 會補救 | P1 |
| C5 | 停用 scheduler UI 沒二次 confirm 就發送 | ConfirmDialog 已擋 · disable 前必彈 dialog | ✅ Page.tsx `handleToggle` | P1 |

### 12.5 部署順序（migration / 後端 / 前端）

| # | 場景 | 風險 | 緩解 |
|---|---|---|---|
| P1 | 後端 code 先於 migration 0021 | listAll throw table not exist · 啟動 fail | R10 · migration 必人工先跑 · 才 push code |
| P2 | Migration 跑但 seed default 沒插入 | `activeCfg` 返 null · UI 顯示「請聯繫 aiproot 建立 default」 · SchedulerManager 註 0 job | ✅ Migration 0021 seed 直接插 platform default |
| P3 | 前端先於後端 | UI 呼 `/scheduler-config` 404 · toast 錯 | Render deploy 同時觸發 · Web 冷啟 30-60s · 用戶會看到 · 可忍 |

### 12.6 不在本 module scope 修的 pre-existing 問題

- **audit_log 表不存在**（OQ-SCH-5 A 走現有 · 但現有其實還沒建）· 目前只 stdout log · 未來另建 audit module 統一處理
- **analysis_batch idempotent check**：runBatch 內部若同 date 已 completed 沒 skip 邏輯（D4 / M2 依賴）· 屬 convo-analysis-realtime scope · 另開 ticket

### 12.7 檢查點

| P0 | 狀態 |
|---|---|
| S2 · migration 未跑導致啟動 fail | ✅ R10 部署前跑 |
| M1 · 跨 tenant 觸發 | ✅ JWT-only tenantId |
| C1 · 壞 cron_expr | ✅ service validate |
| C3 · tenant_admin 想改 platform | ✅ controller override |

**所有 P0 皆 ✅ · 可上 prod。**

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-23 | v0.1 | 初版 DRAFT — sub-task A1-A5 + OQ-SCH-1..6 | Claude Code |
| 2026-07-23 | v0.2 | OQ-SCH-1..6 全採建議（B/B/A/A/A/A）· 狀態 DRAFT → APPROVED · 進 M1 | ahern + Claude |
| 2026-07-23 | v1.0 | M1–M6 全部 SHIPPED · migration 0021 · SchedulerManager · WarroomBatchController · Config UI · 立即分析 button · SOP · FMEA P0 全清 | ahern + Claude |
| 2026-07-23 | v1.1 | 4 條 P1 fix · pg_advisory_lock (multi-pod) · listOverriddenTenants (排除已 override) · getExisting (idempotent skip) · 5-min rate limit (self-DDoS) · 所有 P1 → ✅ | ahern + Claude |
