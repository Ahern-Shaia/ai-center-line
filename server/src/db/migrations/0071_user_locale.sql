-- 0071 · users.locale · 介面語言偏好
-- docs/modules/i18n.md M2（OQ-I18N-5）
--
-- ⚠️ **給 DEFAULT，讓 migration → 部署的空窗期行為完全不變**：
--    套了這支之後、新程式碼上線之前，所有人仍是 'zh-TW'，畫面一模一樣。
--    （memory feedback_verify_prod_state_before_push：新欄位要讓空窗期無感）
--
-- ⚠️ 這一欄的用途有兩個，而且**語言來源不同**：
--    · 介面：登入者自己的偏好
--    · LINE 推播：**收件人**的偏好（不是發起者的）—— 見 i18n.md FMEA F-4
--    現在只有前者在用，但欄位放在 users 對兩者都對。
--
-- CHECK 而非 enum：加語言只要改 CHECK，不用 ALTER TYPE（OQ-I18N-7 架構支援第三語言）

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'zh-TW';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_locale_check;

ALTER TABLE users
  ADD CONSTRAINT users_locale_check CHECK (locale IN ('zh-TW', 'en'));

COMMENT ON COLUMN users.locale IS
  '介面語言偏好 · zh-TW | en · LINE 推播要用「收件人」這一欄而不是發起者的';
