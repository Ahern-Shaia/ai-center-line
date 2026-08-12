-- 0064_record_backfill_with_rls.sql — 補做 0063 沒做到的回填
-- 冪等：可重跑
--
-- ⚠️ 0063 的 constraint 放寬成功了，但那支 UPDATE **影響 0 列**。
--    原因：`tickets` 的 RLS policy 是 AND-only 綁 `app.current_tenant`，
--    **沒有角色逃生門**（不像 tenants / users 收 aiproot_admin）。
--    migration 裡直接下 UPDATE 時 current_tenant 是空的 → policy 永遠不成立
--    → 0 列被改，而且**不報錯**。
--
--    prod 執行完的輸出是 `UPDATE 0`，看起來跟「沒有資料要改」一模一樣。
--    實際上台灣福祉有 87 筆（日報 66 / 出勤 18 / 閒聊 3）等著回填。
--
-- 所以這裡逐租戶設好 current_tenant 再改，並且**自己檢查有沒有靜默歸零**。

BEGIN;

DO $$
DECLARE
  t          uuid;
  before_cnt int := 0;
  moved      int := 0;
  n          int;
BEGIN
  -- 讀 tenants 需要 aiproot_admin（它有逃生門）
  PERFORM set_config('app.actor_role', 'aiproot_admin', true);
  -- 部門若有值會再收窄一層，明確清掉
  PERFORM set_config('app.current_department', '', true);

  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.current_tenant', t::text, true);

    SELECT count(*) INTO n FROM tickets
     WHERE tenant_id = t
       AND category IN ('daily_report', 'attendance', 'chitchat')
       AND work_status = 'open' AND work_outcome IS NULL;
    before_cnt := before_cnt + n;

    UPDATE tickets SET work_status = 'record'
     WHERE tenant_id = t
       AND category IN ('daily_report', 'attendance', 'chitchat')
       AND work_status = 'open' AND work_outcome IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    moved := moved + n;
  END LOOP;

  RAISE NOTICE '待回填 % 筆 · 實際改了 % 筆', before_cnt, moved;

  -- ⚠️ 這一段就是 0063 缺的東西：有東西要改卻一筆都沒改到 = RLS 擋住了，
  --    不是「沒事做」。沒有這個檢查，失敗會長得跟成功一模一樣。
  IF before_cnt > 0 AND moved = 0 THEN
    RAISE EXCEPTION 'RLS 靜默歸零：有 % 筆待回填但一筆都沒改到 · 檢查 app.current_tenant 是否生效', before_cnt;
  END IF;
END $$;

COMMIT;
