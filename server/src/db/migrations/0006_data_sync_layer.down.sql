-- 0006_data_sync_layer.down.sql — 反向 rollback 5 表
-- 順序：先 order/contact（依賴 customer FK）· 再 customer · sync_log / writeback_queue 獨立

BEGIN;

DROP TABLE IF EXISTS data_sync_order;
DROP TABLE IF EXISTS data_sync_contact;
DROP TABLE IF EXISTS data_sync_customer;
DROP TABLE IF EXISTS data_sync_log;
DROP TABLE IF EXISTS data_sync_writeback_queue;

COMMIT;
