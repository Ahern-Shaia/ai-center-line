-- Migration 0023 · 外勤定位打卡 + A→B 里程
-- 對照 docs/modules/attendance-location-mileage.md M1
-- 裁定：只記距離不算費率；上班打卡 + 多次到點（逐段各一趟）；MVP 不做 geofence。
-- RLS 走 tenant 隔離（比照 tickets）。

-- ============================================================
-- 1. attendance_punch · 每次打卡一列
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_punch (
  punch_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  punch_type     text        NOT NULL CHECK (punch_type IN ('clock_in', 'arrive_site', 'clock_out')),
  lat            numeric(9,6),
  lng            numeric(9,6),
  accuracy_m     numeric,                          -- GPS 精度（公尺）· 過大標低信心
  customer_name  text,                             -- 到點指定的客戶/地點（MVP 先存名稱字串）
  source         text        NOT NULL DEFAULT 'liff_geo'
                             CHECK (source IN ('liff_geo', 'location_msg', 'manual')),
  photo_media_id uuid,                             -- 智慧升級式補拍照（可疑時）· 之後接 line_media
  suspicious     jsonb,                            -- 反作弊旗標明細 · null = 乾淨
  punched_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_attendance_punch_user_day ON attendance_punch (user_id, punched_at);

-- ============================================================
-- 2. attendance_trip · 逐段一趟（前一個打卡點 → 此點）
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_trip (
  trip_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  from_punch_id  uuid        NOT NULL REFERENCES attendance_punch(punch_id) ON DELETE CASCADE,
  to_punch_id    uuid        NOT NULL REFERENCES attendance_punch(punch_id) ON DELETE CASCADE,
  distance_m     integer,                          -- null = 尚未算出 / provider 失敗（不阻擋打卡）
  route_provider text,                             -- 實際用的 provider（google_routes / openrouteservice）
  computed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_attendance_trip_user ON attendance_trip (user_id, created_at);

-- ============================================================
-- 3. RLS · tenant 隔離
-- ============================================================
ALTER TABLE attendance_punch ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_punch FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_punch_tenant ON attendance_punch;
CREATE POLICY attendance_punch_tenant ON attendance_punch
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'system')
  );

ALTER TABLE attendance_trip ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_trip FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_trip_tenant ON attendance_trip;
CREATE POLICY attendance_trip_tenant ON attendance_trip
  USING (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'consultant', 'system')
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.actor_role', true) IN ('aiproot_admin', 'system')
  );
