-- Migration 0036 · 任務追蹤到結束：第四條軸（工作狀態）＋ 完成訊號暫存
-- 依 docs/modules/task-completion-tracking.md §4 / M2
--
-- ⚠️ 為什麼要新欄位而不是複用 tickets.status：
--    status 是 **AI 從對話讀到的**（推論），work_status 是 **本人回報的**（承諾）。
--    共用一欄的話 materializer 重跑會把人的回報洗掉（同 assigned_by 的坑），
--    或反過來人標了完成、下次分析 AI 又改回 in_progress。
--
-- ⚠️ 措辭鐵則（doc §2.5 · F-26）：對外一律講「未確認完成」不講「未完成」。
--    前者說的是系統的認知（永遠為真），後者說的是工作狀態
--    （人做完但沒回報時就是假的，他會因此不再信任提醒）。

-- ============================================================
-- 1 · tickets · 第四條軸
--
-- 「結束了沒」與「為什麼結束」拆兩欄 = Jira 的 status/resolution 模型。
-- 壓在同一欄的話，每多一種結束理由就要多一個狀態（社群叫 resolution chaos）。
-- ============================================================
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS work_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS work_outcome text,
  -- ⚠️ 不可 NOT NULL：prod 當責人 0 人有系統帳號（doc §1.6 C · F-18）。
  --    設了 NOT NULL 等於一筆都寫不進去。
  ADD COLUMN IF NOT EXISTS work_closed_by uuid REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS work_note text,
  -- 訊號從哪來 · line_reply 是主要來源，web 是主管補登
  ADD COLUMN IF NOT EXISTS work_closed_via text,
  -- 回報者的 LINE 身分 · 這欄「一定有值」而 work_closed_by 常常是 null，那是常態不是例外
  ADD COLUMN IF NOT EXISTS work_closed_line_user_id text,
  ADD COLUMN IF NOT EXISTS work_closed_message_id text,
  -- 最後一次「回報進度」· 有值代表有人在跟，只是還沒好（用來分辨久懸 vs 有進展）
  ADD COLUMN IF NOT EXISTS work_last_report_at timestamptz,
  ADD COLUMN IF NOT EXISTS work_last_report_note text,
  -- 就地問過沒有（doc §2.5）· 防止同一件重複問
  ADD COLUMN IF NOT EXISTS work_asked_at timestamptz,
  ADD COLUMN IF NOT EXISTS work_asked_message_id text;

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_work_status_check;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_work_status_check CHECK (work_status IN ('open', 'closed'));

-- ⚠️ 照 Atlassian 的警告：**不可**出現語意為「未完成」的 outcome 值。
--    Jira 有人建了叫 Unresolved 的 resolution，結果那些票全被當成已解決。
--    「還沒結束」用 work_status='open' 表示，不是一個叫「未完成」的 outcome。
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_work_outcome_check;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_work_outcome_check
  CHECK (work_outcome IS NULL OR work_outcome IN ('完成', '不用做了', '轉他人', '做不到'));

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_work_closed_via_check;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_work_closed_via_check
  CHECK (work_closed_via IS NULL OR work_closed_via IN ('line_reply', 'web', 'system'));

-- 跨軸約束：結束了就必須說為什麼；沒結束就不能有結束原因。
-- 沒有這條，第一個忘記寫 outcome 的路徑就會製造出永遠算不出來的票（doc F-14）。
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_work_outcome_matches_status;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_work_outcome_matches_status CHECK (
    (work_status = 'open'   AND work_outcome IS NULL     AND work_closed_at IS NULL) OR
    (work_status = 'closed' AND work_outcome IS NOT NULL AND work_closed_at IS NOT NULL)
  );

COMMENT ON COLUMN tickets.work_status IS
  '第四條軸 · 擁有者是當責人本人 · open/closed（對外措辭：尚未確認完成／已結束）· AI 永遠不得寫這欄';
COMMENT ON COLUMN tickets.work_outcome IS
  '為什麼結束 · 完成／不用做了／轉他人／做不到 · 完成率分母須排除「不用做了」';
COMMENT ON COLUMN tickets.work_closed_line_user_id IS
  '回報者的 LINE 身分 · 不需要系統帳號（訊息自帶身分）· work_closed_by 為 null 是常態';

-- 主管端要撈「開著且久無回報」· 也是 M3.5 每日清單的查詢
CREATE INDEX IF NOT EXISTS ix_tickets_work_open
  ON tickets (tenant_id, assignee_display_name, work_status, created_at)
  WHERE work_status = 'open';

-- ============================================================
-- 2 · pending_completion_signal · 時序解耦（doc §2.6 · F-28）
--
-- ⚠️ 為什麼需要這張表：
--    完成回覆是**即時**進來的，任務是**每天批次**才產生的。
--    prod 真實案例：07/27 21:28 指派、21:39 回「已設定」，
--    但分析要到 07/28 18:00 才跑到這兩則 —— 完成訊號比任務早 21 小時。
--    寫成「收到回覆 → 找任務 → 關掉」的話當下一定找不到，訊號全部掉在地上。
--    所以先落地、後對應。
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_completion_signal (
  signal_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  group_id             text NOT NULL,

  -- 訊號本身 · 不依賴任務存在
  reply_message_id     text NOT NULL,
  quoted_message_id    text NOT NULL,          -- 對應的鑰匙：被引用的原訊息
  replier_line_user_id text NOT NULL,          -- 身分自帶，不需要系統帳號
  replier_display_name text,
  intent               text NOT NULL,
  note                 text,
  received_at          timestamptz NOT NULL DEFAULT now(),

  -- 消化狀態
  resolved_at          timestamptz,
  resolved_ticket_id   uuid REFERENCES tickets(ticket_id) ON DELETE SET NULL,
  resolution           text,

  CONSTRAINT pcs_intent_check CHECK (
    intent IN ('completion', 'progress', 'asked', 'answered_done', 'answered_not_yet')
  ),
  CONSTRAINT pcs_resolution_check CHECK (
    resolution IS NULL OR resolution IN ('closed_ticket', 'created_ticket', 'no_match', 'superseded')
  ),
  -- 同一則回覆只收一次（webhook 會重送）
  CONSTRAINT pcs_reply_unique UNIQUE (reply_message_id)
);

-- 批次後回掃：撈還沒消化的
CREATE INDEX IF NOT EXISTS ix_pcs_unresolved
  ON pending_completion_signal (tenant_id, quoted_message_id)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE pending_completion_signal IS
  '完成訊號先落地、後對應（doc §2.6）· 完成回覆常比任務早出現，不能即時對應';
COMMENT ON COLUMN pending_completion_signal.resolution IS
  '⚠️ 未消化（resolved_at IS NULL）＝批次還沒輪到，不是問題；no_match＝批次跑過仍對不上，這才是材料化漏接、才可拿去校準門檻（F-29）';

ALTER TABLE pending_completion_signal ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_completion_signal FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pcs_rw ON pending_completion_signal;
CREATE POLICY pcs_rw ON pending_completion_signal
  USING (
    current_setting('app.actor_role', true) IN ('aiproot_admin', 'system')
    OR tenant_id::text = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.actor_role', true) IN ('aiproot_admin', 'system')
    OR tenant_id::text = current_setting('app.current_tenant', true)
  );

GRANT SELECT, INSERT, UPDATE ON pending_completion_signal TO app_rw;
