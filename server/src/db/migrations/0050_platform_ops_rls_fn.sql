-- Migration 0050 · notify 三表的 RLS 白名單收進一個函式，並補上 assistant
-- 修的是 0049 的後果（docs/modules/custom-roles.md §5.2 沒想到這一層）
--
-- ── 症狀 ──────────────────────────────────────────────────────
-- 0049 把「助理」升格成內建角色，它帶著客戶原本設的兩個權限碼
-- （notify-config.view / notify-config.manage）。指派給人之後，
-- 那個人打開「通知設定」看到的是**「尚無通知規則」**——
-- 但 notification_rule 裡實際有 3 條。
--
-- ── 根因 ──────────────────────────────────────────────────────
-- 這三張表的 RLS 是**純角色白名單**，沒有租戶條件：
--   current_setting('app.actor_role') = ANY (ARRAY['aiproot_admin','consultant','system'])
-- assistant 不在裡面 → 回 0 列**而且不報錯**。
-- API 層的權限碼說「你可以看」，DB 層說「這裡沒有東西」，兩邊都沒錯，
-- 合起來就是一個空清單。（本專案第 14 次 RLS 靜默回 0。）
--
-- ── 為什麼收進函式 ────────────────────────────────────────────
-- 同一份白名單原本抄在三個 policy 裡。這次出事正是因為
-- 「加角色」要記得去改的地方不只 roles 表，還有這三份互相獨立的清單。
-- 收成一個函式之後，下次加角色只要改一行，而且函式名稱本身就說明了語意
-- （這是 aiproot 平台維運的範圍，不是租戶的）。
--
-- ⚠️ 這不是「順手抽象」——它是一次已經發生的事故的直接對策。
--    在此之前只有三行重複，抽象是不划算的；現在那三行已經漂移過一次了。

CREATE OR REPLACE FUNCTION app_is_platform_ops() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.actor_role', true) = ANY (ARRAY[
    'aiproot_admin',   -- 平台管理員
    'consultant',      -- 顧問
    'assistant',       -- 0050 · aiproot 助理（協助管通知設定與 Ragic 帳號）
    'system'           -- 背景批次 / webhook
  ])
$$;

COMMENT ON FUNCTION app_is_platform_ops() IS
  'aiproot 平台維運範圍的角色白名單 · 給 notify 相關的三張全域表用（這些表沒有租戶欄位語意）· 加內建角色時記得回來看這裡';

DROP POLICY IF EXISTS notification_rule_aiproot ON notification_rule;
CREATE POLICY notification_rule_aiproot ON notification_rule USING (app_is_platform_ops());

DROP POLICY IF EXISTS notify_config_aiproot ON notify_config;
CREATE POLICY notify_config_aiproot ON notify_config USING (app_is_platform_ops());

DROP POLICY IF EXISTS ragic_account_aiproot ON ragic_account;
CREATE POLICY ragic_account_aiproot ON ragic_account USING (app_is_platform_ops());
