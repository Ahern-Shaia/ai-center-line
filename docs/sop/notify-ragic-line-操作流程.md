# Ragic → LINE 通知 · 操作流程手冊

> notify 模組端到端操作流程 + 金鑰一覽 + 新增 sheet/租戶步驟 + 排錯。免日後再翻 code。
> 版本：v1.0（2026-07-25）｜對應：`docs/modules/notify.md` + `notify-multi-tenant.md`｜Ragic 端範本：`docs/sop/ragic-workflow-templates/`

---

## 0. 一句話

業助在 Ragic 改某張單 → Ragic 端 JS workflow 把欄位打包 POST 到我方 webhook（帶 `X-Notify-Secret`）→ 後端驗簽 + 去重 + 組訊息 → 用該租戶的 LINE token 推到該租戶的業助群。

## 1. 端到端流程

```
[Ragic 表單改動]
   │  ① 儲存後自動（Post-workflow）  或  按「發送 LINE 通知」（Action Button）
   ▼
[Ragic 端 JS workflow]
   │  param.getUpdatedEntry() / db.getAPIQuery().getAPIEntry(rid) 抓欄位值
   │  組 payload{ trigger, sheetPath, sheetName, recordUrl, timestamp, recordId, record{欄位:值} }
   │  util.setHeader("X-Notify-Secret", <我方 secret>)  ← 唯一憑證
   │  util.postURL(BACKEND_URL + "/notify/ragic/<type>", JSON)
   ▼
[後端 POST /notify/ragic/<type>]（@Public，跳過 JWT）
   │  WebhookSecretGuard：X-Notify-Secret 比對所有租戶 secret（timing-safe）→ 命中設 req.tenant，否則 401
   │  zod 驗 body，不合 400
   ▼
[NotifyService.handle 五關]
   │  ① sheet 白名單（allowedSheetPaths 非空才擋跨租戶）
   │  ② timestamp ±5 分鐘（防 replay；不帶則放行）
   │  ③ 30 秒 dedup（key = tenant+sheet+recordId，防重複儲存/連按）
   │  ④ compose 企業風訊息
   │  ⑤ LINE push（該租戶 token → 該租戶業助群）→ 寫 notification_log（帶 tenant_id）
   │     LINE 失敗不 retry、記 line_failed（不擋 Ragic 存檔）
   ▼
[業助群 LINE 收到通知]
```

## 2. 現況 endpoints × 租戶

| 租戶 slug | endpoint（`POST /notify/ragic/…`）| sheet | Ragic 範本 |
|---|---|---|---|
| `twh` 台灣福祉 | `maintenance-report` | TB-P71 維修保養單 `/service-tickets/10` | `tbp71-*.js` |
| `twh` 台灣福祉 | `analysis-sheet` | TB-P01 分析表 `/order-operation/11` | `tbp01-*.js` |
| `xianyong` 鮮勇 | `quotation` | 報價單 `/erp/1` | `xianyong-quotation-*.js` |
| `xianyong` 鮮勇 | `material-inspection` | 原料驗貨單 `/erp/64` | `xianyong-material-inspection-*.js` |

每種都有 `*-post-workflow.js`（儲存自動）+ `*-action-button.js`（手動按）兩版。

## 3. 金鑰 / 密鑰一覽（★ 這裡最容易搞混）

| 憑證 | 放哪 | 誰用 | 用途 |
|---|---|---|---|
| **`X-Notify-Secret`**（= `NOTIFY_WEBHOOK_SECRET[_<SLUG>]`）| **寫死在 Ragic workflow JS 裡** + 後端 env | Ragic → 後端 | 驗證「這通 webhook 真的來自我們設定的 Ragic」＋**兼租戶識別**（secret 命中哪個租戶就是哪個）。長度需 ≥ 16 |
| **`LINE_CHANNEL_ACCESS_TOKEN[_<SLUG>]`** | 後端 env | 後端 → LINE | 推訊息用的 LINE bot token |
| **`LINE_GROUP_ID_BUSINESS_ASSIST[_<SLUG>]`** | 後端 env | 後端 → LINE | 目標業助群 group id |

> **⚠️ notify 流程「不需要」Ragic API Key**。
> - Post-workflow 用 `param`（Ragic 把 entry 直接傳進來）；Action Button 用引擎內建 `db`——兩者都在 Ragic 伺服器內執行，不打外部 API，**不需 Ragic API 金鑰**。
> - Ragic API Key 只在**反方向**（我方後端主動「讀」Ragic 資料 / 資料匯流）才需要——那是 data-sync 的事，跟本通知流程無關。

env 命名規則（見 `server/src/notify/tenant.registry.ts`）：
- 台灣福祉＝**無後綴** default：`NOTIFY_WEBHOOK_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_GROUP_ID_BUSINESS_ASSIST` / `NOTIFY_TENANT_SHEETS_TWH`
- 其他租戶＝**大寫 slug 後綴**：`NOTIFY_WEBHOOK_SECRET_XIANYONG` / `LINE_CHANNEL_ACCESS_TOKEN_XIANYONG`（缺則 fallback default）/ `LINE_GROUP_ID_BUSINESS_ASSIST_XIANYONG`（同）/ `NOTIFY_TENANT_SHEETS_XIANYONG`
- 開機時 `buildTenantRegistry` 驗證：secret 缺/過短/碰撞、token/group 缺 → **直接 crash（fail-loud）**

## 4. 新增一個 sheet（同租戶）

1. **後端**（跟現有 4 個一模一樣）：`server/src/notify/` 加
   - `dto/ragic-<name>.dto.ts`（zod schema）
   - `compose/compose-<name>.ts`（企業風訊息）
   - `notify.service.ts` 加 `handle<Name>()`（一行轉呼 `this.handle`）
   - `notify.controller.ts` 加 `@Post("<name>")`（複製現有 block）
2. **Ragic 端**：複製一份範本 JS（post + action-button），改 `SHEET_PATH` / `SHEET_NAME` / `recordUrl` base / `entry.getFieldValue(<欄位id>)` 對應欄位，換 `X-Notify-Secret`。
3. **欄位 id** 怎麼查：Ragic 設計模式點欄位看下方欄位 id，或 sheet → 三角 → Javascript 工作流程。
4. 詳細指南見 `docs/sop/ragic-workflow-templates.md`。

## 5. 新增一個租戶

1. **後端 env**（Render）設：`NOTIFY_WEBHOOK_SECRET_<SLUG>`（≥16 字、隨機、不可與別租戶撞）、`LINE_CHANNEL_ACCESS_TOKEN_<SLUG>`、`LINE_GROUP_ID_BUSINESS_ASSIST_<SLUG>`、（選）`NOTIFY_TENANT_SHEETS_<SLUG>`（逗號分隔白名單）。
2. **顯示名**：`tenant.registry.ts` 的 `KNOWN_TENANT_DISPLAY_NAMES` 加一行 `<slug>: "顯示名"`。
3. 重啟後端（env 變更）→ 開機 log 會列出註冊的租戶。
4. 該租戶各 sheet 走 §4 加 endpoint + Ragic 範本（secret 換成該租戶的）。

## 6. 排錯

| 症狀 | 排查 |
|---|---|
| 改單/按按鈕都沒收到通知 | 先看 Ragic workflow 是否貼在**該 sheet 的 Post-workflow**（不是 Global）；Action Button 是否**單行、無 `//`** |
| Ragic「應通但沒 fire」 | Ragic Post-workflow 儲存後常需**登出重進**才 active（session cache metadata）|
| 後端回 401 | `X-Notify-Secret` 沒帶或跟 env 對不上（secret 兼識別，錯了就無租戶命中）|
| 後端回 400 | payload 格式不符 zod（欄位缺/型別錯）|
| 回 `sheet_not_allowed` | 該租戶有設白名單且此 sheetPath 不在內 |
| 回 `skipped_dedup` | 30 秒內同一筆重複觸發（正常防呆）|
| 回 `line_failed` | LINE token 過期/群 id 錯/被踢出群；查 `notification_log.line_status`|
| 想看歷史 | 查 `notification_log` 表（status: sent / skipped_dedup / line_failed / sheet_not_allowed；帶 tenant_id / latency）|

## 7. 相關檔案

- 後端：`server/src/notify/`（controller / service / webhook-secret.guard / tenant.registry / line.client / dedup / repository + `dto/` + `compose/`）
- Ragic 端 JS 範本：`docs/sop/ragic-workflow-templates/`（8 支）
- Ragic Workflow 踩坑 + 換 sheet 指南：`docs/sop/ragic-workflow-templates.md`
- 設計文件：`docs/modules/notify.md`、`docs/modules/notify-multi-tenant.md`
- Ragic HTTP API（反方向讀資料時用）：`docs/ragic-http-api-手冊.md`
