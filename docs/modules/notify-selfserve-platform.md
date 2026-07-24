# Notify 自助設定平台（notify v2 · config-driven）— M0 設計

> 讓「電腦小白」在網站前端就能設定「Ragic 某表單異動 → LINE 通知」，免找欄位 ID、免寫/貼 workflow JS、免工程師介入。
> 承 [notify.md](notify.md) / [notify-multi-tenant.md](notify-multi-tenant.md)（現行 v1：每 sheet 一組 hardcoded DTO/composer + 手貼 JS）。
> 狀態：**M0 設計待裁定**（三格已裁定見 §3；剩餘 OQ-NSP-1..8 見 §11）。

---

## 1. 目標與範圍

### 1.1 目標
- 新增一個「Ragic 表單 → LINE 通知」設定，從「工程師寫 code + 客戶找欄位 ID + 手貼 JS」變成**前端點選 + 貼一個 URL**。
- 支援多 Ragic 帳號（台灣福祉 / 2026carhouse / 鮮勇 / Freshfruits …）× 多表單，皆可自助設定。

### 1.2 Stakeholder 痛點（現況 v1）
- **每張表單**：人工到 Ragic 設計模式找每個欄位的「欄位編號」→ 給工程師 → 工程師寫 DTO/composer/endpoint + workflow JS → 客戶把 JS 貼進該表單。
- **每家公司**：切換 Ragic 帳號、各自處理。
- ⇒ N 帳號 × M 表單，每組都要工程師 + 手工，**無法自助、不可規模化**。

### 1.3 不做的事（Phase 1）
- 不做拖拉式版面編輯器（只給「勾欄位 + 排序 + 自訂標題」）。
- 不做「只在特定欄位變化才通知」的條件過濾（先看實際噪音，OQ-NSP-4）。
- 不強拆現有 v1 的 4 個 hardcoded endpoint（並存，OQ-NSP-5）。
- 不開放 tenant_admin 自助（Phase 1 aiproot 操作；§3 裁定）。

---

## 2. 現況走查（v1）
- `server/src/notify/`：controller（4 個 hardcoded `@Post`）+ service（`handle<X>` 各一）+ `dto/`（每 sheet 一個 zod）+ `compose/`（每 sheet 一個手刻企業風 composer）+ tenant.registry（env-based）+ webhook-secret.guard（X-Notify-Secret 兼租戶識別）+ line.client + dedup + repository（notification_log）。
- Ragic 端：`docs/sop/ragic-workflow-templates/` 8 支手貼 JS（post + action-button），內含寫死的 `X-Notify-Secret` + 逐一列的 `entry.getFieldValue(<id>)`。
- **可複用**：line.client（stateless push）、dedup、notification_log audit、tenant 概念、企業風訊息排版邏輯（缺值→（未填）、行長上限）。

---

## 3. 已裁定方向（2026-07-25）
「選項 A」三格全取 + OQ-NSP-1..8 全採建議（§11）+ 權限控管（§4-bis）。

| 決策 | 裁定 |
|---|---|
| **觸發機制** | **Ragic 原生 Webhook**（sheet → 工具 → Webhook 貼一個 URL；免貼 workflow JS）|
| **操作者** | **Phase 1 僅 aiproot**（我方顧問/業助幫客戶設；日後再評估開放 tenant 自助）|
| **訊息模板** | **通用「逐行 欄位：值」+ 標題 + Ragic 連結**（勾欄位 + 排序 + 自訂標題，不做拖拉版面）|
| **權限控管** | 走 permission-engine · 新增 `notify-config` 權限 · **分配給 aiproot 側員工**（見 §4-bis）|

## 4-bis. 權限控管（2026-07-25 用戶要求）

> 本功能操作權**不是全體皆可**，要能分配給 aiproot 的員工。走既有 [permission-engine](permission-engine.md)（RBAC · @RequirePermission + PermGate）。

- **新增權限**：`notify-config:view`（看設定列表）、`notify-config:manage`（新增/改/停用 config、管 Ragic 帳號 key）。
- **預設分配**（`role_permissions`）：`aiproot_admin` + `consultant`（＝ aiproot 側員工/顧問角色）。**tenant_admin / group_owner 不給**（Phase 1 僅 aiproot 操作）。
- **後端**：notify-config 相關 endpoint 全掛 `@RequirePermission("notify-config:manage")`（讀列表用 `:view`）。
- **前端**：側欄「AIPROOT 管理」下的「通知設定」入口 + 頁面用 `PermGate` / `usePermissions("notify-config:*")` 過濾。
- **粒度**：Phase 1 以角色分配（aiproot_admin/consultant）。要「指定某幾位員工」的更細粒度＝permission-engine Phase 2 自訂 role（未來需求再上）。
- **Ragic API key 存取**：只有具 `notify-config:manage` 者能設/換 key；key 一律加密、不回明碼（呼應 OQ-NSP-6）。

---

## 4. 架構（config-driven）

```
[前端 · aiproot 設定 UI]
   1. 加 Ragic 帳號（server 區域 + apname + API key〔加密存〕）
   2. 選/輸入 sheet → 平台呼叫 Ragic metadata/schema（用該帳號 key）→ 列出欄位（中文名）
   3. 勾要通知的欄位 + 排順序 + 自訂標題 + 選 LINE 目標群 + 選事件（create/update）
   4. 平台產生唯一 webhook URL：/notify/webhook/<configToken> → 顯示給使用者
   5. 使用者把此 URL 貼進「該 sheet 的 Ragic Webhook 設定」→ 完成
        │
        ▼
[Ragic 原生 Webhook]  資料變動時自動 POST（含 apname/path/sheetIndex/eventType/data + signature）
        │
        ▼
[後端 POST /notify/webhook/:configToken]（@Public）
   ① configToken → 查 notify_config（不存在/停用 → 404/410）
   ② （選）驗 Ragic signature（SHA256withRSA · Ragic 公鑰）→ 確認來自 Ragic
   ③ 取 eventType + recordId；若 config.events 不含此事件 → 忽略
   ④ 用該帳號 API key fetch 完整 record（GET .../{sheetIndex}/{recordId}?api）→ 保證欄位齊全
   ⑤ 30 秒 dedup（key = configId + recordId）
   ⑥ 動態 composer（依 config 的欄位順序 + 標題 + 連結 + 缺值處理）組訊息
   ⑦ LINE push（該 config 綁的 LINE 群）→ 寫 notification_log（帶 config_id / tenant）
        │
        ▼
[LINE 業助群收到通知]
```

**關鍵：webhook URL 的 `configToken` 是不可猜測隨機值、綁定唯一一筆 config**——URL 本身即認證（誰設定誰才知道），再加 Ragic signature 當縱深防禦。

---

## 5. 資料模型（Migration 待 M1）

**`ragic_account`**（每家 Ragic 帳號一列）
- account_id, tenant_id, server（`ap16`/`www`…）, apname, display_name, api_key_enc（pgcrypto）, created_by, created_at
- API key 需「帳號管理者」權限（metadata/schema 要）。

**`notify_config`**（每個「表單→通知」設定一列）
- config_id, ragic_account_id, sheet_path, sheet_name, webhook_token（unguessable · unique）, title（自訂標題 nullable）, fields（jsonb：`[{fieldId, label, order}]`）, events（`{create,update,delete}` bool）, line_group_id, enabled, created_by, created_at
- RLS：tenant 隔離（比照 notification_log）。

**`ragic_sheet_field_cache`**（選配 · 加速 UI）
- 快取某 sheet 的 metadata/schema 結果；可即時 re-fetch。

---

## 6. Ragic Webhook 接收細節
- **payload**（含完整內容模式）：`{ data:[{fieldId:value}], apname, path, sheetIndex, eventType }`（eventType = CREATE/UPDATE/DELETE）。
- **取 recordId**：由 payload / data 取變更的資料 id。
- **抓完整 record**：以該帳號 API key `GET /{apname}{path}/{sheetIndex}/{recordId}?api` 取全欄位（webhook data 可能只給部分/變更欄位）→ 餵 composer（OQ-NSP-2）。
- **DELETE**：record 已不存在、無法 fetch → 若開啟 delete 通知則用 payload data 組簡訊（OQ-NSP-3）。
- **簽章驗證**：Ragic 公鑰全域（只證「來自 Ragic」不證租戶）→ 租戶綁定靠 configToken；signature 為縱深防禦（OQ-NSP-1）。

## 7. metadata/schema 整合
- UI 加 sheet 時：`GET /{apname}{path}/{sheetIndex}/metadata/schema?api`（該帳號 key · 需帳號管理者）→ 回 fields[]（fieldId/fieldName/type）→ 顯示勾選清單。
- 備援：key 權限不足/失敗 → 允許手動輸欄位 id + label（OQ-NSP-8）。

## 8. 動態 composer
- 通用化現有 4 個手刻 composer：`【{title或sheetName}｜{event中文}】` + 逐行 `{label}：{value|（未填）}`（依 config.fields order）+ 末尾 `檢視完整資料：{recordUrl}`。
- 沿用 v1 的缺值→（未填）、行長上限、LINE 5000 字整體檢查。

## 9. 遷移策略（相容）
- **並存**：v1 的 4 個 hardcoded endpoint 保留運作（台灣福祉/鮮勇現行不動）；新表單走 config-driven webhook。
- 舊 4 張日後可「重建為 config + 把 Ragic 從手貼 JS 換成 Webhook」逐步遷移（非必須）。

---

## 10. 失效場景反思（FMEA · R17）
| 路徑 | 失效 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|
| webhook 認證 | 有人猜/偽造 URL 灌通知 | 假通知 | **P1** | configToken 不可猜 + （選）Ragic signature 驗（OQ-NSP-1）|
| Ragic API key | 外洩 | 可讀該公司整個 Ragic | **P1** | pgcrypto 加密 · aiproot-only · 不回明碼 · audit · 每帳號獨立 |
| 未授權存取設定 | 無權者改 config / 看/換 key | 亂發通知 · key 曝險 | **P1** | permission-engine 掛 `notify-config:manage`（僅 aiproot_admin+consultant）· 前後端雙擋（§4-bis）|
| 全 CRUD 噪音 | 每次存都通知 | 業助被洗版 | P2 | events 設定（可只 update）+ dedup 30s；條件過濾 Phase 2（OQ-NSP-4）|
| schema 漂移 | 欄位改名/刪 | 訊息缺欄位 | P2 | 缺值→（未填）· UI 可 re-fetch schema |
| fetch record 失敗/限流 | Ragic 慢或 429 | 訊息延遲/失敗 | P2 | 記 line_failed/skipped、不 retry；> 5 req/s Ragic 會人工審 |
| Ragic webhook 不重送 | 我方掛掉時漏事件 | 漏通知 | P2 | best-effort（比照 v1）；audit log 可查 |
| DELETE 通知舊資料 | 誤導 | 中 | P2 | delete 預設關（OQ-NSP-3）|

---

## 11. 開放問題（OQ-NSP-N）— 全數裁定 2026-07-25（用戶「全採建議」，以下建議即裁定）
- **OQ-NSP-1 webhook 認證**：configToken URL only／+ Ragic signature 驗？**建議**：token 為主 + signature 縱深。
- **OQ-NSP-2 資料來源**：直接用 webhook payload data／收到後 API fetch 完整 record？**建議**：fetch 完整 record（保證欄位齊、值最新）。
- **OQ-NSP-3 事件**：預設通知哪些？**建議**：create + update；delete 預設關可開。
- **OQ-NSP-4 條件過濾**：要不要「只在某欄位變化才通知」？**建議**：Phase 1 不做，先看噪音。
- **OQ-NSP-5 舊 4 endpoint**：並存 or 遷移？**建議**：並存，新表走 config，舊的日後再遷。
- **OQ-NSP-6 API key 保管**：aiproot 全域 vs per-tenant？誰可見？**建議**：per-ragic-account 加密、aiproot-only、不回明碼。
- **OQ-NSP-7 模板客製度**：Phase 1 只「勾欄位+排序+自訂標題」？**建議**：是（不做拖拉版面）。
- **OQ-NSP-8 schema key 權限**：客戶給的 key 若非帳號管理者、metadata/schema 失敗怎辦？**建議**：備援手動輸欄位 id+label。

---

## 12. 里程碑
| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M1** | migration 0026（ragic_account / notify_config）+ `notify-config:view/manage` 權限（給 aiproot_admin+consultant）+ RagicApiClient（metadata/schema + fetch record）+ RagicAccount/NotifyConfig service + 動態 composer | ✅ 本地 SHIPPED |
| **M2** | `POST /notify/webhook/:token` 接收 + 事件過濾 + dedup + fetch record（best-effort）+ 動態 compose + LINE token 解析（line_bot/env）+ audit | ✅ 本地 SHIPPED |
| **M3** | aiproot 前端「通知設定」（列表 + wizard：加帳號 → 抓欄位 → 勾選 → 事件/LINE群 → 產 webhook URL）+ controller（@RequirePermission）| ✅ 本地 SHIPPED |
| **M4** | docs 收尾 + FMEA + 使用 SOP + MODULES | ✅ 本文 |

> **實作 caveat（需真 Ragic 才驗得到）**：
> - **Webhook 認證＝token only**（不可猜 24-byte token）；Ragic **簽章驗證未做**（OQ-NSP-1 縱深部分列後續 hardening）。
> - **Ragic webhook 實際 payload 形狀**（recordId 欄位、data 結構）以 `parseRagicWebhook` 防禦式解析，接第一個真 webhook 時需驗證/微調。
> - **metadata/schema 抓欄位** 需該帳號 key 具帳號管理者權限（OQ-NSP-8 備援：手動輸欄位尚未做，目前 key 不足會報錯）。
> - **編輯既有 config** 尚未做（M3 v1 只有新增 + 啟停 + 刪除）；改設定＝刪掉重建。

**部署順序（push 時）**：先在 prod 跑 **migration 0026**（含權限 seed），再讓 Render 部署，否則 `/notify-config*` 端點會 500。

> 相關：[`docs/sop/notify-selfserve-使用指南.md`](../sop/notify-selfserve-使用指南.md)（v2 UI 操作）、[`docs/ragic-http-api-手冊.md`](../ragic-http-api-手冊.md)、[`docs/sop/notify-ragic-line-操作流程.md`](../sop/notify-ragic-line-操作流程.md)（v1 手貼 JS 流程）。
