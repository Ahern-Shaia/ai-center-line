-- Ragic 帳號歸戶 · 把 ragic_account.tenant_id 補上
-- 依 docs/modules/master-data-sync.md
--
-- ⚠️ 為什麼要做：
-- prod 三個 Ragic 帳號的 tenant_id 全是 NULL（早期建帳號時沒帶）。
-- 「資料來源」頁把 NULL 視為「平台共用」而對每一家客戶都顯示 ——
-- 平台管理員在「A 客戶」的頁面上，會看到 B 家的 Ragic 帳號，
-- 有機會改到別家的金鑰而毫無察覺。
--
-- ⚠️ 會不會影響正在跑的通知？**不會。**
-- 通知走 withSystemTx（actor_role='system'）讀帳號，
-- ragic_account 的 RLS 是看 actor_role 不是看 tenant_id，所以不受影響。
-- （已確認：notification-hub/sources/ragic-webhook.service.ts:51）
--
-- 依 R10：本檔只產生指令，由人手動在 prod 執行。

-- ============================================================
-- STEP 1 · 開 RLS 上下文
-- ragic_account 的 policy 只認 aiproot_admin / consultant / system
-- ============================================================
SET app.actor_role = 'aiproot_admin';

-- ============================================================
-- STEP 2 · 先看現況（不改任何東西）
-- ============================================================
SELECT display_name AS 顯示名, apname AS Ragic帳號名, server,
       COALESCE(tenant_id::text, '（未歸戶）') AS 目前歸屬,
       (api_key_enc IS NOT NULL) AS 有金鑰
FROM ragic_account ORDER BY created_at;

-- 對照：這三家是目前的租戶
SELECT tenant_id::text, tenant_name FROM tenants ORDER BY created_at;

-- ============================================================
-- STEP 3 · 歸戶（只動兩筆能確定的）
--
-- 依據不是名字相似，是「通知規則實際在用哪個帳號讀哪張表」：
--   aitode      → TB-P01 分析表 / TB-P02 顧客產品需求通知單（/order-operation/*）＝ 台灣福祉
--   shianyong26 → 收貨單（上游-4）（/erp/15）                                    ＝ 鮮湧
-- ============================================================
UPDATE ragic_account
   SET tenant_id = '4d97eced-64c5-4a38-952b-dfce9588ab7c'::uuid,   -- 台灣福祉
       updated_at = now()
 WHERE apname = 'aitode' AND tenant_id IS NULL;

UPDATE ragic_account
   SET tenant_id = 'a7b88699-750a-4089-8c47-fae1a4632ae4'::uuid,   -- 鮮湧
       updated_at = now()
 WHERE apname = 'shianyong26' AND tenant_id IS NULL;

-- ⚠️ 「鮮果 / freshfruits」刻意不動 —— 沒有對應的租戶。
--    它可能是早期測試留下的，也可能是鮮湧的第二個 Ragic 帳號。
--    名字相似不是證據，確認清楚再處理。
--    在確認之前它會維持「平台共用」，也就是每一家客戶都看得到。

-- ============================================================
-- STEP 4 · 驗證
-- ============================================================
SELECT r.display_name AS 顯示名, r.apname AS Ragic帳號名,
       COALESCE(t.tenant_name, '（未歸戶 · 每家客戶都看得到）') AS 歸屬客戶,
       (r.api_key_enc IS NOT NULL) AS 有金鑰
FROM ragic_account r
LEFT JOIN tenants t ON t.tenant_id = r.tenant_id
ORDER BY r.created_at;
-- 預期：aitode → 台灣福祉、shianyong26 → 鮮湧、freshfruits → （未歸戶）

-- ============================================================
-- STEP 5 · 確認通知沒被影響（跑完隔一陣子再看）
-- ============================================================
SELECT status, count(*) FROM notification_log GROUP BY 1;
-- 預期：sent 的數字只增不減，不應出現新的 failed
