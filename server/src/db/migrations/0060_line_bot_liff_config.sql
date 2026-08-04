-- 0060_line_bot_liff_config.sql — line_bot 加 per-bot LIFF 設定
-- 冪等：可重跑
--
-- 背景（docs/modules/liff-multi-provider.md）：
-- LINE 的 userId / groupId 是**依 provider 發放**的。LIFF 取得的 line_user_id 屬於
-- 「LIFF app 所掛的 LINE Login channel」的 provider；webhook 收到的屬於「messaging channel」
-- 的 provider。兩者不同 provider 時，同一個人有兩組不同 ID，
-- 綁定寫進去的值永遠對不上 webhook 查詢的值 —— 而且**綁定流程看起來是成功的**。
--
-- 2026-08-04 實際踩到：aiproot 開了自己 provider 的 channel（2004733504），
-- 員工透過共用 LIFF（Login channel 2010801742，屬舊 provider）綁定「成功」，
-- 但 bot 持續回「看起來還沒完成綁定」。
--
-- 兩欄都 nullable —— 未設定時 fallback 到現行 env（LIFF_URL / LINE_LOGIN_CHANNEL_ID），
-- 既有的台灣福祉、鮮湧完全不受影響（R1 破壞性變更需可回退）。
--
-- 註：這裡**不存 login channel secret**。LIFF access token 的驗證走
--     https://api.line.me/oauth2/v2.1/verify，只需比對回傳的 client_id，不需要 secret。
--     網頁版「以 LINE 登入」的 OAuth 才需要 secret，那條路目前仍是單一入口（OQ-LMP-6 裁定延後）。

BEGIN;

ALTER TABLE line_bot
  ADD COLUMN IF NOT EXISTS liff_id          text,
  ADD COLUMN IF NOT EXISTS login_channel_id text;

COMMENT ON COLUMN line_bot.liff_id IS
  '這支 bot 要用哪個 LIFF app（形如 2010801742-WBQkAv5t）· 必須與 messaging channel 同 provider · NULL 則 fallback 到 LIFF_URL env';
COMMENT ON COLUMN line_bot.login_channel_id IS
  'liff_id 所屬的 LINE Login channel ID · 用來比對 LIFF access token 的 client_id，擋掉跨 provider 的 token · NULL 則退回 LIFF_CHANNEL_IDS/LINE_LOGIN_CHANNEL_ID 允許清單';

COMMIT;
