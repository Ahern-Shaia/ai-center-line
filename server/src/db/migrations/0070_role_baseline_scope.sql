-- 0070 · 自訂角色的「資料範圍基準」· docs/modules/custom-roles.md v0.3 方案 A
--
-- 背景：`users` 上兩條軸其實已經分開了（v0.3 §6.3 實測）——
--   users.role     → app.actor_role → **資料範圍**（35 條 RLS policy 在讀）
--   users.role_id  → 權限碼          → **能做什麼**（127 個端點在讀）
--
-- 方案 A：自訂角色只宣告「能做什麼」，資料範圍沿用內建角色之一當基準。
-- 指派時 `users.role = 基準`、`users.role_id = 自訂角色`，兩欄一起寫。
-- **0 條 RLS policy 要改** —— 這是選 A 而不是 §3.3 完整方案的全部理由。
--
-- ⚠️⚠️ CHECK 裡刻意**只有三個值**。`assistant` / `consultant` / `aiproot_admin`
--      絕對不可以當基準：那三個角色在 `app_is_platform_ops()` 的白名單裡，
--      而那個函式**沒有租戶條件** —— 拿它當基準等於讓租戶自製一個
--      讀得到所有租戶通知規則與 Ragic API 金鑰的角色（2026-08-21 實證）。
--      這一條在 DB 層擋，不倚賴 service 層記得檢查。
--
-- NULL 的語意 ＝「基準就是 role_key 自己」：
--   · 6 個內建角色（is_system）→ NULL
--   · 0067 的 fork（改過權限的內建角色，role_key 仍是 employee/group_owner）→ NULL
--   · 真正的新自訂角色（role_key 例如 qa_lead）→ 必填
-- 有效基準一律用 COALESCE(baseline_role, role_key) 取，所以**不需要回填**，
-- 套完到 push 之間行為完全不變（同 0068 的 DEFAULT 紀律）。

ALTER TABLE roles ADD COLUMN IF NOT EXISTS baseline_role text;

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_baseline_role_check;
ALTER TABLE roles ADD CONSTRAINT roles_baseline_role_check
  CHECK (baseline_role IS NULL OR baseline_role IN ('employee', 'group_owner', 'tenant_admin'));

COMMENT ON COLUMN roles.baseline_role IS
  '自訂角色的資料範圍基準（employee/group_owner/tenant_admin）· NULL = 基準即 role_key 本身 · 有效值用 COALESCE(baseline_role, role_key)';

-- 驗證（套完自己看一眼，別假設）：
--   SELECT role_key, role_name, is_system, tenant_id, baseline_role FROM roles ORDER BY role_key;
--   期望：既有 6 列 baseline_role 全為 NULL ＝ 行為不變。
