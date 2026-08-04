-- cleanup-test-group-C807e1df.sql
-- 把「台灣福祉機器人測試群」的測試資料從【台灣福祉】租戶清掉。
--
-- 群組：C807e1df2e7e17ffde6a5df33ddf34104（台灣福祉機器人測試群）
-- 租戶：4d97eced-64c5-4a38-952b-dfce9588ab7c（台灣福祉）
-- Bot ：ad363dc2-2d6f-4e65-8037-f0fabb44d32e（台灣福祉分析 bot）
--
-- ⚠️ 執行時機：**等 aiproot 的 bot 已進群、台灣福祉的 bot 已被踢出之後**再跑。
--    bot 還在群裡的話，下一則訊息會讓 webhook 把 line_group 那列 upsert 回來。
--
-- ⚠️ 不能用 scripts/prod-query.sh（它只准 SELECT）。用 psql 直接跑這個檔。
--
-- ── 為什麼刪除順序不能改 ──────────────────────────────────────────
-- tickets.source_upload_id       → analysis_upload  ON DELETE SET NULL
-- analysis_batch.upload_id       → analysis_upload  ON DELETE SET NULL
--   先刪 analysis_upload 的話，那 16 張任務的 source_upload_id 會被設成 NULL，
--   就再也認不出它們來自哪個群 —— 測試資料會永久混進客戶的 141 張任務裡，救不回來。
--   所以 tickets / analysis_batch 一定要在 analysis_upload 之前刪。
-- analysis_result / analysis_label → analysis_upload  ON DELETE CASCADE（自動跟著走）
-- line_media                       → line_message     ON DELETE CASCADE（自動跟著走）
--
-- ── 為什麼一定要設 session 變數 ───────────────────────────────────
-- 這些表全開 FORCE RLS。少設變數 → DELETE 影響 0 列且**不報錯**，
-- 你會看到「成功」但資料原封不動。
-- 特別注意 tickets 的 policy 是 AND-only、沒有 aiproot_admin 逃生門：
--   tenant_id = app.current_tenant AND (app.current_department IS NULL OR 相符)
-- 所以 current_tenant 必須設成台灣福祉，且 current_department 必須留空。

BEGIN;

SET LOCAL app.current_tenant    = '4d97eced-64c5-4a38-952b-dfce9588ab7c';
SET LOCAL app.current_department = '';          -- 留空 = 不限部門，否則刪不到別部門的任務
SET LOCAL app.actor_role        = 'system';

-- ── 前置守衛：確認這個群真的屬於台灣福祉的 bot ──────────────────
-- 對不上就直接 abort，避免打錯租戶。
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM line_group g JOIN line_bot b ON b.bot_id = g.bot_id
  WHERE g.group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
    AND b.tenant_id = '4d97eced-64c5-4a38-952b-dfce9588ab7c'::uuid;
  IF n <> 1 THEN
    RAISE EXCEPTION '守衛失敗：預期 1 列，實得 % 列。請先確認群組/租戶對應關係', n;
  END IF;
END $$;

-- ── 刪除（順序見上方說明）──────────────────────────────────────
-- ⚠️ 每一句都額外帶 tenant_id 或 bot_id，**不能只靠 group_id**：
--    LINE 的 group_id 是依 provider 發放的，若日後有另一支同 provider 的 bot 進同一個群，
--    它看到的 group_id 會一模一樣。而 analysis_upload / pending_completion_signal
--    沒有 bot_id 欄位，analysis_upload 更是完全沒開 RLS —— 只用 group_id 當條件
--    會把別的租戶的資料一起刪掉，且不會有任何錯誤。
CREATE TEMP TABLE _u ON COMMIT DROP AS
  SELECT id FROM analysis_upload
  WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
    AND tenant_id = '4d97eced-64c5-4a38-952b-dfce9588ab7c'::uuid;

DELETE FROM pending_completion_signal WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
                                        AND tenant_id = '4d97eced-64c5-4a38-952b-dfce9588ab7c'::uuid;
DELETE FROM tickets               WHERE source_upload_id IN (SELECT id FROM _u);
DELETE FROM analysis_batch        WHERE upload_id        IN (SELECT id FROM _u);
DELETE FROM personal_daily_report WHERE upload_id        IN (SELECT id FROM _u);
DELETE FROM analysis_upload       WHERE id               IN (SELECT id FROM _u);  -- 連帶 result / label
DELETE FROM line_message          WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'   -- 連帶 line_media
                                    AND bot_id   = 'ad363dc2-2d6f-4e65-8037-f0fabb44d32e';
DELETE FROM line_member           WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
                                    AND bot_id   = 'ad363dc2-2d6f-4e65-8037-f0fabb44d32e';
DELETE FROM line_group            WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
                                    AND bot_id   = 'ad363dc2-2d6f-4e65-8037-f0fabb44d32e';

-- ── 驗收：以下每一列都必須是 0 ────────────────────────────────
SELECT 'line_message' AS 表, count(*) AS 殘留 FROM line_message WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
UNION ALL SELECT 'line_member',   count(*) FROM line_member   WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
UNION ALL SELECT 'line_group',    count(*) FROM line_group    WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
UNION ALL SELECT 'analysis_upload', count(*) FROM analysis_upload WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104'
UNION ALL SELECT 'pending_signal', count(*) FROM pending_completion_signal WHERE group_id = 'C807e1df2e7e17ffde6a5df33ddf34104';

-- 台灣福祉任務總數應從 180 → 159，待簽核應從 92 → 84
-- （2026-08-04 17:xx 實測值。這個群在被踢出前又跑過分析批次，數字會隨時間長，
--   跑之前先自己 SELECT 一次現況，不要照抄這行註解 —— 我第一版寫的 141/68 就已經過期了。）
SELECT confirm_status AS 狀態, count(*) FROM tickets
WHERE tenant_id = '4d97eced-64c5-4a38-952b-dfce9588ab7c'::uuid GROUP BY 1 ORDER BY 2 DESC;

-- 確認無誤再改成 COMMIT；數字不對就 ROLLBACK
ROLLBACK;
