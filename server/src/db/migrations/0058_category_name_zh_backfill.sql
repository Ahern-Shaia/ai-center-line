-- 0058_category_name_zh_backfill.sql — category_registry.category_name 回填中文
-- 冪等：可重跑（只改「還沒被命名」的那些）
--
-- 背景：WTB-M2 讓 AI 可動態註冊分類，註冊時 category_name **預設塞 slug**
-- （prod 實查：chitchat/rnd/procurement… 全是英文 slug）。
-- 前端原本靠寫死的 CATEGORY_LABEL 對照表才顯示中文 —— 客戶自己新增的分類就只能看到英文，
-- 違反 UI 中文優先鐵則，且客戶無法自助改名。
--
-- 本次把 registry 變成顯示名的真正來源：先把已知的 8 個回填中文，
-- 之後客戶可在「任務設定 → 分類詞庫」自行改名（rename 端點早就有）。
--
-- ⚠️ 只更新 category_name = category_slug 的列（＝從沒被人改過名）。
--    已經被客戶改過名的一律不動，避免蓋掉人工命名。

BEGIN;

UPDATE category_registry SET category_name = v.zh, last_used_at = last_used_at
FROM (VALUES
  ('daily_report', '報工日報'),
  ('maintenance',  '維保異常'),
  ('attendance',   '出勤異動'),
  ('rnd',          '研發討論'),
  ('procurement',  '採購'),
  ('sales',        '業務'),
  ('it_support',   '資訊支援'),
  ('chitchat',     '閒聊')
) AS v(slug, zh)
WHERE category_registry.category_slug = v.slug
  AND category_registry.category_name = category_registry.category_slug;

COMMIT;
