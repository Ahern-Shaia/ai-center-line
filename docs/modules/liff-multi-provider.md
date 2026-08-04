# 設計文件 · LIFF / LINE Login 多 provider 支援（M0）

> 狀態：**M0 已裁定（2026-08-04 · 用戶「全採建議」）→ 進 M1**（依 CLAUDE.md R6）
>
> 裁定結果：OQ-LMP-1 (a) 欄位放 `line_bot`／-2 (a) fallback env + 告警／-3 (a) query param／
> -4 (a) 刪掉錯綁定／-5 (a) 後台 UI 併入 M1／-6 (b) 網頁登入之後另開／-7 (a) 沿用 `LINE_CONFIG_ENC_KEY`。
> 對象：`server/src/line-ingest/line-webhook.service.ts`（`buildLiffUrl`）、`server/src/auth/line-oauth.service.ts`、`web/src/liff/main.tsx`、`web/public/liff/binding.html`、`line_bot` 表。
> 日期：2026-08-04 · 作者：ahern + Claude
> 相關：[`liff-webapp-consolidation.md`](liff-webapp-consolidation.md)（頁面收斂，不同議題）、[`employee-line-binding.md`](employee-line-binding.md)

---

## 1. 目標與範圍

### 1.1 目標

讓**不同 LINE provider 底下的 messaging channel** 都能正常使用 LIFF 綁定與 LIFF 頁面
（我的日報 / 設密碼 / 外勤打卡 / 我的行程）。

### 1.2 觸發事件

2026-08-04 aiproot 開了自己的 messaging channel（`2004733504`）並接手「台灣福祉機器人測試群」。
員工柏淵透過 LIFF 綁定「成功」了，但 bot 仍持續回「看起來還沒完成綁定」。

### 1.3 不做的事

- 不改 LIFF 頁面的內容 / 資料同步（那是 `liff-webapp-consolidation.md` 的範圍）
- 不改「一個 LINE 帳號可綁多租戶」的既有解法（`(bot_id, line_user_id)` 複合鍵維持不變）
- 不做 provider 自動偵測 —— provider 歸屬由人在後台設定

---

## 2. 現況走查（2026-08-04 prod 實查）

### 2.1 根因

**LINE 的 `userId` / `groupId` 依 provider 發放。** LIFF 取得的 `line_user_id` 屬於
「LIFF app 所掛的 LINE Login channel」的 provider；webhook 收到的 `line_user_id` 屬於
「messaging channel」的 provider。兩者不同 provider 時，同一個人拿到兩個不同 ID，
綁定寫進去的值永遠對不上 webhook 查詢的值。

實測佐證 —— 柏淵一個人，兩組 ID：

| 來源 | line_user_id |
|---|---|
| LIFF 綁定寫入（Login channel `2010801742` 的 provider） | `Ua5a8923fdacb56ba3da72b378ea16548` |
| aiproot messaging channel `2004733504` 的 webhook | `U7c0f5ae90eaa766c2da8c21b0e62e714` |

同樣地，同一個實體群「台灣福祉機器人測試群」在兩個 provider 下是
`C807e1df2e7e17ffde6a5df33ddf34104` 與 `C0179efb56e6ea107ebe9169e047e3d3e`。

### 2.2 爆炸半徑（目前只有 aiproot 一家）

以「綁定記錄的 `line_user_id` 是否出現在同支 bot 的 `line_member`」為判準：

| bot | channel | 綁定數 | 對得上 | 判定 |
|---|---|---|---|---|
| 台灣福祉 | 2010650523 | 4 | 4 | ✅ 與 Login channel 同 provider |
| 鮮湧AI客服 | 2010843506 | 4 | 2 | ✅ 另 2 筆只是本人從未在群內發言（非 provider 問題） |
| aiproot | 2004733504 | 1 | 0 | ❌ 跨 provider |

`鮮湧AI客服` 的 webhook 看到的 4 個 user id 與台灣福祉**完全相同**，
可證 `2010650523` / `2010843506` / Login channel `2010801742` 同屬一個 provider。

### 2.3 寫死的位置

| 位置 | 內容 | 影響 |
|---|---|---|
| `web/src/liff/main.tsx:20` | `LIFF_ID = "2010801742-WBQkAv5t"` | `liff.init()` 只認這支 LIFF |
| `web/public/liff/binding.html:285` | 同上（舊靜態頁） | 同上 |
| `LIFF_URL` env（單一） | `buildLiffUrl()` 的 base | 所有 bot 發出同一條連結 |
| `LINE_LOGIN_CHANNEL_ID` / `_SECRET` env（單一） | 驗證 LIFF access token 的 `client_id` | **關鍵**：per-bot LIFF 必須連帶 per-bot Login channel 憑證，否則 verify 會失敗 |

`line-oauth.service.ts:143` 已註明前提：「LIFF app 掛在 `LINE_LOGIN_CHANNEL_ID` 這支
LINE Login channel 下（verify 的 client_id 才會相符）」。

### 2.4 已經對的部分（不用改）

- `buildLiffUrl(botId, page)` 早已把 `botId` 帶進 query
- `main.tsx` 的 `resolveQuery()` 已處理 `liff.login` 導向來回時 query 被剝掉的問題
  （會退到 `liff.state` 與 hash，並用 `sessionStorage` 持久化）
- `applyLiffToken(accessToken, botId)` 已用 botId 綁死租戶

→ **只差「哪一支 LIFF / Login channel」這個維度。**

---

## 3. 方案

### 3.1 資料模型（`line_bot` 加三欄）

```sql
ALTER TABLE line_bot
  ADD COLUMN IF NOT EXISTS liff_id                 text,
  ADD COLUMN IF NOT EXISTS login_channel_id        text,
  ADD COLUMN IF NOT EXISTS login_channel_secret_enc bytea;
```

三欄皆 nullable：**未設定時 fallback 到現行 env**，既有兩家客戶零影響（R1 分段可回退）。

### 3.2 後端

- `buildLiffUrl(botId, page)` → 改為讀該 bot 的 `liff_id`；有值就用 `https://liff.line.me/{liff_id}`，
  無值退回 `LIFF_URL` env。額外把 `liffId` 也帶進 query 供前端 `liff.init()` 使用。
- `line-oauth.service` 驗證 LIFF token 時，依 `botId` 取該 bot 的 `login_channel_id/secret`，
  無值退回 env。

### 3.3 前端

`main.tsx` 的 `LIFF_ID` 改成 `resolveQuery("liffId") ?? DEFAULT_LIFF_ID`
（沿用既有 `resolveQuery` + `sessionStorage` 持久化，因為 `liff.login` 來回會剝掉 query）。

### 3.4 LINE Console（人工，R10）

在 **aiproot provider** 底下建 LINE Login channel + LIFF app，Endpoint URL 指向現有 `liff.html`，
再把 `liff_id` / `login_channel_id` / secret 填進後台。

---

## 4. 既有髒資料

aiproot bot 上有 1 筆錯的綁定（柏淵 → `Ua5a8923f...`，`liff_self_service`，2026-08-04）。
唯一鍵是 `(bot_id, line_user_id)`，所以它**不會阻擋**正確綁定寫入，
但會讓後台顯示「已綁」而 bot 說「未綁」，是典型的誤導狀態 → 應刪除。

---

## 5. 失效場景反思（FMEA · R17）

| 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|
| 綁定 | bot 未設 `liff_id`，fallback 到 env 的舊 LIFF | 跨 provider 的 bot 綁定持續寫入錯 ID，且**看起來成功** | **P0** | ⚠️ 殘留 —— 見 OQ-LMP-2；建議「messaging channel 與 Login channel 不同 provider 時拒發連結」而非靜默 fallback |
| 綁定 | `liff_id` 填錯（填成別支 provider 的） | 同上，寫入錯 ID | P1 | ⚠️ 建議後台存檔時做一次 test 綁定或至少格式檢查 |
| token 驗證 | 設了 `liff_id` 但忘了設 `login_channel_id` | verify client_id 不符 → 綁定失敗 | P1 | ✅ 三欄同時必填（DB CHECK 或 service 層驗證） |
| LIFF 導向 | `liff.login` 來回把 `liffId` query 剝掉 | `liff.init` 用到預設 LIFF → 錯 provider | P1 | ✅ 沿用既有 `resolveQuery` + `sessionStorage` |
| 前端 | 使用者的 sessionStorage 殘留前一支 bot 的 `liffId` | 綁到錯的租戶 | P1 | ⚠️ 需以 `botId` 當 sessionStorage key 命名空間 |
| 資料 | 舊的錯綁定未清 | 後台「已綁」與 bot「未綁」矛盾 | P2 | ✅ §4 刪除 |
| 回歸 | 台灣福祉 / 鮮湧 未設新欄位 | 若 fallback 壞掉則兩家客戶全部綁定中斷 | **P0** | ✅ 三欄 nullable + fallback 為現行行為；上線後必須實測兩家各一筆綁定 |

---

## 6. 開放問題（OQ-LMP-N）— 待裁定

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-LMP-1** | 三個新欄位放 `line_bot` 還是 `tenants`？ | (a) `line_bot`（b) `tenants` | **(a)** —— LIFF 綁的是 provider，而 provider 對應的是 channel，不是租戶。同租戶未來也可能有多支不同 provider 的 bot |
| **OQ-LMP-2** | bot 沒設 `liff_id` 時？ | (a) fallback env（相容）(b) 不發綁定按鈕並在 log 告警 | **(a)+告警** —— 但這是上表那條 P0 的根源，若你要更保守就選 (b) |
| **OQ-LMP-3** | 前端 `liffId` 從哪來？ | (a) query param（b) 開頁後打 API 查 | **(a)** —— (b) 需要在 `liff.init` 之前就有網路請求，且 init 前拿不到身分，複雜度不划算 |
| **OQ-LMP-4** | 柏淵那筆錯綁定？ | (a) 直接刪（b) 保留做紀錄 | **(a)** —— 它只會造成誤導 |
| **OQ-LMP-5** | 後台 UI 何時加這三個欄位？ | (a) M1 一起做（b) 先用 SQL 設，UI 之後補 | **(a)** —— 少了 UI 就等於每接一家客戶都要人工下 SQL |
| **OQ-LMP-6** | 網頁版 LINE 登入（`LINE_LOGIN_CALLBACK_URL`）要不要一起多 provider 化？ | (a) 這次一起（b) 之後另開 | **(b)** —— 網頁登入目前是單一入口，沒有 per-bot 語境；等真的有客戶要求再做 |
| **OQ-LMP-7** | `login_channel_secret` 的加密沿用 `LINE_CONFIG_ENC_KEY`？ | (a) 沿用（b) 另立 | **(a)** —— 與 `channel_secret_enc` 同性質、同威脅模型 |

---

## 7. 落地順序與里程碑

| 里程碑 | 內容 |
|---|---|
| **M0** | 本文件 · 待裁定 OQ-LMP-1..7 |
| **M1** | migration（三欄 nullable）+ `buildLiffUrl` 依 bot 取 `liff_id` + 前端 `liffId` 走 query |
| **M2** | `line-oauth.service` 依 bot 取 Login channel 憑證 + 後台 UI 三欄位 |
| **M3** | LINE Console 建 aiproot 的 Login channel / LIFF（人工）+ 填設定 + 清掉錯綁定 |
| **M4** | 回歸：台灣福祉 / 鮮湧 各實測一筆綁定不受影響；aiproot 實測綁定 + 我的日報可開 |

---

## 附錄 · 來源

- prod 實查（2026-08-04）：`line_bot` / `user_line_binding` / `line_member` 交叉比對
- memory `pitfall_line_ids_are_provider_scoped`
