-- Migration 0054 · group-id-onboarding M1
-- line_bot 加 kind 欄位，區分「分析 bot（analysis）」與「通用 ID bot（utility）」。
-- 通用 bot 為 aiproot 平台層工具（加進群 → 只回群組 ID），不屬任何租戶，
-- 故放寬 tenant_id 為 NULLABLE；但 analysis bot 仍強制要有 tenant_id。
-- 對照 docs/modules/group-id-onboarding.md §4（M0 CLOSED v0.3）。

ALTER TABLE line_bot
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'analysis'
    CHECK (kind IN ('analysis', 'utility'));

-- 通用 bot 無租戶 → 放寬 NOT NULL，但用 CHECK 確保 analysis bot 一定有 tenant_id
ALTER TABLE line_bot ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE line_bot
  ADD CONSTRAINT line_bot_tenant_required_for_analysis
    CHECK (kind = 'utility' OR tenant_id IS NOT NULL);

-- RLS 說明：既有 policy 用 tenant_id = current_tenant OR role∈(aiproot_admin,...)。
-- 通用 bot tenant_id 為 NULL → 對任何租戶的 current_tenant 都不匹配（NULL = x 為 unknown），
-- 故它天然不出現在任何租戶的 bot 列表，只有 aiproot / system 角色看得到。此為預期行為。
