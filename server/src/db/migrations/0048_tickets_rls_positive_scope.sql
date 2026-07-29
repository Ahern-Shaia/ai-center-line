-- Migration 0048 · tickets 的 RLS 從「列舉誰要被限制」改成正向 fail-closed
-- docs/modules/custom-roles.md §5.1
--
-- ⚠️ 這是**安全修正**，不是新功能。與「自訂角色」那個功能無關（那個已凍結）。
--
-- 舊寫法：
--   AND (current_setting('app.actor_role') IS DISTINCT FROM 'group_owner'
--        OR department_id = current_department)
--
-- 它是「列舉誰要被限制」—— 部門隔離只對字面字串 'group_owner' 生效。
-- 每多一個角色，就自動落在「不被限制」那一側：**預設開放，不是預設關閉**。
--
-- 這不是假設性的問題，現在就在漏：
--   prod 有 8 個 role='employee' 的帳號，他們在 DB 層看得到**全租戶所有部門**的任務。
--   目前擋住他們的只有 API 層的權限碼（employee 只有 personal-report.mine 與 trips.mine，
--   碰不到任何任務端點）—— 也就是說**縱深防禦少了一層**，只剩一道。
--
-- 新寫法：有設 app.current_department 就限縮，沒設就看整個租戶。
-- SQL 不再猜角色，由後端決定要不要設（interceptor 從 JWT 的 department_id 帶）。
-- app.current_department 本來就已經在設了（db/client.ts:42），這不是新機制。
--
-- ── prod 驗算（2026-07-29 · 改完誰會變）────────────────────────
--   role           帳號數  有掛部門   改後
--   tenant_admin      7       0       不變（沒部門 → 看全租戶）
--   aiproot_admin     1       0       不變
--   group_owner       3       3       不變（有部門 → 只看自己部門）
--   employee          8       3       **3 個從「看全租戶」收斂成「只看自己部門」** ＝ 修正
--
--   另外 5 個沒掛部門的 employee 仍看得到全租戶（OQ-CR-3）——
--   但他們沒有任何任務相關權限碼，API 層碰不到，所以不急著補部門。
--
-- ⚠️ 已掃過 pg_policies：全庫只有 tickets 用 `IS DISTINCT FROM` 這種負向寫法，
--    其餘都是「租戶內 OR 逃生角色」的正向寫法，不受影響。
--
-- Rollback：見 0048_tickets_rls_positive_scope.down.sql

DROP POLICY IF EXISTS p_tickets ON tickets;
CREATE POLICY p_tickets ON tickets USING (
  tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
  AND (
    -- 沒設部門 ＝ 這個人的資料範圍是整個租戶
    nullif(current_setting('app.current_department', true), '') IS NULL
    -- 有設就只看那個部門
    OR department_id = nullif(current_setting('app.current_department', true), '')::uuid
  )
);
