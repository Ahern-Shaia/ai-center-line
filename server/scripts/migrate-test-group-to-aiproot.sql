-- migrate-test-group-to-aiproot.sql
-- 把「台灣福祉機器人測試群」的**訊息**搬到 aiproot，並刪掉台灣福祉那邊的分析產物。
--
-- 用戶裁定（2026-08-04）：「只搬訊息，我重跑分析，把台灣福祉有關這個測試群的
-- 所有相關訊息、資料、任務都刪了」。
--
-- ⚠️ 不能用 scripts/prod-query.sh（唯讀）。用 psql 直接跑這個檔。
-- ⚠️ 這是跨租戶的資料重寫，**不可逆**。務必先在 ROLLBACK 模式看過驗收數字。
--
-- ═══════════════════════════════════════════════════════════════════
-- 遷移計畫（CLAUDE.md R1）
-- ═══════════════════════════════════════════════════════════════════
--
-- 【對應關係】同一個實體群在兩個 provider 下的識別碼不同（見 memory
--   pitfall_line_ids_are_provider_scoped），所以「搬」＝重寫識別碼：
--
--   tenant_id  4d97eced-…（台灣福祉）      → 77777777-…（aiproot）
--   bot_id     ad363dc2-…（台灣福祉 bot）  → 99142261-…（aiproot bot）
--   group_id   C807e1df…                   → C0179efb…
--
-- 【搬（UPDATE）】300 line_message + 56 line_media + 4 line_member
--
--   ⚠️ `sender_line_id` 與 `line_member.user_id` **刻意不動**。
--      分析取「誰說的」是這樣 join 的（line-message.repository findForBatch）：
--        LEFT JOIN line_member mem ON mem.bot_id = lm.bot_id
--                                 AND mem.group_id = lm.group_id
--                                 AND mem.user_id = lm.sender_line_id
--      兩張表一起改寫 bot_id/group_id、而 LINE 的 user id 維持原值，join 就還成立，
--      重跑分析時人名照樣出得來。若把 user id 改成新 provider 的，反而會對不上
--      （而且我們只知道張○○、林○○ 兩人的新舊對應，Wang C／陳○○ 根本還沒綁）。
--
--   ⚠️ 副作用：aiproot 的這個群會同時存在「舊 provider 4 列 + 新 provider 4 列」
--      共 8 列 line_member，同一批人兩組 ID。功能上沒問題（各自 join 各自的訊息），
--      但成員清單看起來會有重複的人名。等四人都綁定後可再收斂。
--
--   ⚠️ `sender_user_id` 依 display_name 對到 aiproot 的使用者，對不到就設 NULL。
--      留著台灣福祉的 user_id 會變成 aiproot 資料指向別家租戶的人。
--      目前只有「林○○」對得到；Wang C／陳○○ 尚未在 aiproot 建立。
--
-- 【刪（DELETE）】台灣福祉那邊的分析產物，全部不搬：
--   21 tickets · 6 analysis_upload（連帶 result/label）· 6 analysis_batch
--   25 pending_completion_signal · 1 line_group
--
-- 【刪除順序】tickets 與 analysis_batch 的 upload_id 都是 ON DELETE SET NULL，
--   先刪 analysis_upload 會把它們變成認不出來源的孤兒 → 必須先刪它們。
--
-- 【RLS】tickets 的 policy 是 AND-only、沒有 actor_role 逃生門，
--   所以 current_tenant 必須設成**台灣福祉**（被刪的那一邊）、current_department 留空。
--   line_message / line_member / line_media / line_group 有 system 逃生門，
--   跨租戶 UPDATE 靠 actor_role='system' 通過 USING 與 WITH CHECK。
--
-- 【搬完之後（不在本腳本內，需另外操作）】
--   1. aiproot 的 tenants.batch_enabled 目前是 false → cron 永遠不會掃它。
--      到「平台 → 租戶管理」把它打開，否則重跑分析不會發生。
--   2. 訊息橫跨 7/24–8/4 共 8 天，而 group_batch 的 lookback 只有 2 天。
--      到「設定 → 定時任務設定 → 租戶選 aiproot」建一個 override 把
--      lookback_days 調大（≥12），讓今晚 00:00 那班能一次撿完，事後再調回 2。
--
-- 【回滾】沒有自動回滾。COMMIT 前的 ROLLBACK 是唯一的安全網 ——
--   所以請務必先跑一次確認驗收數字，再改 COMMIT。

BEGIN;

-- ⚠️ 必須是 'aiproot_admin' 而不是 'system'。
--    users 的 policy 是 `tenant_id = current_tenant OR actor_role = 'aiproot_admin'`
--    —— 'system' **不在** users 的逃生門裡。用 system 跑的話，下面那個
--    「台灣福祉使用者 → aiproot 使用者」的對照表會靜默回 0 筆，
--    300 則訊息的 sender_user_id 全被設成 NULL，而且畫面上其他數字都正常。
--    （2026-08-04 試跑時就是這樣，靠輸出裡的 `SELECT 0` 才看出來）
--    其餘表（line_message/member/media/group、analysis_batch、pending_completion_signal）
--    的逃生門都含 aiproot_admin；tickets 是 AND-only，靠下面的 current_tenant。
SET LOCAL app.actor_role         = 'aiproot_admin';
SET LOCAL app.current_tenant     = '4d97eced-64c5-4a38-952b-dfce9588ab7c';   -- 被刪的那一邊
SET LOCAL app.current_department = '';

-- ── 守衛 ────────────────────────────────────────────────────────
DO $$
DECLARE n_src int; n_dst int;
BEGIN
  SELECT count(*) INTO n_src FROM line_group
   WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
     AND bot_id   = 'ad363dc2-2d6f-4e65-8037-f0fabb44d32e';
  IF n_src <> 1 THEN
    RAISE EXCEPTION '守衛失敗：來源群組列預期 1 筆，實得 %', n_src;
  END IF;

  -- 目的地必須已經存在（aiproot bot 已進群），否則搬過去的訊息會指向不存在的群
  SELECT count(*) INTO n_dst FROM line_group
   WHERE group_id = 'C0179efb56e6ea107ebe9169e047e3d3e'
     AND bot_id   = '99142261-c99d-4aac-9256-67158382c700';
  IF n_dst <> 1 THEN
    RAISE EXCEPTION '守衛失敗：aiproot 側的目的地群組不存在（%），請先確認 bot 已在群內', n_dst;
  END IF;
END $$;

-- ── 1. 先刪分析產物（順序見上方說明）────────────────────────────
CREATE TEMP TABLE _u ON COMMIT DROP AS
  SELECT id FROM analysis_upload
   WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
     AND tenant_id = '4d97eced-64c5-4a38-952b-dfce9588ab7c'::uuid;

DELETE FROM tickets               WHERE source_upload_id IN (SELECT id FROM _u);
DELETE FROM analysis_batch        WHERE upload_id        IN (SELECT id FROM _u);
DELETE FROM personal_daily_report WHERE upload_id        IN (SELECT id FROM _u);
DELETE FROM analysis_upload       WHERE id               IN (SELECT id FROM _u);
DELETE FROM pending_completion_signal
  WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
    AND tenant_id = '4d97eced-64c5-4a38-952b-dfce9588ab7c'::uuid;

-- ── 2. 搬訊息／媒體／成員 ───────────────────────────────────────
-- display_name → aiproot user 的對照（對不到就 NULL）
CREATE TEMP TABLE _umap ON COMMIT DROP AS
  SELECT src.user_id AS old_id, dst.user_id AS new_id
    FROM users src
    JOIN users dst
      ON dst.tenant_id = '77777777-0000-0000-0000-000000000001'::uuid
     AND dst.display_name = src.display_name
   WHERE src.tenant_id = '4d97eced-64c5-4a38-952b-dfce9588ab7c'::uuid;

-- 對照表是 0 筆就停下來 —— 那代表 RLS 把 aiproot 的使用者擋掉了（見檔頭 actor_role 說明），
-- 不是「真的沒有同名的人」。至少「林○○」兩邊都有，所以正常情況不可能是 0。
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _umap;
  IF n = 0 THEN
    RAISE EXCEPTION '守衛失敗：使用者對照表 0 筆 · 多半是 actor_role 設錯導致 users 被 RLS 擋掉';
  END IF;
  RAISE NOTICE '使用者對照：% 人可對到 aiproot（對不到的訊息 sender_user_id 會設 NULL）', n;
END $$;

UPDATE line_media SET tenant_id = '77777777-0000-0000-0000-000000000001'::uuid
 WHERE message_id IN (SELECT message_id FROM line_message
                       WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
                         AND bot_id   = 'ad363dc2-2d6f-4e65-8037-f0fabb44d32e');

UPDATE line_message SET
  tenant_id      = '77777777-0000-0000-0000-000000000001'::uuid,
  bot_id         = '99142261-c99d-4aac-9256-67158382c700'::uuid,
  group_id       = 'C0179efb56e6ea107ebe9169e047e3d3e',
  sender_user_id = (SELECT new_id FROM _umap WHERE old_id = line_message.sender_user_id)
 WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
   AND bot_id   = 'ad363dc2-2d6f-4e65-8037-f0fabb44d32e';

UPDATE line_member SET
  tenant_id = '77777777-0000-0000-0000-000000000001'::uuid,
  bot_id    = '99142261-c99d-4aac-9256-67158382c700'::uuid,
  group_id  = 'C0179efb56e6ea107ebe9169e047e3d3e'
 WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
   AND bot_id   = 'ad363dc2-2d6f-4e65-8037-f0fabb44d32e';

-- ── 3. 刪掉台灣福祉那一列群組（訊息已搬走，沒有東西再靠它保留群名）──
DELETE FROM line_group
 WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
   AND bot_id   = 'ad363dc2-2d6f-4e65-8037-f0fabb44d32e';

-- ── 驗收 ────────────────────────────────────────────────────────
-- ① 台灣福祉側：舊 group_id 底下應全部歸零
SELECT '台灣福祉殘留' AS 項目, 'line_message' AS 表, count(*)::text AS n
  FROM line_message WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
UNION ALL SELECT '台灣福祉殘留', 'line_member',     count(*)::text FROM line_member  WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
UNION ALL SELECT '台灣福祉殘留', 'line_group',      count(*)::text FROM line_group   WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
UNION ALL SELECT '台灣福祉殘留', 'analysis_upload', count(*)::text FROM analysis_upload WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104';

-- ② 台灣福祉任務總數：180 → 159（少掉測試群的 21 張）
SELECT count(*) AS 台灣福祉任務數_應為159 FROM tickets
 WHERE tenant_id = '4d97eced-64c5-4a38-952b-dfce9588ab7c'::uuid;

-- ③ aiproot 側：訊息應為 15(原有) + 300(搬入) = 315；成員 4 + 4 = 8
SELECT set_config('app.current_tenant','77777777-0000-0000-0000-000000000001',true) AS 切到aiproot;
SELECT 'aiproot' AS 項目, 'line_message' AS 表, count(*)::text AS n
  FROM line_message WHERE group_id = 'C0179efb56e6ea107ebe9169e047e3d3e'
UNION ALL SELECT 'aiproot', 'line_member', count(*)::text FROM line_member WHERE group_id = 'C0179efb56e6ea107ebe9169e047e3d3e'
UNION ALL SELECT 'aiproot', '有對到人的訊息', count(*)::text FROM line_message
  WHERE group_id = 'C0179efb56e6ea107ebe9169e047e3d3e' AND sender_user_id IS NOT NULL;

-- ④ 搬入訊息的日期分布（決定重跑分析要涵蓋幾天 · 應為 7/24–8/4 共 8 天）
SELECT (sent_at AT TIME ZONE 'Asia/Taipei')::date AS 日期, count(*) AS 訊息數
  FROM line_message WHERE group_id = 'C0179efb56e6ea107ebe9169e047e3d3e'
 GROUP BY 1 ORDER BY 1;

-- 數字對了就把這行改成 COMMIT
ROLLBACK;
