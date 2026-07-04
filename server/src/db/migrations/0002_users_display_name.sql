-- 加 users.display_name：戰情室 UI 顯示「已由 XX 確認」的簽核者名稱來源。
-- 允許 NULL（既有帳號 fallback 用 email prefix）。
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;
