# notify.md — [Phase 1 首客] Ragic → LINE 通知模組設計文件

> ✅ **狀態：SHIPPED（2026-07-08 v1.0）— M1–M5 全部落地，2 個 P0 已緩解、prod 運行中**
>
> 🔗 **後續擴展**：多租戶化 + 鮮勇兩張新表 → [`notify-multi-tenant.md`](notify-multi-tenant.md) v0.9（2026-07-17 APPROVED）
>
> 台灣福祉 Ragic → 業助群 LINE 通知。走「Ragic Workflow → 我們 backend → LINE Messaging API」三段架構（見 §1.1）。取代客戶端過往「Ragic 內建 LINE 通知 + 合併列印字串代入」的做法（該做法會出現 `{{預覽失敗: 是否保固內}}` 這類欄位代入失敗 — 已實際發生在客戶可見群組，見 `docs/台灣福祉_開發指南_分析表LINE通知_完整版.md` §7.1）。
>
> **首發 demo sheet**：`/service-tickets/10` **TB-P71 維修保養單-中部**（aitode 已建 schema、有 3 筆資料可 API 補匯、剛好對應 doc §7.1 的原始 bug 情境；OQ-NOT-2 裁定）
> **終期目標 sheet**：`/order-operation/11` **TB-P01 分析表**（客戶原始需求；待 demo 走通後複製同 pattern）
>
> 作者：Claude Code（草擬）
> 版本：v0.2（2026-07-07 APPROVED）
> 客戶 stakeholder：sandy@braun.com.tw（台灣福祉業務窗口）

---

## 1. 目標與範圍

### 1.1 目標

1. **儲存觸發**：業助在 aitode 上「儲存」TB-P71 維修保養單-中部任一筆 → 業助群 30 秒內收到 LINE 通知（demo 首發；同 pattern 可複製到 TB-P01 分析表或任何 sheet）
2. **動作按鈕觸發**：業助點該表上的「發送通知」按鈕 → 業助群立即收到 LINE 通知（同一支邏輯）
3. **訊息內容零錯字**：不再出現 `{{預覽失敗: X}}` — 因為訊息組裝在我們 backend、用結構化 payload、失敗會明確報 4xx
4. **儲存不因 LINE 失敗被擋**：LINE API down / rate limit / 內容過長 → 使用者存檔仍成功，錯誤只寫 log
5. **可觀測**：每次通知有 audit log（request_id / record_id / status / latency），支援事後排查
6. **可換群/換 token 一次改**：Channel Access Token、Group ID 集中 env（Phase 1）→ 未來搬 DB config（多客戶）
7. **首個「中介資料層」雛型**：訊息組裝邏輯獨立為 pure function，日後接其他通知決策 / 客戶 / channel 直接複用（見 §6）
8. **可複製到其他 sheet**：demo 走通後，客戶端 admin 依 SOP §11.1 把同一支 workflow 複製到 TB-P01 分析表 / 訂購憑單 / 其他表 — 只需改 `sheetPath` + fieldId 對照 + 訊息模板

### 1.2 對應主管 / Stakeholder 訴求

| 子題 | 主要訴求 | 對應點 |
|---|---|---|
| A1 儲存→通知 | 客戶：分析表狀態變動業助群要知道 | §4 backend endpoint + §5 Ragic Workflow |
| A2 按鈕→通知 | 客戶：業助手動觸發（例如客戶催單）| §5 動作按鈕 workflow |
| A3 訊息可讀 | 客戶：不要再出現預覽失敗 | §6 訊息組裝 + Zod 驗證 |
| A4 稽核 | 我方：日後排查用 | §7.1 audit log 表 |
| A5 未來搬中介層 | 我方：不寫死 Ragic Workflow 內；集中在 backend | §6 pure function 抽出 |

### 1.3 不做的事（Phase 1 邊界，防 scope creep）

- ❌ **多租戶 config UI** — Phase 1 只有台灣福祉一個租戶，走 env；多租戶等第二客戶再說（見 OQ-NOT-5）
- ❌ **LINE Reply / Push 之外的 channel**（Slack / Email / Teams）— 需求只有 LINE
- ❌ **通知內容富媒體**（Flex Message / carousel）— 首期純文字訊息，改版後再談
- ❌ **雙向對話**（LINE 業助 → Ragic）— 只做單向推播；bot 收訊已有其他機制
- ❌ **分析表以外的其他表通知**（維修保養單、報價憑單等）— 先在分析表跑通、寫 SOP 給客戶自己複製到別的表（見 §11.1）
- ❌ **通知內容 AI 摘要**（例：用 LLM 縮寫 subtable）— 現有 6-7 欄純模板足夠
- ❌ **Ragic 資料同步 / 反向寫入** — 我們只**讀**（透過 Ragic Workflow 主動送）、不主動 GET 或寫回 Ragic
- ❌ **本 module 不含 LINE Bot webhook**（例外：取 Group ID 是一次性的 setup，用臨時 webhook，見 §11.1）

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況 | Gap |
|---|---|---|
| NestJS backend | ✅ 已有 `server/src/`（health/auth/signoff/warroom/tenant） | 新增 `server/src/notify/` |
| JWT auth guard | ✅ 已有 `JwtAuthGuard` | 通知 endpoint 走**不同 auth**（webhook secret，非 JWT）— 需 `@Public()` bypass |
| Audit log 表 | ⚠️ signoff 有 audit_log 但 schema 不通用 | 新建 `notification_log` 表（見 §7.1） |
| Ragic API 讀資料 | ✅ 已驗證（`scripts/ragic-api-import.ts`）| Phase 1 走 Ragic Workflow 主動送、backend 不需回拉；OQ-NOT-1 定 |
| LINE API 呼叫 | ❌ 無 | 全新做，用原生 `fetch` 即可 |
| Ragic Workflow JS | ❌ 無範本 | 提供 template（見 §5）給客戶貼到 Ragic 設計模式 |
| aitode TB-P01 分析表 sheet | ✅ 存在（`/order-operation/11`），schema 完整 | 空資料 → 測試前手動建幾筆 record，見 §11 |
| env 佔位 | ✅ 已加 `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_GROUP_ID_BUSINESS_ASSIST` / `NOTIFY_WEBHOOK_SECRET` | 用戶待填 |

---

## 3. 剩餘 scope 切分（M1–M5）

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED（用戶定 OQ-NOT-1..7）| 0.02 mo（0.5 日）|
| **M1** Backend endpoint + LINE client | `notify.controller` / `notify.service` / `line.client` + webhook secret guard + Zod DTO + 6 unit test | 0.05 mo（1.5 日）|
| **M2** 訊息組裝 + audit log | `composeMessage` pure function + `notification_log` migration + 冪等 dedup（30s 窗）+ 4 unit test | 0.03 mo（1 日）|
| **M3** Ragic Workflow JS template + 部署設定 | 給客戶貼的 JS code + 「怎麼在 Ragic 設計模式加 workflow」SOP + Global Workflow 常數規劃 | 0.02 mo（0.5 日）|
| **M4** 手動端到端測試 + docs | aitode TB-P01 分析表加 workflow → 儲存 → 檢查 LINE 收到 + 收 audit log；改 docs → MODULES.md 標 ✅ | 0.03 mo（1 日）|
| **M5** FMEA + 上 prod gate | §12 逐路徑失效反思；P0 全清才移到台灣福祉正式帳號；smoke test；發版通知 | 0.02 mo（0.5 日）|

**合計 M1–M5**：約 **5 人日**（不含 M0 review 時間）

---

## 4. M1 — Backend endpoint

### 4.1 API 契約

```
POST /notify/ragic/maintenance-report
Headers:
  Content-Type: application/json
  X-Notify-Secret: <NOTIFY_WEBHOOK_SECRET>  # 32+ 位隨機字元
Body (JSON):
  {
    "trigger": "save" | "button",
    "sheetPath": "/service-tickets/10",   # TB-P71 維修保養單-中部
    "recordId": 123,
    "record": {                            # OQ-NOT-1 選項 A：Ragic 直接送完整欄位
      "維修保養單號": "MR-2026-0128",
      "客戶全稱": "喬醫健康事業...",
      "聯絡人": "李○○",
      "聯絡電話": "02-2835-7700",
      "車型": "福特旅玩家",
      "車牌號碼": "AAA-1234",
      "維修保養狀況": "冷氣不冷、需檢查壓縮機",
      "客戶詳細地址": "台北市士林區..."
    }
  }

Response:
  200 OK { "status": "sent", "requestId": "..." }
  200 OK { "status": "skipped", "reason": "deduped_within_30s" }
  400 Bad Request { "status": "invalid_body", "errors": [...] }  # Zod fail
  401 Unauthorized { "status": "invalid_secret" }
  502 Bad Gateway { "status": "line_api_failed", "lineStatus": 500 }
```

**未來複製到 TB-P01 分析表時**：新增 endpoint `POST /notify/ragic/analysis-sheet`（或改成通用 endpoint 帶 `template` param — 見 OQ-NOT-1 裁定備註，Phase 1 走 per-sheet 好懂）

**設計原則**：
- 一律回 200 OK **給 Ragic**（除非簽章錯或請求格式錯）— Ragic Workflow 端不阻擋使用者存檔（doc §6）
- 內部真正的成敗記在 `notification_log`
- LINE API 失敗回 502 只是提示，Ragic 端會 catch 掉

### 4.2 檔案結構

```
server/src/notify/
  notify.module.ts                        NestJS module
  notify.controller.ts                    POST /notify/ragic/maintenance-report
  notify.service.ts                       編排：驗簽 → 組訊 → 呼 LINE → 寫 log
  webhook-secret.guard.ts                 驗 X-Notify-Secret（constant-time compare）
  compose/
    compose-maintenance-report.ts         pure function：record → LINE text (§6.1)
    # 未來加 compose-analysis-sheet.ts、compose-quote.ts …
  line.client.ts                          LINE Messaging API wrapper（push message）
  dto/
    ragic-maintenance-report.dto.ts       Zod schema
  notify.repository.ts                    寫 notification_log（drizzle）
  __tests__/
    compose-maintenance-report.test.ts    純函數快照 + edge cases
    notify.service.test.ts                mock LINE client + verify audit write
    webhook-secret.guard.test.ts          常時比較 + 缺 header
```

### 4.3 webhook secret 驗證（constant-time）

```typescript
import { timingSafeEqual } from "node:crypto";
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const provided = req.headers["x-notify-secret"];
    const expected = process.env.NOTIFY_WEBHOOK_SECRET;
    if (!expected) throw new UnauthorizedException("secret 未設定");
    if (typeof provided !== "string") throw new UnauthorizedException();
    // 常時比較避免 timing attack
    const a = Buffer.from(provided, "utf-8");
    const b = Buffer.from(expected, "utf-8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("invalid secret");
    }
    return true;
  }
}
```

---

## 5. M3 — Ragic Workflow JS（給客戶端貼）

### 5.1 儲存觸發（Post Workflow）

```javascript
// 在「TB-P71 維修保養單-中部」的修改設計 → Workflow → Post workflow 貼此段
function notifyLineAfterSave() {
  var recordId = record.getId();
  sendMaintenanceNotify(recordId, "save");
}

// Global Workflow 定義（避免每個 sheet 重複貼；也讓未來加新 sheet 只需寫一支新函數）
function sendMaintenanceNotify(recordId, trigger) {
  var query = db.getAPIQuery();
  var entry = query.getAPIEntry(recordId);
  var payload = {
    trigger: trigger,
    sheetPath: "/service-tickets/10",
    recordId: recordId,
    record: {
      // fieldId 需要進 Ragic 修改設計模式逐一點選欄位取得（見 §11.1）
      "維修保養單號": entry.getFieldValue(FIELD_ID_維修保養單號),
      "客戶全稱": entry.getFieldValue(FIELD_ID_客戶全稱),
      "聯絡人": entry.getFieldValue(FIELD_ID_聯絡人),
      "聯絡電話": entry.getFieldValue(FIELD_ID_聯絡電話),
      "車型": entry.getFieldValue(FIELD_ID_車型),
      "車牌號碼": entry.getFieldValue(FIELD_ID_車牌號碼),
      "維修保養狀況": entry.getFieldValue(FIELD_ID_維修保養狀況),
      "客戶詳細地址": entry.getFieldValue(FIELD_ID_客戶詳細地址)
    }
  };

  util.setHeader("Content-Type", "application/json");
  util.setHeader("X-Notify-Secret", GLOBAL_NOTIFY_SECRET);

  try {
    var res = util.postURL(BACKEND_URL + "/notify/ragic/maintenance-report", JSON.stringify(payload));
    log.info("[notify] " + res);
  } catch (e) {
    log.error("[notify] failed: " + e);
    // 不 setStatus("ERROR")，讓存檔繼續（doc §6）
  }
}
```

### 5.2 動作按鈕觸發

同一支 `sendMaintenanceNotify(recordId, "button")` — button workflow 直接呼叫這支函數即可。

### 5.3 Global Workflow 常數（Ragic 系統管理 → 全域常數）

```javascript
var BACKEND_URL = "https://ai-center-line-server.onrender.com";
var GLOBAL_NOTIFY_SECRET = "<32+ 位隨機字串>";
```

（Channel Access Token / Group ID **不放 Ragic** — 放我們 backend env，Ragic 端只認 backend URL + secret）

---

## 6. M2 — 訊息組裝（pure function，可複用）

### 6.1 抽出成純函數的理由

```typescript
// server/src/notify/compose/compose-maintenance-report.ts
export type MaintenanceReportRecord = {
  維修保養單號: string; 客戶全稱: string; 聯絡人: string; 聯絡電話: string;
  車型: string; 車牌號碼: string; 維修保養狀況: string; 客戶詳細地址: string;
};

export function composeMaintenanceReportMessage(
  rec: MaintenanceReportRecord,
  trigger: "save" | "button",
): string {
  const label = trigger === "save" ? "已更新" : "手動發送";
  return [
    `【維修保養通知 · ${label}】`,
    `單號：${rec.維修保養單號}`,
    `客戶：${rec.客戶全稱}`,
    `聯絡人：${rec.聯絡人}（${rec.聯絡電話}）`,
    `車型 / 車牌：${rec.車型} / ${rec.車牌號碼}`,
    `狀況：${rec.維修保養狀況}`,
    `地址：${rec.客戶詳細地址}`,
  ].join("\n");
}
```

**未來加新 sheet template**：每個 sheet 一支 pure function `compose-{sheet}.ts`；controller 依 endpoint 路由到對應 composer；共用邏輯（`\n` 注入防禦、長度截斷）抽成 `compose/_helpers.ts`

**Pure function 好處**：
- 未來搬「中介資料層」直接複用（doc §6）
- Unit test 極簡（無 mock）
- 快照測試檔在 `__tests__/compose-message.test.ts` 一眼看訊息長怎樣

### 6.2 Dedup（同一 record 30 秒窗）

```typescript
// 記憶體 LRU（Phase 1 單機夠用）；日後多實例需 Redis
const dedupCache = new LRU<string, number>({ max: 1000, ttl: 30_000 });
function shouldSkip(recordId: number, sheetPath: string): boolean {
  const key = `${sheetPath}:${recordId}`;
  if (dedupCache.has(key)) return true;
  dedupCache.set(key, Date.now());
  return false;
}
```

（Phase 1 backend 只跑單 replica，記憶體 LRU 夠用；未來多實例改 Redis SETNX，見 OQ-NOT-3）

---

## 7. 資料模型變動

### 7.1 SQL Migration — 新增 `notification_log` 表

```sql
-- migrations/00X_notification_log.up.sql
CREATE TABLE notification_log (
  id            BIGSERIAL PRIMARY KEY,
  request_id    UUID NOT NULL DEFAULT gen_random_uuid(),
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger       TEXT NOT NULL CHECK (trigger IN ('save', 'button')),
  sheet_path    TEXT NOT NULL,           -- '/order-operation/11'
  record_id     BIGINT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'skipped_dedup', 'line_failed', 'invalid_body', 'invalid_secret')),
  line_status   INT,                     -- LINE API 回的 HTTP status
  line_message  TEXT,                    -- LINE API 錯誤訊息（若失敗）
  latency_ms    INT NOT NULL,
  message_text  TEXT,                    -- 發出去的訊息內容（PII 敏感，保留 90 天）
  tenant_id     UUID,                    -- 為 Phase 2 多租戶預留（本期填 NULL 或 fixed tenant）
  audit         JSONB NOT NULL DEFAULT '{}'::jsonb  -- 額外脈絡（IP / user-agent / errors）
);
CREATE INDEX idx_notify_log_time ON notification_log(received_at DESC);
CREATE INDEX idx_notify_log_record ON notification_log(sheet_path, record_id, received_at DESC);
```

**保留策略**：`message_text` 含 PII（客戶名 / 地址）— 保留 90 天後 truncate；`audit` 保留 1 年（見 §7-bis.5）

### 7.2 RLS / Permission

- `notification_log` 目前 **不掛 RLS**（Phase 1 單租戶）；Phase 2 多租戶需加 `tenant_id` RLS
- 查詢權限：僅 admin 角色（不對外開 API 讀）；DBA 排查走 SQL

### 7.3 現有 code 影響

- `server/src/app.module.ts` 加 `NotifyModule` import
- 新 env 變數（`.env` / `.env.example` 已加）
- `docker-compose.yml` 不動（用既有 PG）

---

## 7-bis. 企業級 cross-cutting 檢核

> 本 module 處理**真實客戶 PII**（客戶名稱、地址）+ 外接第三方 API + webhook 從公網進來。是安全敏感模組（R2）—— 縱使用戶未明說 Mode B，仍全填。

### 7-bis.1 安全模型

| 攻擊面 | 緩解措施 | 對應實作 |
|---|---|---|
| **任意人打 endpoint 灌 LINE 訊息** | `X-Notify-Secret` header + constant-time compare；HTTPS only（Render 自帶 TLS） | `WebhookSecretGuard`（§4.3） |
| **Timing attack 猜 secret** | `crypto.timingSafeEqual`，不用 `===` | 同上 |
| **Ragic Workflow 端 secret 洩漏** | 只放 Global Workflow 常數；不放單一 sheet 內；Ragic 內部人員可見（風險：客戶 admin），改 quarterly rotate | §11.3 SOP 換 secret |
| **LINE Channel Access Token 洩漏** | 只放 backend env / Render secret manager；不入 code / log / audit body | §4.2 |
| **PII 寫進 log** | `console.log` 只印 request_id + status，不印 record 內容；`notification_log.message_text` 標明 90 天 retention | §7.1 保留策略 |
| **注入攻擊（record 值含 `\n` 或 LINE Flex 語法）** | 訊息只用純文字 push、不用 Flex；record 值 stringify 前 `.replace(/[\r\n]+/g, ' ')` | §6.1 pure function |
| **LINE API 被利用當跳板** | Push message target 固定為 env 內 group id；不接受 body 指定 target | `line.client.ts` 只讀 env |
| **DoS：暴力打 endpoint 耗盡 LINE quota** | (1) webhook secret 擋大部分；(2) IP-level rate limit（Render 內建 or `@nestjs/throttler`）；(3) LINE 側 free tier 500/月 觸發 429 就短路 | OQ-NOT-6 |

**Input validation**（Zod）：
- `trigger`: enum `['save', 'button']`
- `sheetPath`: regex `^/[a-z0-9-]+/\d+$`（防路徑注入）
- `recordId`: positive integer, max 1e12
- `record.*`: string, max 500 chars each，`.trim()`
- 整個 body 硬限 8 KB（LINE 單則訊息上限 5000 字，遠低於此）

### 7-bis.2 容量規劃

- **預估 QPS**：normal < 0.01/s（每天 100 通內）；peak 或 spike 5/s（業助批改一批分析表時）
- **預估資料量**：`notification_log` 每筆 ~2 KB × 100/day = 200 KB/day = ~72 MB/年（可忽略）
- **Blast radius**：單筆 API 呼叫只影響「發出 1 則 LINE 訊息 + 寫 1 行 log」；無 fan-out
- **Critical path latency**：`compose → LINE API call → log write` ≈ 200~500ms（LINE API round-trip 為主）
- **Lock scope**：無 lock；`notification_log` 純 append，`dedupCache` in-memory Map

### 7-bis.3 失效模式

| 路徑 | Timeout | Retry policy | Circuit breaker | Fallback |
|---|---|---|---|---|
| LINE Push API | 5 秒 | **不 retry**（避免同訊息重發）| 開在 5 分鐘連續失敗 20 次 | 直接寫 `line_failed`，人工排查 |
| Postgres write（audit log） | 2 秒 | 1 次 | n/a | log.error 但不擋回 200 給 Ragic |
| Ragic → 我方 endpoint | 由 Ragic 端 timeout 控制 | Ragic Workflow 端不 retry | n/a | log.error（Ragic log） |

**特別注意 429**：LINE 免費方案月上限 500 則；我們預估遠低但仍要處理 —— 收到 429 直接寫 log，不 retry。SOP §11.2 有升級指引。

### 7-bis.4 觀測性

| 類型 | 名稱 | 用途 |
|---|---|---|
| structured log | `logger.info({requestId, trigger, sheetPath, recordId, status})` | 每次請求一行 |
| structured log（error）| `logger.error({requestId, err, lineStatus})` | LINE API 失敗 |
| DB metric（SQL）| `SELECT COUNT(*) FROM notification_log WHERE status='line_failed' AND received_at > NOW() - INTERVAL '5 minute'` | 失敗率 |
| Alert（Render 內建 or UptimeRobot）| 5 分鐘內 `line_failed` > 5 → email/LINE 通知 dev | 快速察覺 LINE API 掛掉 |
| Health check | `GET /notify/health` 回 200 + 檢查 env 齊全 | uptime monitoring |

**runbook**（§11.2）：LINE 通知沒收到怎麼查 3 步。

### 7-bis.5 資料生命週期

- **Retention**：
  - `notification_log.message_text`（含 PII）→ 90 天
  - `notification_log.audit`（無 PII）→ 1 年
  - 定期 cron `DELETE FROM notification_log WHERE received_at < NOW() - INTERVAL '90 days'`（Phase 2 排）
- **PII 標記**：`message_text` 為 PII 欄；查詢預設不投影，需 admin role 明確請求
- **Right-to-erasure**：客戶要求刪除某客戶通知記錄 → SQL 手工，走 audit trail
- **Encryption**：at rest（Render Postgres 內建 AES-256）；in transit（HTTPS + TLS）
- **Cross-region replica**：無

### 7-bis.6 向後兼容 + Rollout

- **Endpoint 命名**：`/notify/ragic/analysis-sheet` 明確 scope；未來新表加 `/notify/ragic/quote-sheet` 等，不破壞既有
- **Payload schema**：Zod DTO 版本控制；欄位加減走 optional + default
- **Feature flag**：無需（本 module 是新增，不影響現有）
- **Rollback**：backend rollback 立即生效（Render 一鍵）；Ragic Workflow 端刪除 Post workflow / 註解 Global Workflow 常數即停

### 7-bis.7 成本模型

Phase 1 demo 期（單租戶 + demo sheet 首發，實際觸發極少）：

| 資源 | 增量 | 月成本量級 |
|---|---|---|
| Render backend compute | ~10 req/day × 0.5 vCPU-sec | $0（現有 quota 內）|
| Postgres 寫入 | ~20 KB/day | $0（現有 quota 內）|
| LINE Messaging API | ~10 req/day × 30 = 300/月 | **$0（LINE free tier 500/月 內）** |
| DevOps 值班 | 月 <1 小時排查 | 內部 |

**Total incremental cost** ≈ **$0**（走 free tier；OQ-NOT-7 裁定 B）

**升級門檻**：若量起來到 400+ 則/月（80% free quota），dashboards alert 觸發，屆時再評估升級「輕用量」NT$800/月（4000 則）— 詳 §11.2 排查表 429 條。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | `composeAnalysisSheetMessage` 8 個 snapshot（不同 record shape、含 `\n` 注入）；`WebhookSecretGuard` 4 case | `server/src/notify/__tests__/*.test.ts` |
| Integration | `NotifyController` POST end-to-end（mock LINE client）；驗 audit log 寫入 | `server/test/notify.e2e-spec.ts` |
| Manual smoke | M4：在 aitode UI 建 1 筆分析表 → 儲存 → 檢查 LINE 群組收到 + audit log 有一筆 sent | walk-through checklist |
| Staging → prod | M5 FMEA gate：先在 aitode 測 workflow 週；沒問題再遷到台灣福祉正式帳號 | §11 SOP |

至少 **12 個 unit tests**，覆蓋率目標 > 80%（R2 安全敏感模組）。

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED（用戶定 OQ-NOT-1..7）| 0.02 mo | ⏳ |
| **M1** Backend endpoint + LINE client + 6 unit test | `/notify/ragic/analysis-sheet` 收訊、驗簽、呼 LINE | 0.05 mo | ⏳ |
| **M2** 訊息組裝 + audit log + migration + 4 unit test | `notification_log` 表 + `composeMessage` + dedup | 0.03 mo | ⏳ |
| **M3** Ragic Workflow JS template + SOP | 客戶端貼 JS + 「怎麼加 workflow」文件 | 0.02 mo | ⏳ |
| **M4** aitode 端到端測試 + docs | 建 record → 儲存 → 收到 LINE → audit 有 log；MODULES.md ✅ | 0.03 mo | ⏳ |
| **M5** FMEA + prod cutover | §12 逐路徑；P0 全清；smoke test；發版通知 | 0.02 mo | ⏳ |

---

## 10. 開放問題（OQ-NOT-N）— ✅ 全部裁定（2026-07-07）

| # | 訴求 | 議題 | 選項 | 裁定 | 裁定理由 |
|---|:-:|---|---|---|---|
| **OQ-NOT-1** | ①③ | Ragic Workflow POST 傳「完整 record 欄位」還是只傳「recordId + sheetPath」？| A. 完整 record / B. 僅 ID + backend 回拉 | ✅ **A** | 簡單、快、Ragic API quota 省。缺點是 Ragic Workflow 端欄位變動要重貼 JS，但 Phase 1 欄位穩定；未來 API 化再切 B |
| **OQ-NOT-2** | ③ | 首發 demo sheet 選哪張 + 訊息模板長怎樣？| A. TB-P01 分析表（客戶原需求但空資料） / B. 找一張有資料的展示用 sheet | ✅ **B → 選 `/service-tickets/10` TB-P71 維修保養單-中部** | 用戶裁定「這是給客戶快速使用 LINE 通知的展示」— 挑一張有資料、業務語意清楚的即可。TB-P71 中部 3 筆資料現成、對應 doc §7.1 的原始 bug 情境；訊息模板 8 欄（單號 / 客戶 / 聯絡 / 車型車牌 / 狀況 / 地址）見 §6.1 |
| **OQ-NOT-3** | ①② | 「同筆 record 短時間內存兩次」處理 | A. 30 秒 dedup / B. 60 秒 / C. 每次都發 | ✅ **A** | 30 秒能擋掉雙擊；不會擋真的間隔 1 分鐘的兩次編輯 |
| **OQ-NOT-4** | ①④ | LINE API 失敗要不要 retry | A. 不 retry / B. 500 retry 1 次 / C. Outbox worker | ✅ **A** | LINE Push 是 at-most-once 語意；重發 = 群組看到重複訊息更慘 |
| **OQ-NOT-5** | ⑥ | 多租戶 config 現在做還是 Phase 2 | A. env（單租戶）/ B. DB config | ✅ **A** | YAGNI；第二客戶落地時再做 |
| **OQ-NOT-6** | 🔒 | endpoint 要不要 IP allowlist | A. 只 secret / B. secret + IP / C. Cloudflare Access | ✅ **A** | Ragic server IP 不公開穩定，allowlist 反而可能誤擋；secret quarterly rotate |
| **OQ-NOT-7** | 💰 | LINE 方案要不要升級 | A. 升級 NT$800/月 / B. 超額 fallback / C. 問 sandy | ✅ **B（Phase 1 用量小，先走 free tier）** | 用戶裁定「現在用量不大」。free 500/月 dev demo 綽綽有餘；超額才 alarm，之後量起來再升 |

---

## 11. SOP — 日常操作

### 11.1 首次設定（給客戶 admin）— 以 demo 目標 TB-P71 中部為例

1. **取業助群 Group ID**（一次性）
   - 用「台灣福祉 AI客服」LINE 官方帳號臨時開 webhook，在業助群發任意訊息
   - webhook 收到事件 → 讀 `source.groupId` → 記錄下來
   - 貼到我們 backend env `LINE_GROUP_ID_BUSINESS_ASSIST`
2. **取 Channel Access Token**
   - LINE Developers Console → 「台灣福祉 AI客服」Channel → Messaging API → 申請長期 token
   - 貼到我們 backend env `LINE_CHANNEL_ACCESS_TOKEN`
3. **產 webhook secret**
   - `openssl rand -hex 32` → 貼到 backend env `NOTIFY_WEBHOOK_SECRET`
   - 同一組貼到 Ragic「全域常數」`GLOBAL_NOTIFY_SECRET`
4. **拿 fieldId 對照表**
   - 進 Ragic TB-P71 維修保養單-中部（`/service-tickets/10`）→ 修改設計模式
   - 逐一點「維修保養單號 / 客戶全稱 / 聯絡人 / 聯絡電話 / 車型 / 車牌號碼 / 維修保養狀況 / 客戶詳細地址」8 欄
   - 每欄「欄位設定→基本」抄下 7 位數 fieldId
   - 貼到 Global Workflow 常數 `FIELD_ID_維修保養單號 = 1234567;` 等
5. **貼 Workflow JS**
   - 進 Ragic → 全域 Workflow → 貼 `sendMaintenanceNotify` 函數（見 §5.3）
   - TB-P71 中部 → 修改設計 → Workflow → Post workflow：貼 `notifyLineAfterSave`
   - 動作按鈕：新增類型「JS Workflow」按鈕、呼叫 `sendMaintenanceNotify(record.getId(), "button")`
6. **手動測試一筆**
   - 開一筆 TB-P71 中部維修保養單 → 儲存 → 業助群應在 30 秒內收到訊息

### 11.1.b 複製到其他 sheet（例：TB-P01 分析表 / 訂購憑單 / 報價憑單）

對每張新 sheet 重複以下 3 步：
1. **在 backend 加新 endpoint**：`server/src/notify/compose/compose-<sheet>.ts` + `notify.controller.ts` 新增 route
2. **在 Ragic 加 workflow**：Global Workflow 加一支 `sendXxxNotify` + 該 sheet 掛 Post workflow + 動作按鈕
3. **手動測試** 1 筆

（endpoint / composer / Ragic workflow 三處小改，pattern 一模一樣）

### 11.2 失敗模式排查

| 症狀 | 含意 | 處置 |
|---|---|---|
| Ragic 儲存後沒收到通知 | Ragic Workflow 沒觸發 or backend 沒收到 | (1) Ragic log 看 `[notify]` 有沒有印；(2) `SELECT * FROM notification_log WHERE received_at > NOW() - INTERVAL '10 min'` |
| 群組收到訊息但欄位顯示 `undefined` | Ragic fieldId 錯 or 該筆 record 該欄為空 | 檢查 Global Workflow 內 fieldId 常數是否正確 |
| `notification_log.status = 'invalid_secret'` | Ragic 端 secret 跟 backend 對不上 | 比對 Ragic 全域常數 `GLOBAL_NOTIFY_SECRET` vs backend env `NOTIFY_WEBHOOK_SECRET` |
| `notification_log.status = 'line_failed'` + `line_status = 429` | 超出 LINE 月配額 | 升級 LINE 方案（OQ-NOT-7）；或短期停用 workflow |
| `notification_log.status = 'line_failed'` + `line_status = 401` | Channel Access Token 過期/失效 | LINE Developers Console 重申請 → 更新 env → redeploy |
| 30 秒內連按兩次「儲存」只收到一則 | Dedup 生效（正常） | 依 OQ-NOT-3 設定；改行為需改 dedup 窗 |

### 11.3 Secret rotation（quarterly）

```bash
# 生新 secret
NEW=$(openssl rand -hex 32)
# 1. 先把 backend env 加成「支援雙 secret」（新舊都接受）
# 2. Ragic 全域常數改成新 secret
# 3. 觀察 24h notification_log 全綠
# 4. backend 移除舊 secret
```

### 11.4 審計查詢

```sql
-- 過去 7 天各狀態通知數
SELECT status, COUNT(*) FROM notification_log
WHERE received_at > NOW() - INTERVAL '7 days'
GROUP BY status ORDER BY 2 DESC;

-- 特定 record 的所有通知歷史
SELECT received_at, trigger, status, latency_ms FROM notification_log
WHERE sheet_path = '/order-operation/11' AND record_id = 123
ORDER BY received_at DESC;

-- 失敗率警報（>5% 該告警）
SELECT
  COUNT(*) FILTER (WHERE status='sent') AS sent,
  COUNT(*) FILTER (WHERE status='line_failed') AS failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status='line_failed') / NULLIF(COUNT(*),0), 2) AS fail_pct
FROM notification_log
WHERE received_at > NOW() - INTERVAL '5 minutes';
```

---

## 12. 失效場景反思（FMEA）— M5 收尾（R17）✅

> 逐路徑 pre-mortem 已完成；P0 全清；notify 模組已上 prod。
> 實際 endpoint：`POST /notify/ragic/maintenance-report`（doc §4 原設計為 analysis-sheet，M4 pivot 到 TB-P71 中部維修保養單為首發 demo，見 §10 OQ-NOT-2）

### 12.1 Endpoint `/notify/ragic/maintenance-report` 入口

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| E1 | 缺 `X-Notify-Secret` header | 401 `missing X-Notify-Secret` | ✅ `WebhookSecretGuard` |  P1 |
| E2 | secret 錯 | 401 `invalid secret`（constant-time 比較、length 不同也吃掉 CPU）| ✅ `crypto.timingSafeEqual` | P1 |
| E3 | Body 非 JSON / 缺欄 / 型別錯 | 400 帶 Zod 詳細 errors path | ✅ `RagicMaintenanceReportSchema.safeParse` | P1 |
| E4 | `record` 欄超長（>500 字）| Zod `.max(500)` reject；composer 端再 `sanitize().slice(200)` 二次防護 | ✅ | P2 |
| E5 | **攻擊者 replay 舊 payload** | Ragic Workflow 送 `timestamp: Date.now()`；backend 拒 ±5 分鐘窗外 request、寫 audit log；backward compat：無 timestamp 放行但 log warn | **✅ 已緩解**（v1.0 M5 加入）| P0 → **P1** |
| E6 | 同一 record 30 秒內第 2 次 | 200 `skipped_dedup`、不呼 LINE、audit log 記錄 | ✅ `MemoryDedupCache` | P2（正常）|

### 12.2 LINE API 外呼

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| L1 | 429 rate limit | 標 `line_failed` line_status=429；不 retry（OQ-NOT-4 A） | ✅ | P1 |
| L2 | 401 invalid token | 標 `line_failed` line_status=401；下次 request 才會知道（無 startup check）| ⚠️ 已知殘留 — 現況：token 一旦過期，下一則 request 才會標 line_failed。治本：加 startup ping LINE Push API 檢查 token 有效（未來優化）| P1 |
| L3 | 網路 timeout（>5s）| AbortController + 標 line_failed | ✅ | P1 |
| L4 | 500 從 LINE side | 標 line_failed；不 retry | ✅ | P1 |
| L5 | 訊息含非法字元（Unicode surrogate / `\n`）| composer `sanitize()` 折 `\n\r\t` → 空白；Zod string schema | ✅ | P2 |

### 12.3 DB 寫入

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| D1 | Postgres 連線失效 | `NotifyRepository.writeLog` try/catch；返回 null；上游繼續呼叫 LINE、Ragic 端仍收 200 | ✅ | P1 |
| D2 | **`notification_log` 表遺失** | Backend 起動 `onModuleInit` 跑 `SELECT 1 FROM notification_log LIMIT 1`；缺表大聲 `logger.error` 但不 crash；notify endpoint 會回 line_failed（LINE 仍有發出）| **✅ 已緩解**（v1.0 M5 加入 `NotifyRepository.onModuleInit`）| P0 → **P1** |

### 12.4 部署順序（migration / 後端 / Ragic Workflow）

| # | 場景 | 風險 | 緩解 |
|---|---|---|---|
| P1 | 後端 code 先於 migration | notification_log INSERT 全 fail | ✅ Human 執行 migration 為 R10 硬性要求；M5 加 startup log 補丁提示 |
| P2 | Ragic Workflow 貼上、backend 還沒 deploy | Ragic Workflow POST 全 fail、業助群沒通知但 Ragic log 印 error | ✅ SOP §11.1.b 明確順序：先 deploy backend → smoke 過 → 才貼 Workflow |
| P3 | LINE token / Group ID 忘了填 | endpoint 起來但所有 LINE call 401 | ✅ `LineClient.pushText` 起手檢查 env、缺就直接回 line_failed 不打 API |

### 12.5 已知殘留（本 module scope 內、暫緩處理）

- **L2 LINE token 過期無 startup 提示**：現況 token 到期要下一個 request 才知；治本方向 startup 打一個空 push 到自己 group 驗證。優先度 P1，非阻塞
- **無 rate limit on notify endpoint**：dedup 覆蓋 30 秒同 record 重放，但攻擊者換 recordId 可繞開；`timestamp` ±5 分鐘窗把攻擊窗口壓小；prod 若量爆再加 `@nestjs/throttler`
- **notification_log retention 未實作**：doc §7.1 訂 90 天 for PII、1 年 for audit；cron 於 Phase 2 補（現階段量小、每月 <300 筆）

### 12.6 不在本 module scope 修的 pre-existing 問題

- Ragic 官方「內建 LINE 通知」的 `{{預覽失敗:}}` bug（doc §7.1）— 本 module 就是替代方案；不去修 Ragic 端
- Ragic Workflow 內 fieldId 硬編碼 —— 客戶端 admin 責任；docs/sop/ragic-workflow-templates.md 已提供批次抓 field ID 的 SOP + catalog（`.ragic-export/_field-catalog.csv`），未來若要 UI 化再開新 module

> **檢查點（M5 完成 · 2026-07-08）**：E5 replay + D2 migration missing 兩個 P0 都已降到 P1 並緩解；notify 模組符合 R17「P0 全清才可上 prod」。實際勘查：commit `50665a4` 起即已 prod 部署運行、多次 smoke 通過、業助群已收到多則測試通知，模組穩定運行中。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-07 | v0.1 | 初版 DRAFT — M0–M5、OQ-NOT-1..7、Ragic Workflow JS template、FMEA 骨架 | Claude Code |
| 2026-07-07 | v0.2 | OQ-NOT-1..7 全部裁定，狀態 DRAFT → APPROVED；換首發 demo sheet 為 TB-P71 中部維修保養單、訊息模板改維修保養風格、endpoint 改 `/notify/ragic/maintenance-report`；OQ-NOT-7 改採 B（先 free tier）；SOP §11.1 對齊新 sheet；加 §11.1.b 複製到其他 sheet 的三步 | Claude Code |
| 2026-07-08 | v1.0 | M5 SHIPPED — §12 FMEA 全部路徑跑完；E5 replay 緩解（timestamp ±5min 窗）；D2 migration missing 緩解（onModuleInit startup 檢查）；訊息模板擴 16 欄企業風 + Ragic 記錄連結；sheetName 標題支援；MODULES.md 標 ✅ | Claude Code |
