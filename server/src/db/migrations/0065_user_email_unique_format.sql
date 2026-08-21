-- 0065_user_email_unique_format.sql — users.email 加唯一約束與格式檢查
-- 冪等：可重跑
--
-- ⚠️ **套用前先跑 server/scripts/precheck-0065-user-email.sql**（R1）。
--    兩個約束都是「既有資料不合就建不起來」的類型，先看過才知道會不會失敗。
--
-- 背景（2026-08-21）：
-- users.email 是登入帳號，但它**既沒有唯一約束也沒有任何格式驗證** ——
-- 欄位定義只有 `email text`（0001），DTO 也只有 `z.string().trim().min(3).max(200)`。
-- 於是兩種錯誤都會被靜靜收下，而且症狀一模一樣：「這個人就是登不進去」。
--
--   ① 重複：登入是 `WHERE email = ? LIMIT 1`，兩個同名帳號只有一個抽得到，
--      另一個永遠登不進去，且系統不會有任何抱怨。
--   ② 全形字元：2026-08-21 實際差點發生 —— 有人在中文輸入法下打出
--      `taiwanhomecare＠aiproot.com`（U+FF20 全形＠）。它會原樣存進去，
--      之後用正常鍵盤打的 `@`（U+0040）永遠對不上。
--      而登入失敗一律回「帳號或密碼錯誤」（auth.service 刻意不透露帳號存不存在），
--      查的人會往密碼方向找，找不到原因。
--
-- ── 兩個約束的設計取捨 ──
--
-- 唯一性用 **lower(email)** 而不是 email：
--   `Test@x.com` 與 `test@x.com` 在使用者眼中是同一個帳號，讓它們並存只會製造
--   「我明明有這個帳號」的爭議。用小寫比對把這一類擋在源頭。
--   ⚠️ 但登入 (auth.service.ts) 目前仍是**大小寫敏感**的精確比對 ——
--      本 migration 不改它（那是行為變更，要另外決定）。這裡只保證不會有變體並存。
--
-- 格式檢查用 **octet_length = length** 判斷 ASCII，而不是寫一長串正則：
--   UTF-8 下任何非 ASCII 字元都佔 2 個以上位元組，所以這個等式一破就代表混進了
--   全形字或中文。比列舉字元乾淨，也不會漏掉沒想到的那個全形符號。
--
-- 刻意**不做**嚴格的 RFC 5322 驗證：那會擋掉合法的怪 email，而我們要防的只是
--   「打錯了自己看不出來」這一類。`test@tes.om` 這種網域打錯的仍然會過 —— 沒有
--   任何約束攔得住它，那需要真的寄一封信，而本系統的 email 只是帳號名。
--
-- email 允許 NULL（LIFF 自動建的帳號早期可能沒有），兩個約束都放過 NULL。

BEGIN;

-- ① 唯一（不分大小寫）· 排除 NULL
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower
  ON users (lower(email))
  WHERE email IS NOT NULL;

COMMENT ON INDEX ux_users_email_lower IS
  '登入帳號不可重複（不分大小寫）· 撞到時 pg 回 23505，服務層須轉成中文（見 user.service.ts）';

-- ② 格式檢查
--    NOT VALID → 只擋「之後寫進來的」，不對既有資料做全表驗證。
--    這樣即使 precheck 漏看了一列，也不會讓整支 migration 失敗、卡住其他改動。
--    確認乾淨後再跑下面那句 VALIDATE 把既有資料也納入。
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_format;
ALTER TABLE users ADD CONSTRAINT users_email_format CHECK (
  email IS NULL OR (
    octet_length(email) = length(email)                                  -- 全 ASCII（擋全形＠／中文／全形空白）
    AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'        -- 恰一個 @ · 網域有點 · 無空白
  )
) NOT VALID;

COMMIT;

-- ── 既有資料的驗證（確認 precheck ③ 是 0 列之後再跑）──
-- 分開一句是刻意的：它會掃全表，失敗時只影響這一句，不會回滾上面已經生效的約束。
--
--   ALTER TABLE users VALIDATE CONSTRAINT users_email_format;
