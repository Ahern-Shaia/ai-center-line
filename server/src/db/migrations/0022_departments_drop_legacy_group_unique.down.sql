-- 還原 0022：加回 UNIQUE (tenant_id, line_group_id)
-- ⚠️ 注意：若此時已存在多個相同 (tenant_id, line_group_id)（例如多個沒綁群的部門都是 '-'），
--         加回 UNIQUE 會失敗（23505）· 需先人工清理／合併重複列後才能執行。
ALTER TABLE departments ADD CONSTRAINT departments_tenant_id_line_group_id_key UNIQUE (tenant_id, line_group_id);
