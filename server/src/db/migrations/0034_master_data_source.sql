-- Migration 0034 · 主檔來源設定
-- 依 docs/modules/master-data-sync.md §2
--
-- 背景（four-features-reflection.md）：四項功能各自用自由文字，彼此對不起來 ——
-- 打卡的客戶欄填的是「午餐」「小卷米粉」，任務裡是「雲林順益斗六廠」，
-- 訂單通知裡是 Ragic 的客戶編號。三種寫法零交集。
--
-- 客戶已經在「通知設定」連好 Ragic（ragic_account，加密、per-tenant、48 則通知在跑），
-- 本表只補「哪張表是你的客戶名冊、名稱在哪一欄」。憑證共用不另存（§1.1 · F-3）。

CREATE TABLE IF NOT EXISTS master_data_source (
  source_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('customer')),   -- v1 只做客戶
  -- 'ragic' 走 ragic_account 憑證；'manual' 是 CSV 匯入（§7.3 · 與 Ragic 平級不是備案）
  provider    text        NOT NULL DEFAULT 'ragic' CHECK (provider IN ('ragic', 'manual')),
  account_id  uuid        REFERENCES ragic_account(account_id) ON DELETE SET NULL,
  sheet_path  text,                                    -- 例 /customer/6 · manual 為 null
  name_field  text,                                    -- fieldId · 客戶名稱
  code_field  text,                                    -- fieldId · 客戶編號（選填）
  enabled     boolean     NOT NULL DEFAULT true,
  last_sync_at    timestamptz,
  last_sync_count int,
  last_sync_error text,                                -- 有值＝上次失敗 · 頁面要顯示（F-4 靜默失效）
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- 一種主檔只准一個來源。多來源合併會立刻帶出「同一個客戶在兩張表名字不同怎麼辦」，
  -- 那是 v2 的事（§2）
  UNIQUE (tenant_id, kind)
);

ALTER TABLE master_data_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_data_source FORCE ROW LEVEL SECURITY;

CREATE POLICY master_data_source_tenant ON master_data_source
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON master_data_source TO app_rw;

-- 註：(tenant_id, name) 索引 data_sync_customer 早就有了（idx_data_sync_customer_tenant_name），不重建

-- Ragic 那邊刪掉的客戶標 inactive 不刪（F-6：歷史打卡還指著它）
ALTER TABLE data_sync_customer
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

COMMENT ON TABLE master_data_source IS
  '主檔來源設定 · 憑證共用 ragic_account 不另存 · 一種主檔一個來源';
COMMENT ON COLUMN data_sync_customer.active IS
  'false = 來源已刪除 · 不從我方刪掉，歷史紀錄還指著它';
