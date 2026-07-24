-- Migration 0025 · 外勤里程可信度／透明化
-- 對照 docs/modules/attendance-mileage-transparency.md
-- trip 道路折線 + 直線距離對照 · punch 反查地址 · 里程申訴表 · map tile 前端設定欄位
-- 全為 ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS · 不破壞既有資料（R1）

-- ============================================================
-- 1. attendance_trip · 道路折線 + 直線距離對照
-- ============================================================
ALTER TABLE attendance_trip ADD COLUMN IF NOT EXISTS route_geometry     text;      -- provider 回傳 encoded polyline · null = 未記錄（含舊資料）
ALTER TABLE attendance_trip ADD COLUMN IF NOT EXISTS straight_distance_m integer;  -- haversine 直線距離 · 與道路距離對照（落差過大＝可疑）

-- ============================================================
-- 2. attendance_punch · 反向地理編碼結果（背景補 · 非必需）
-- ============================================================
ALTER TABLE attendance_punch ADD COLUMN IF NOT EXISTS address     text;
ALTER TABLE attendance_punch ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;

-- ============================================================
-- 3. map_routing_config · tile provider + key（前端設定 · osm 免金鑰）
-- ============================================================
ALTER TABLE map_routing_config ADD COLUMN IF NOT EXISTS tile_provider    text NOT NULL DEFAULT 'osm';
ALTER TABLE map_routing_config ADD COLUMN IF NOT EXISTS tile_api_key_enc bytea;

-- ============================================================
-- 4. attendance_mileage_dispute · 里程申訴
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_mileage_dispute (
  dispute_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  trip_id      uuid        REFERENCES attendance_trip(trip_id) ON DELETE SET NULL,  -- null = 整日申訴
  report_date  date        NOT NULL,
  reason       text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'reviewing', 'resolved', 'rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid        REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  resolution   text
);
CREATE INDEX IF NOT EXISTS ix_mileage_dispute_tenant_status ON attendance_mileage_dispute (tenant_id, status);
-- 每 (user, report_date, trip_id) 僅一筆 pending（防洗版）· trip_id null 用固定 sentinel 併入唯一鍵
CREATE UNIQUE INDEX IF NOT EXISTS uq_mileage_dispute_pending
  ON attendance_mileage_dispute (user_id, report_date, coalesce(trip_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'pending';

-- RLS · tenant 隔離（比照 attendance_trip）
ALTER TABLE attendance_mileage_dispute ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_mileage_dispute FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_mileage_dispute_tenant ON attendance_mileage_dispute;
CREATE POLICY attendance_mileage_dispute_tenant ON attendance_mileage_dispute
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'system')
  );
