-- Migration 0028 · 修正 group_batch 排程時間與原始設計意圖不符
--
-- 背景（2026-07-25 排查）：
--   0021 seed 寫 cron '0 0 * * *' 並註解「08:00 Taipei (00 UTC = 08 Taipei)」——
--   當初以 UTC 思維寫 cron，但 time_zone 欄位是 'Asia/Taipei'，
--   SchedulerManager 會把 cron 交給 CronJob 並帶入該時區解讀
--   → 實際觸發時間是「台北半夜 00:00」，而非註解宣稱的早上 08:00。
--
-- 影響：群組對話分析排程跑在半夜（無業務理由；且半夜無流量時 Render 免費方案休眠，實務上等同不會跑）。
--
-- 修正：改為台北 08:00（原始設計意圖：早上批次處理前一天的群組日誌）。
-- 保守處理：只更新「仍是舊錯誤值」的 platform default；已被使用者自訂過的設定不動。

UPDATE scheduler_config
SET cron_expr  = '0 8 * * *',
    updated_at = now()
WHERE scheduler_id = 'group_batch'
  AND tenant_id IS NULL
  AND cron_expr = '0 0 * * *';

-- 驗證用（跑完可自行查看）：
--   SELECT scheduler_id, tenant_id, enabled, cron_expr, time_zone FROM scheduler_config ORDER BY 1, 2;
