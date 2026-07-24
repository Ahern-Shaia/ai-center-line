# 通知中心（notification-hub · notify v3）— M0 設計

> 把散落各模組的「通知」收斂成一個**來源/管道皆可插拔**的通知中心：一條規則 = 觸發來源(source + 過濾) → 模板 → 管道 + 對象。
> 承 notify v1（Ragic→LINE 手貼 JS · 4 hardcoded sheet）、notify v2（[notify-selfserve-platform.md](notify-selfserve-platform.md) · Ragic 自助）。本文＝把「通知」抽象化、去 Ragic 化的重構。
> 狀態：**M0 設計待裁定**（OQ-NH-1..8 見 §10）。由用戶反思「通知不可能只有 Ragic 一種」而起。

---

## 1. 目標與範圍

### 1.1 目標
- 「通知設定」從 **Ragic 專屬** → **來源無關**：Ragic 表單異動只是**其中一種來源**。
- 各模組**發事件就好**、不必各自接 LINE / 各自寫推送 / 各自 dedup / 各自 audit。
- aiproot 員工在一個地方設定「什麼事 → 通知誰 → 走哪個管道」。

### 1.2 現況痛點（通知已散落且重複）
| 位置 | 做什麼 | 各自實作 |
|---|---|---|
| notify v1 | Ragic 4 sheet → LINE 群 | 4 hardcoded composer + env tenant |
| notify v2（剛上）| Ragic 自助 → LINE 群 | ragic_account/notify_config + webhook |
| `PersonalReportNotifyService` | 日報送出 → 主管**私訊** | 自己用 `LineApiClient`（**另一套** push client）|
| warroom | 待簽核/逾時 → 主管私訊 | 又一套 ad-hoc |
| （未做）| 可疑里程 / 成本超標 / 綁定異常 / 對話 P0 | 每個都得再寫一套 |

⇒ **兩套 LINE push client（`notify/LineClient` + `line-ingest/LineApiClient`）**、多份 compose/dedup/audit，重複且難維護。

### 1.3 不做的事（避免過度設計）
- 不一次收斂所有現有通知（v1/PDR/warroom 先並存，漸進遷）。
- 不做使用者訂閱偏好中心、不做通知 DAG/workflow。
- 不一次做完 email/in-app（先把抽象立起來，管道漸進加）。

---

## 2. 核心抽象

```
[來源 Source] --emit--> [NotificationEvent(正規化)] --> [Pipeline] --match--> [規則 Rule]
                                                          │ 過濾 → dedup → render 模板 → 送出
                                                          ▼
                                                    [管道 Channel] → LINE群/私訊/email/in-app
                                                          ▼
                                                    [audit notification_log]
```

- **NotificationEvent（正規化事件）**：`{ sourceType, tenantId, dedupKey, occurredAt, payload{...}, link? }`。所有來源都轉成這個形狀。
- **來源 Source connector（可插拔）**：產生 event。
  - `ragic_form`：現有 `/notify/webhook/:token` 收 Ragic webhook → 轉 event（沿用 v2）。
  - `internal_event`：模組呼叫 **NotificationBus** 發領域事件（如 `attendance.suspicious`、`signoff.overdue`）。
  - `schedule`：排程觸發（沿用 scheduler-config）。
- **規則 Rule（訂閱）**：`{ tenant, sourceType, sourceFilter(JSON), template, channelType, channelTarget, enabled }`。
- **模板 Template（通用）**：`{ title, items:[{label, path}] }`，`path` 以 dot-path 取 `event.payload`（Ragic：path=欄位 id；領域事件：path="customerName"）。
- **管道 Channel sender（可插拔）**：`line_group` / `line_user` / `email` / `in_app`。
- **Pipeline（共用中介）**：match → filter → dedup → render → send → audit。**dedup / notification_log / token 解析全共用一份**。

---

## 3. 資料模型（Migration 待 M1）

**`notification_rule`**（取代 v2 的 notify_config · 通用化）
- rule_id, tenant_id, name, enabled
- `source_type`（`ragic_form` / `internal_event` / `schedule`）
- `source_config` jsonb：
  - ragic_form → `{ ragicAccountId, sheetPath, sheetName, events:{create,update,delete}, webhookToken }`
  - internal_event → `{ eventType, filter:{...} }`（如 `{eventType:"attendance.suspicious", filter:{minKmh:150}}`）
- `template` jsonb：`{ title, items:[{label, path, order}] }`
- `channel_type`（`line_group` / `line_user` / `email` / `in_app`）
- `channel_target`（group_id / user_id / email / null）
- created_by, created_at, updated_at
- RLS：aiproot-scoped（比照 notify_config）；webhook 走 system context 讀。

**沿用**：`ragic_account`（ragic_form 來源引用）、`notification_log`（加 `rule_id` / `source_type` / `channel` 欄位）、`line_bot`（LINE token 解析）。

---

## 4. 來源 connectors

- **ragic_form**：`/notify/webhook/:token` 不變；token 現在對到 **rule**（非 config）。收到 → fetch record → 組 `NotificationEvent{ sourceType:'ragic_form', payload: record }`。
- **internal_event**：新增 **`NotificationBus`**（服務）。模組注入它、`bus.emit({ type:'attendance.suspicious', tenantId, payload, dedupKey })`。Hub 訂閱、比對 `source_type='internal_event'` 且 `eventType` 相符的 rule。
  - 匯流機制：in-process（NestJS EventEmitter2 或自寫）——見 OQ-NH-1。
- **schedule**：排程規則到點 → 產 event（Phase 後）。

## 5. 管道 senders
- `line_group` / `line_user`：統一走**一個** LINE push（收斂現有兩套 client；token 由 line_bot 依 tenant 解析；user 由 user_line_binding 解析）。
- `email`：新 EmailSender（Phase 2 · 需 SMTP/provider 設定）。
- `in_app`：寫 `notification_inbox` + 戰情室紅點（Phase 2）。

## 6. 模板統一
`composeFromTemplate(template, payload, link)`：`【title｜事件】` + `items` 逐行 `label：payload[path]`（缺值→（未填））+ 連結。**v2 的 `composeFromConfig` 直接演進成這個**（Ragic 欄位＝payload keys）。

---

## 7. 遷移策略（v2 → v3 · 不丟）
- notify v2 剛上、資料量少 → **一次性搬**：`notify_config` → `notification_rule`（source_type=ragic_form、source_config 帶 ragic 欄位、template 由 fields 組、channel_type=line_group、target=lineGroupId、保留 webhook_token）。`ragic_account` 續用。
- webhook 端點改「依 token 查 rule」。v2 的 service/composer/webhook 幾乎原地演進。
- notify v1（4 hardcoded）+ PDR/warroom 私訊：**先並存**，Phase 後逐步改發 internal_event 收斂。

## 8. 失效場景反思（FMEA · R17）
| 路徑 | 失效 | 嚴重度 | 緩解 |
|---|---|---|---|
| 過度抽象 | 抽象撐不起真實來源、變成空殼 | **P1** | Phase 1 只做 2 來源(ragic+1內部) × 1-2 管道，用「第二來源」當試金石驗證可插拔 |
| in-process event bus | crash 時 event 遺失（無持久化）| P2 | Phase 1 可接受（通知非交易關鍵）；量大/關鍵改 outbox（OQ-NH-1）|
| 模板 path 取不到 | 欄位空/改名 | P2 | 缺值→（未填）；rule 建立時可預覽 |
| 管道失敗 | LINE/email 掛 | P2 | 不 retry、audit line_failed（沿用 v2）|
| 遷移 | v2 資料搬錯 | P2 | 一次性搬 + 對數量 + 保留 webhook_token 不變 |
| PII 跨管道 | email 外洩地址/個資 | **P1** | 管道級遮罩策略；email 屬 Phase 2 再定 |

## 9. 里程碑
| 里程碑 | 內容 |
|---|---|
| **M1** | 核心：`notification_rule` + `NotificationEvent` + pipeline + 通用 template renderer；**v2 遷移**（notify_config→rule、webhook 改查 rule）；LINE push 收斂成單一 client |
| **M2** | 第一個 internal_event 來源（NotificationBus + 1 個領域事件當試金石）+ 該來源的規則設定 UI（source_type 選擇 → 動態表單）|
| **M3** | 第二個管道（LINE 私訊 or email 擇一）+ 前端多來源/多管道 UI 收斂 |
| **M4** | 漸進收斂 PDR/warroom/v1 進 hub（選做）+ docs/FMEA/SOP |

---

## 10. 開放問題（OQ-NH-N · 待裁定才進 M1）
- **OQ-NH-1 事件匯流機制**：in-process（`@nestjs/event-emitter` 需加依賴 / 自寫簡易 bus）vs 持久化 outbox？**建議**：Phase 1 自寫簡易 in-process bus（不加依賴、crash-lost 可忍）；關鍵/量大再上 outbox。
- **OQ-NH-2 第一批「來源」**：Ragic ✅ + 哪個內部事件當試金石？**建議**：`attendance.suspicious`（可疑里程）或 `signoff.overdue`（簽核逾時）挑一。
- **OQ-NH-3 第一批「管道」**：LINE 群 ✅ + LINE 私訊？email/in-app 延後？**建議**：群 + 私訊先做（都已有基礎）；email/in-app Phase 2。
- **OQ-NH-4 v2 遷移**：一次性搬進 rule / v2·v3 並存？**建議**：一次性搬（v2 剛上、量少）。
- **OQ-NH-5 模板模型**：`{label,path}` 清單 / 自由文字 `{{path}}` 插值？**建議**：清單起步（沿用 v2），自由模板 Phase 2。
- **OQ-NH-6 規則過濾複雜度**：只相等/門檻 vs 條件運算式？**建議**：相等 + 數值門檻起步。
- **OQ-NH-7 收斂既有**：PDR/warroom/v1 私訊要不要改發 internal_event 進 hub？**建議**：Phase 後漸進，M1-M3 先並存。
- **OQ-NH-8 前端多來源 UI**：一個 wizard 依 source_type 動態換表單 vs 各來源各頁？**建議**：一頁、source_type 選擇 → 動態表單（Ragic 沿用 v2 wizard 當 ragic_form 分支）。

> 相關：[notify-selfserve-platform.md](notify-selfserve-platform.md)（v2 · 被本文演進）、[`../ragic-http-api-手冊.md`](../ragic-http-api-手冊.md)、`server/src/notify/line.client.ts` + `server/src/line-ingest/line-api.client.ts`（待收斂的兩套 push client）。
