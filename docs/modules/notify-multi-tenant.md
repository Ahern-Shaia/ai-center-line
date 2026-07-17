# notify-multi-tenant.md — [Phase 1.5] Ragic → LINE 通知多租戶化 + 鮮勇兩張新表

> ✅ **狀態：SHIPPED v1.0（2026-07-17）· M1–M5 全部落地、上 prod、smoke 進行中**
>
> `notify` 模組已 SHIPPED（v1.0，2026-07-08）但只支援單租戶（LINE token / group id 寫死 env）。第二客戶「鮮勇」進來後，此模組須加 **tenant routing** 才能：(1) 依 request 判斷來源 tenant → (2) 選對應的 LINE token/group → (3) push 到正確業助群，同時避免 cross-tenant 訊息串線。此 doc 同時規劃鮮勇兩張新 sheet（報價單、原料驗貨單）的 endpoint / DTO / compose / Ragic Workflow JS。
>
> 作者：Claude Code（草擬）
> 版本：v0.1（2026-07-17）
> 客戶 stakeholder：鮮勇（Ragic 帳號 `freshfruits`）
> 依賴上游：[[notify.md]] v1.0（本 doc 只寫 diff，未改的都沿用）

---

## 1. 目標與範圍

### 1.1 目標

1. **Tenant 路由**：同一 endpoint 收到 request 後，能識別是哪個 tenant（台灣福祉／鮮勇／未來 N 客）→ 選對應的 LINE token / group_id / dedup 命名空間 → push 到該 tenant 的業助群
2. **鮮勇兩張新表通知上線**：報價單（下游-1）+ 原料驗貨單（上游-4a）在鮮勇 Ragic 儲存 / 按鈕觸發 → 鮮勇業助群 30 秒內收到 LINE
3. **既有台灣福祉配置零停機**：舊 env（`LINE_CHANNEL_ACCESS_TOKEN` / `LINE_GROUP_ID_BUSINESS_ASSIST`）作為 default fallback、不 rename，不動客戶端 Ragic Workflow
4. **Cross-tenant 隔離**：tenant A 的 secret 不能觸發 tenant B 的通知；audit log 帶 tenant_id 分流查詢
5. **Onboard 新客戶只需加 env 3 條**：token / group_id / secret，程式碼零改動（sheet 的 DTO / compose 仍是 per-sheet 開發）
6. **可觀測**：`notification_log.tenant_id` 啟用；per-tenant 錯誤率 / QPS / 訊息數可查

### 1.2 對應 Stakeholder 訴求

| 子題 | 主要訴求 | 對應點 |
|---|---|---|
| B1 tenant 識別 | 我方：多客戶不能推錯群 | §4 tenant resolver + secret-as-identifier |
| B2 鮮勇新表 | 客戶：報價單、原料驗貨單也要通知 | §6 兩個新 endpoint + compose |
| B3 平滑遷移 | 我方：既有 prod 台灣福祉不能斷 | §4.3 default fallback + rollback plan |
| B4 隔離審計 | 我方：日後排查 per-tenant 錯誤 | §7 `notification_log.tenant_id` |

### 1.3 不做的事

- ❌ **不做 tenant 管理 UI**：新增 tenant 走 env 改 + code review + deploy（memory `feedback_groups_per_tenant_configurable.md` 講的是「群組數/租戶非固定」，不是「後台管理」）
- ❌ **不改 `notification_log` 加 RLS**：Phase 3 多租戶讀取 API 才需要；本期只 append + admin SQL 查
- ❌ **不做 tenant 自助管理**（自助加 sheet / 改 template）：客戶端 admin 找我們手動配
- ❌ **不改既有 `/notify/ragic/maintenance-report` / `analysis-sheet` API 路徑**（backward compat）
- ❌ **不做 LINE Bot 路由**：webhook 只做 Push、不接收 reply
- ❌ **不換 Nest 版本 / DB / infra**：純 code 改動 + env 加變數 + 一支 migration

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況（notify.md v1.0）| Gap |
|---|---|---|
| Endpoint pattern | ✅ Per-sheet endpoint 已定（[[notify.md §4]]） | 加 2 個新 endpoint（`quotation` / `material-inspection`）|
| `NotifyService.handle<P>` 通用編排 | ✅ dedup / compose / push / audit 已抽 | dedup key、audit log、LINE push 都要加 `tenantId` |
| `LineClient` | ⚠️ 讀單一 env token/group 寫死 | 改 stateless：`pushText(tenantConfig, text)` |
| `WebhookSecretGuard` | ⚠️ 讀單一 `NOTIFY_WEBHOOK_SECRET` | 改 per-tenant secret 反查 → 附 `req.tenant` |
| `notification_log.tenant_id` | ✅ Schema 已預留 UUID 欄位 | 啟用寫入 + 加 index |
| `MemoryDedupCache` | ✅ 30s 窗、`sheet_path:record_id` key | key 加 tenant prefix：`tenant_id:sheet_path:record_id` |
| Ragic Workflow SOP | ✅ `docs/sop/ragic-workflow-templates.md` 有 | 加鮮勇兩個 template；global constant 增 `TENANT_SECRET` |
| env 配置 | ✅ `.env` / `.env.example` 已加鮮勇區塊（2026-07-17 已加）| 命名慣例確認 + secret 也要 per-tenant |
| DB `tenants` 表 | ⚠️ 未查證是否存在 | §7 確認、若無則本期不新建、走 env |

---

## 3. 剩餘 scope 切分（M1–M5）

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED（用戶定 OQ-NMT-1..11）| 0.02 mo（0.5 日）|
| **M1** Tenant registry + resolver + 改 guard | env 讀 per-tenant config；`TenantResolver` service；`WebhookSecretGuard` 改認 per-tenant secret → 附 `req.tenant`；8 unit test | 0.04 mo（1 日）|
| **M2** LineClient stateless + Service tenant-aware | `LineClient.pushText(cfg, text)`；`NotifyService.handle` 從 `req.tenant` 取 config；`notification_log.tenant_id` 啟用寫入；dedup key 加 tenant prefix；6 unit test + migration | 0.03 mo（0.8 日）|
| **M3** 鮮勇報價單 endpoint（DTO / compose / controller）+ Ragic Workflow JS template | `/notify/ragic/quotation`；14 欄擇要 8 欄；template `xianyong-quotation-*.js`；4 unit test | 0.03 mo（0.8 日）|
| **M4** 鮮勇原料驗貨單 endpoint（同上結構）+ 客戶端 SOP | `/notify/ragic/material-inspection`；template `xianyong-material-inspection-*.js`；4 unit test；SOP §11.1.c 新客戶 onboarding | 0.03 mo（0.8 日）|
| **M5** FMEA + 端到端 smoke + prod cutover | §12 逐路徑（含 cross-tenant 隔離攻擊面）；先在 aitode 測 → 鮮勇 Ragic 貼 workflow → 鮮勇業助群收到；發版通知 | 0.03 mo（0.8 日）|

**合計 M1–M5**：約 **4.2 人日**（不含 M0 review）

---

## 4. M1 — Tenant Registry + Resolver + WebhookSecretGuard 改造

### 4.1 Tenant identifier 決策（見 OQ-NMT-1）

**建議：per-tenant `NOTIFY_WEBHOOK_SECRET`，一箭雙鵰**

Ragic Workflow 本來就要塞 `X-Notify-Secret`，我們用 secret **既認證又識別 tenant**：

```
env:
  NOTIFY_WEBHOOK_SECRET             (台灣福祉；沿用既有值，作為 default)
  NOTIFY_WEBHOOK_SECRET_XIANYONG    (鮮勇；新產一組 32-hex)

backend 收到 request:
  1. WebhookSecretGuard 掃過所有 NOTIFY_WEBHOOK_SECRET* env → 比對 X-Notify-Secret
  2. 命中 → req.tenant = <slug>  (e.g. "twh" | "xianyong")
  3. 未命中 → 401
```

**好處**：
- Ragic Workflow 端零改動（照樣塞 secret）
- Tenant A 的 secret 洩漏 = 只能觸發 tenant A 的通知（隔離）
- Secret rotation 是 per-tenant（不強制全客戶同步）

**替代方案為何不選**：
- ❌ X-Tenant header：多維護一個東西、易漏／被偽造（除非配 secret 驗證，那 secret 就足夠了）
- ❌ URL prefix (`/notify/ragic/xianyong/quotation`)：URL 醜、既有台灣福祉要 rename endpoint = breaking
- ❌ sheetPath prefix：payload schema 變 = breaking

### 4.2 Tenant Registry（env-based）

```typescript
// server/src/notify/tenant.registry.ts
export interface TenantConfig {
  slug: string;                 // 'twh' | 'xianyong'
  displayName: string;          // '台灣福祉' | '鮮勇'
  webhookSecret: string;
  lineChannelToken: string;     // 允許共用（fallback 到 default）
  lineGroupIdBusinessAssist: string;
  ragic: {
    baseUrl: string;
    account: string;
    apiKey?: string;            // 可選（backend 不主動回拉時 undefined）
  };
  allowedSheetPaths: string[];  // 縱深防禦（OQ-NMT-3）
}

// 從 env 建 registry：掃 NOTIFY_WEBHOOK_SECRET* → 為每個 tenant 組 config
// default tenant（無後綴）= 台灣福祉；不 rename 舊 env
export function buildTenantRegistry(env: Record<string, string | undefined>): TenantConfig[]
```

**default fallback（OQ-NMT-4 B）**：
- 舊 `NOTIFY_WEBHOOK_SECRET` → default tenant = 'twh'
- 舊 `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_GROUP_ID_BUSINESS_ASSIST` → default tenant 的 line 配置
- 部署完新 code 後，台灣福祉行為完全不變（同一組 secret / 同一組 group）

### 4.3 WebhookSecretGuard 改造

```typescript
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  constructor(private readonly tenants: TenantRegistry) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const provided = req.headers['x-notify-secret'];
    if (typeof provided !== 'string') throw new UnauthorizedException();

    // 常時比較 across all tenants；不 early return
    let matched: TenantConfig | null = null;
    for (const t of this.tenants.all()) {
      const a = Buffer.from(provided, 'utf-8');
      const b = Buffer.from(t.webhookSecret, 'utf-8');
      if (a.length === b.length && timingSafeEqual(a, b)) {
        matched = t;  // 不 break，掃完
      }
    }
    if (!matched) throw new UnauthorizedException('invalid secret');
    req.tenant = matched;   // 附掛 tenant config 給後續 handler
    return true;
  }
}
```

**Timing attack 考量**：即使命中也掃完所有 tenant，避免透過回應時間推測 tenant 數量。

### 4.4 Sheet path 白名單驗證（OQ-NMT-3）

`req.tenant.allowedSheetPaths` 列出該 tenant 可接受的 sheet 路徑；`NotifyService.handle` 開頭驗：

```typescript
if (!req.tenant.allowedSheetPaths.includes(payload.sheetPath)) {
  // 401 cross_tenant_sheet_path；audit log
  throw new ForbiddenException('sheetPath not allowed for tenant');
}
```

**縱深防禦**：即便 secret 對，若 payload 帶了不屬於該 tenant 的 sheet path，也擋掉。防的是「config 錯把兩客戶的 secret 混用」或「內部人員誤把測試 secret 用在錯 tenant」。

---

## 5. M2 — LineClient stateless + NotifyService tenant-aware

### 5.1 LineClient 改 stateless

```typescript
// before: pushText(text) 讀 process.env
// after: pushText(cfg: { token: string; groupId: string }, text: string)
export class LineClient {
  async pushText(
    cfg: { token: string; groupId: string },
    text: string
  ): Promise<PushResult> { ... }
}
```

### 5.2 NotifyService.handle 加 tenant

```typescript
private async handle<P extends NotifyCommon>(
  payload: P,
  tenant: TenantConfig,             // ← new
  composer: (rec, trigger) => string,
): Promise<HandleResult> {
  // 1) 白名單驗（§4.4）
  if (!tenant.allowedSheetPaths.includes(payload.sheetPath)) { ... }

  // 2) Dedup key 加 tenant prefix（跨 tenant 不會誤 dedup）
  const key = `${tenant.slug}:${payload.sheetPath}:${payload.recordId}`;
  if (this.dedup.shouldSkip(key)) { ... }

  // 3) Compose、Push、Log 都帶 tenant
  const text = composer(payload.record, payload.trigger);
  const lineResult = await this.lineClient.pushText(
    { token: tenant.lineChannelToken, groupId: tenant.lineGroupIdBusinessAssist },
    text,
  );
  await this.repo.writeLog({
    tenantId: tenant.slug,          // ← 啟用
    trigger, sheetPath, recordId,
    status: ...,
  });
}
```

### 5.3 `notification_log.tenant_id` 啟用

已存在的 UUID 欄位改型別為 `text NOT NULL`（存 slug 而非 UUID）— 見 OQ-NMT-5、§7.1。

---

## 6. M3 + M4 — 鮮勇兩張新表

### 6.1 報價單（下游-1）→ `POST /notify/ragic/quotation`

**用戶提供 14 欄，訊息模板僅選 8 欄**（OQ-NMT-8 待定；以下為建議）：

| 選入訊息 | 欄位名稱 | fieldId | 建議理由 |
|---|---|---|---|
| ✅ | 報價單號 | 1016153 | 主鍵、必列 |
| ✅ | 單據狀態 | 1026328 | 主要 signal（草稿／簽核中／已核可）|
| ✅ | Approval status | 1026332 | 補充狀態 |
| ✅ | 客戶名稱 | 1016085 | 業務語意 |
| ✅ | 報價單日期 | 1026478 | 時間軸 |
| ✅ | 報價有效日期 | 1016086 | 追蹤過期 |
| ✅ | 承辦人員 | 1016089 | 責任人 |
| ✅ | 簽核人 | 1026476 | 責任人 |
| ❌ | 日期狀態 | 1026329 | 冗餘（跟有效日期重複）|
| ❌ | 下載 | 1026488 | LINE 訊息無意義 |
| ❌ | 簽核開始／結束時間 | 1026472/3 | 太細；DTO 收但 compose 不輸出 |
| ❌ | 送出簽核人／姓名 | 1026474/5 | 太細 |

（DTO 全 14 欄 optional 都收，compose 只選 8 欄；日後想加不用改 DTO）

**觸發**（OQ-NMT-9 待定；建議 save + 動作按鈕）：兩者皆做

### 6.2 原料驗貨單（上游-4a）→ `POST /notify/ragic/material-inspection`

8 欄全上：

| 選入訊息 | 欄位名稱 | fieldId |
|---|---|---|
| ✅ | 品項名稱 | 1018491 |
| ✅ | 品編 | 1018574 |
| ✅ | 批號 | 1018604 |
| ✅ | 收貨數量 | 1018494 |
| ✅ | 數量 | 1018572 |
| ✅ | 單位 | 1018495 |
| ✅ | 製造 / 有效日期 | 1018597 |
| ✅ | 檢驗完成？ | 1023030 |

**觸發**（OQ-NMT-9 待定；建議「檢驗完成勾起」時發，非每次儲存都發）：需要 Ragic Workflow 端做「前值 vs 新值」比對才 push。若做 always-save，會太吵。

### 6.3 訊息模板範例（企業風、參考 [[notify.md §6.1]]）

```
【鮮勇 報價單｜已更新】
報價單號：QT-2026-0001
狀態：已核可（Approval: Approved）
客戶：XX 有限公司
報價日期：2026/07/17
有效日期：2026/08/17
承辦：王〇〇
簽核：張〇〇

檢視完整資料：
https://ap16.ragic.com/freshfruits/下游-1/6/123
```

```
【鮮勇 原料驗貨單｜檢驗完成】
品項：紅蘿蔔（M-0128）
批號：LOT-20260717-A
收貨數量：500 kg
實收數量：498 kg
製造/有效日期：2026/07/15 / 2027/01/15
檢驗結果：合格

檢視完整資料：
https://ap16.ragic.com/freshfruits/上游-4a/4/456
```

（實際欄位／格式以 OQ-NMT-8 裁定為準）

### 6.4 Ragic Workflow JS Template

沿用 [[notify.md §5]] pattern；新增鮮勇 Global Workflow 常數：

```javascript
var BACKEND_URL = "https://ai-center-line-server.onrender.com";
var TENANT_SECRET = "<鮮勇專用 32-hex>";  // 對應 backend NOTIFY_WEBHOOK_SECRET_XIANYONG
// per-sheet fieldId 常數（Global Workflow）...
```

實檔放 `docs/sop/ragic-workflow-templates/xianyong-quotation-post.js` 等；貼 Ragic 時走既有 [[pitfall_ragic_workflow_gotchas]] SOP（單行 / 無 `//` 註解 / Rhino ES5 尾逗號）。

---

## 7. 資料模型變動

### 7.1 SQL Migration — 啟用 `notification_log.tenant_id`

```sql
-- migrations/00X_notify_multi_tenant.up.sql

-- 型別從 UUID 改 text（存 slug 更直覺）；本期沒有 tenants 主表
-- 若 notification_log 已有 tenant_id UUID column，改型別；否則新增
ALTER TABLE notification_log
  ALTER COLUMN tenant_id TYPE text USING tenant_id::text,
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT 'twh';   -- 舊 row backfill default tenant

UPDATE notification_log SET tenant_id = 'twh' WHERE tenant_id IS NULL OR tenant_id = '';

-- 查詢優化：per-tenant 錯誤率 / 訊息數
CREATE INDEX IF NOT EXISTS idx_notify_log_tenant_time
  ON notification_log(tenant_id, received_at DESC);
```

**Down migration**：ALTER 回 UUID + 清 default（若真要 rollback、記得先確認資料回填 UUID 值）。

### 7.2 RLS / Permission

- 本期不加 RLS（Phase 3 開放 read API 時再加）
- 查詢：admin SQL 直連；`SELECT ... WHERE tenant_id = 'xianyong'` 明確帶條件

### 7.3 env 變數（追加清單）

已在 2026-07-17 加：`LINE_CHANNEL_ACCESS_TOKEN_XIANYONG` / `LINE_GROUP_ID_BUSINESS_ASSIST_XIANYONG` / `RAGIC_XIANYONG_*`

**M1 還要加**（等 OQ-NMT-1 定案後）：

```
NOTIFY_WEBHOOK_SECRET_XIANYONG=<32-hex>
NOTIFY_TENANT_SHEETS_XIANYONG=/quotation/6,/material-inspection/4   # 白名單
NOTIFY_TENANT_SHEETS_TWH=/service-tickets/10,/order-operation/11    # 補既有；沒設就允許所有
```

---

## 7-bis. 企業級 cross-cutting 檢核

> Multi-tenant 是**安全關鍵改動**——tenant A 訊息推去 tenant B 群 = 客戶 PII 洩漏 = 業務炸鍋。全填。

### 7-bis.1 安全模型

| 攻擊面 | 緩解措施 | 對應實作 |
|---|---|---|
| **Tenant A secret 洩漏 → 觸發 tenant B 通知** | 每 tenant 獨立 secret；guard 匹配 secret 才決定 tenant | §4.3 |
| **Timing attack 推測 tenant 數量** | Guard 掃完所有 tenant secret 才回應（不 early return）| §4.3 |
| **Payload 帶錯 tenant 的 sheet path** | `allowedSheetPaths` 白名單（縱深防禦）| §4.4 |
| **Dedup 跨 tenant 誤觸發**（tenant A recordId=1 → tenant B recordId=1 被 dedup） | Dedup key 加 tenant prefix | §5.2 |
| **audit log 混淆** | `notification_log.tenant_id` NOT NULL；per-tenant 查詢 index | §7.1 |
| **舊 secret 洩漏 → 冒充 default tenant** | 台灣福祉 secret 走 default fallback；本期 OQ-NMT-4 建議 quarterly rotate；日後每個 tenant 獨立 rotate | SOP §11.3 |
| **新 tenant onboarding 誤操作**（tenant slug 拼錯、secret 兩客戶碰撞） | Registry startup validation：slug unique / secret unique / 缺項報錯 crash | §4.2 |
| **LINE token 走錯 tenant 送訊** | `LineClient.pushText(cfg, text)` — cfg 由 tenant resolver 提供，不從 process.env 讀 | §5.1 |

**Input validation**：延用 [[notify.md §7-bis.1]]；額外白名單 `sheetPath` ∈ `allowedSheetPaths`。

### 7-bis.2 容量規劃

- **預估 QPS**：<0.05/s（兩客戶合計 <500 通/月）；peak spike 10/s（月報批改）
- **`notification_log` 增量**：+~500 筆/月 × 2 KB = ~1 MB/月（可忽略）
- **Blast radius**：secret 洩漏影響範圍 = 該 tenant（單一群組單一 token）
- **Registry 建立成本**：一次性 boot 時掃 env、O(N tenants)；N < 20 無影響

### 7-bis.3 失效模式

| 路徑 | Timeout | Retry policy | Fallback |
|---|---|---|---|
| Tenant resolver（純 in-memory）| n/a | n/a | Boot 若 env 缺項 → crash（fail-loud）|
| LINE Push（per-tenant token）| 5s（同 v1.0）| 不 retry | 標 `line_failed` + `tenant_id` |
| Sheet path 白名單驗 | in-memory | n/a | 403 `sheetPath_not_allowed` + audit log |

### 7-bis.4 觀測性

新增指標：

| 類型 | 名稱 | 用途 |
|---|---|---|
| structured log | `logger.info({tenantId, sheetPath, status})` | 每次 request 帶 tenant |
| SQL query | `SELECT tenant_id, status, COUNT(*) FROM notification_log WHERE received_at > NOW() - '1 day' GROUP BY 1,2` | per-tenant 錯誤率 |
| alert（Phase 2）| tenant X 5min 內 `line_failed` > 3 | per-tenant 告警 |

### 7-bis.5 資料生命週期

沿用 [[notify.md §7-bis.5]]；新增 `tenant_id` 屬**非 PII**（是內部 slug）。Right-to-erasure 若 tenant 離場 → `DELETE FROM notification_log WHERE tenant_id = 'xxx'`。

### 7-bis.6 向後兼容 + Rollout

- **Backward compat**：舊 endpoint 路徑 `/notify/ragic/maintenance-report` / `analysis-sheet` 保留；台灣福祉的 Ragic Workflow 零改動、secret 值不變 → default fallback 命中
- **Rollout 順序**：
  1. Migration 加 `tenant_id` NOT NULL + default 'twh' + backfill
  2. Deploy backend（新 guard + resolver + stateless LineClient）—— 台灣福祉即刻走新路徑但行為不變
  3. Smoke：台灣福祉手動觸發一筆 → 確認 `tenant_id = 'twh'` 寫入
  4. 加鮮勇 env → redeploy → registry 認 2 tenant
  5. 鮮勇 Ragic 貼 workflow → 端到端 smoke → 鮮勇業助群收到訊息 with `tenant_id = 'xianyong'`
- **Rollback**：backend rollback 立即；migration 有 down script

### 7-bis.7 成本模型

沿用 [[notify.md §7-bis.7]]；鮮勇兩張表估 200 通/月，仍在 LINE free tier 500/月 內。**兩 tenant 加起來預估 <400 通/月**，仍 $0；升級門檻同前。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | Tenant registry build（env 缺項 / slug 碰撞 / secret 碰撞）× 6；WebhookSecretGuard（多 tenant timing-safe match / miss）× 4；compose-quotation × 4；compose-material-inspection × 4；LineClient stateless（token/group 傳入）× 2 | `server/src/notify/__tests__/*.test.ts` |
| Integration | E2E：兩 tenant 各送一 request → 對應 group 收到（mock LINE）；cross-tenant 白名單擋（帶錯 sheet path 收 403）| `server/test/notify.e2e-spec.ts` |
| Manual smoke | M5：台灣福祉 TB-P71 保持行為；鮮勇報價單 + 原料驗貨單各觸發一次 | walk-through |

至少 **22 個 unit tests**（R2 安全敏感模組覆蓋率 >80%）。

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED（用戶定 OQ-NMT-1..11）| 0.02 mo | ⏳ |
| **M1** Tenant registry + guard 改造 + 8 test | env 讀 per-tenant；`req.tenant` 附掛；default fallback | 0.04 mo | ⏳ |
| **M2** LineClient stateless + Service tenant-aware + migration + 6 test | `notification_log.tenant_id` 啟用；dedup key 加 prefix | 0.03 mo | ⏳ |
| **M3** 鮮勇報價單 endpoint + template + 4 test | DTO / compose / Ragic Workflow JS | 0.03 mo | ⏳ |
| **M4** 鮮勇原料驗貨單 endpoint + template + 4 test + SOP | 同上 + `SOP §11.1.c` onboarding | 0.03 mo | ⏳ |
| **M5** FMEA + prod cutover + 發版通知 | §12 逐路徑；smoke；MODULES.md ✅ | 0.03 mo | ⏳ |

---

## 10. 開放問題（OQ-NMT-N）— ✅ 全部裁定（2026-07-17）

| # | 訴求 | 議題 | 選項 | 裁定 | 裁定理由 |
|---|:-:|---|---|---|---|
| **OQ-NMT-1** | B1 | Tenant 辨識機制？ | A. per-tenant `NOTIFY_WEBHOOK_SECRET_<T>` / B. X-Tenant header / C. URL prefix / D. sheetPath prefix | ✅ **A** | secret 兼識別、Ragic Workflow 零額外改動、洩漏隔離 |
| **OQ-NMT-2** | B3 | Tenant config 儲存位？ | A. env / B. DB `tenants` 表 / C. 混合 | ✅ **A** | YAGNI；第 3 客戶再切 B |
| **OQ-NMT-3** | B1 | Sheet path 是否綁 tenant 白名單？ | A. 不驗 / B. env 白名單 | ✅ **B** | 縱深防禦；防 secret 用錯 tenant → cross-tenant 訊息串線；空白名單語意 = 允許所有（back-compat）|
| **OQ-NMT-4** | B3 | 既有台灣福祉 env 是否 rename？ | A. rename `_TWH` / B. 沿用舊名 default fallback / C. alias | ✅ **B** | 零停機、Ragic Workflow 端零改動；deploy 立即 rollback-safe |
| **OQ-NMT-5** | B4 | `notification_log.tenant_id` 型別？ | A. text 存 slug / B. UUID + tenants 表 FK | ✅ **A** | 現無 tenants 表；slug 直觀；日後 tenants 表建了再加 FK |
| **OQ-NMT-6** | B1 | `LineClient` 設計？ | A. Factory / B. stateless `pushText(cfg, text)` / C. per-tenant instance | ✅ **B** | 最單純、無 instance 生命週期、易測 |
| **OQ-NMT-7** | B2 | 本次一次做完鮮勇兩表？ | A. 是 / B. 只做 infra、鮮勇表另開 M | ✅ **A** | 避免 tenant infra 抽完沒真 tenant 使用 = 空架構 |
| **OQ-NMT-8** | B2 | 報價單訊息模板選欄？ | A. §6.1 表擇 8 欄 / B. 另份 / C. 全 14 欄 | ✅ **A** | 訊息長度可控；DTO 全 14 欄 optional 收、compose 只輸出 8 |
| **OQ-NMT-9** | B2 | 觸發時機？ | 報價單 a1/a2/a3；驗貨單 b1/b2/b3 | ✅ **報價單 a1+a2 · 驗貨單 b1+b2**（2026-07-17 修訂）| 原本裁定 b2+b3（條件式 push）；實測時用戶要求「任何修改都通知」→ 改與報價單同策略、每次 save 都發、backend 30 秒 dedup 兜底 |
| **OQ-NMT-10** | B2 | 兩張新 sheet path？ | 需鮮勇端提供 | ✅ **報價單=`/erp/1`（下游-1）· 原料驗貨單=`/erp/64`（上游-4a）**（2026-07-17 用戶確認；4 支 Ragic Workflow template SHEET_PATH 已定值）|
| **OQ-NMT-11** | B2 | 鮮勇 LINE 官方帳號共用還獨立？ | A. 共用 / B. 獨立 | ✅ **A** | 共用簡單、fallback default token；日後品牌需求再切 B |

---

## 11. SOP — 日常操作 & Push Checklist

### 11.0 Push 前檢核清單（M5 硬性 gate；OQ-NMT-10 未完 + 各 P0 by-SOP 緩解都靠這步）

**⚠️ 未走完不得 `git push` / 不得 deploy**（memory `feedback_verify_prod_state_before_push.md`）

**A. 資訊蒐集**（跟鮮勇 admin 要）：

- [x] 鮮勇報價單 sheet path：**`/erp/1`**（下游-1）
- [x] 鮮勇原料驗貨單 sheet path：**`/erp/64`**（上游-4a）
- [x] ~~鮮勇業助 LINE 群組 ID~~ **測試階段共用台灣福祉業助群**（未來鮮勇拉自己的群再補）

**B. 我方產 secret**：

- [ ] `openssl rand -hex 32` 產鮮勇專屬 secret

**C. 貼 4 支 Ragic Workflow 進客戶端 Ragic**（貼前手動替換 `GLOBAL_NOTIFY_SECRET` 佔位 → 實際 secret）：

- [x] `xianyong-quotation-post.js` → 已貼到 `/erp/1` 的 Post workflow（2026-07-17）
- [x] `xianyong-material-inspection-post.js` → 已貼到 `/erp/64` 的 Post workflow（2026-07-17）
- [ ] `xianyong-quotation-action-button.js` → 暫緩（Post workflow 已能覆蓋儲存觸發；動作按鈕留 v1.1）
- [ ] `xianyong-material-inspection-action-button.js` → 暫緩（同上）

**D. 補 backend `.env` / Render env**：

```env
NOTIFY_WEBHOOK_SECRET_XIANYONG=<B 產的 32-hex>
NOTIFY_TENANT_SHEETS_XIANYONG=/erp/1,/erp/64
# 測試階段 · 共用台灣福祉業助群：LINE_GROUP_ID_BUSINESS_ASSIST_XIANYONG 留空 → fallback default group（audit 仍 tenant_id 分流；訊息由標題「【鮮勇xxx｜xxx】」辨識來源）
# 未來鮮勇拉自己的業助群 → 補 LINE_GROUP_ID_BUSINESS_ASSIST_XIANYONG=<xy group ID>
# LINE_CHANNEL_ACCESS_TOKEN_XIANYONG 留空 → fallback 共用「台灣福祉 AI客服」官方帳號（OQ-NMT-11 A）
```

**E. Prod migration（R10 · 人工執行）**：

```bash
psql "$DATABASE_URL_PROD" -f server/src/db/migrations/0004_notify_multi_tenant.sql
```

驗證：

```sql
SELECT tenant_id, COUNT(*) FROM notification_log GROUP BY 1;
-- 預期：twh | N（M2 前歷史 row 已 backfill 'twh'）
```

**F. Backend deploy**：

- [ ] `git push origin main` → Render 自動 deploy
- [ ] 檢查 Render startup log：
  ```
  [TenantRegistry] notify tenants 註冊：twh(台灣福祉), xianyong(鮮勇)
  [NotifyRepository] notification_log 表就緒 ✓
  ```
- [ ] 若 boot crash → 檢查 D 的 env 拼字、E migration 是否跑完
- [ ] ⚠️ **Ragic 端 Post-workflow 貼完後、業助 admin 需登出 Ragic 重新登入**才會生效（[[pitfall_ragic_post_workflow_relogin]]）；否則 workflow 儲存了但不 fire

**G. 台灣福祉 back-compat smoke**（不能被 M2 改動搞壞）：

- [ ] aitode TB-P71 中部維修保養單建一筆 record → 儲存 → 台灣福祉業助群應在 30 秒內收到訊息（同 v1.0 行為）
- [ ] `SELECT * FROM notification_log WHERE tenant_id='twh' ORDER BY received_at DESC LIMIT 3` → 有筆、status=sent

**H. 鮮勇端 Ragic Workflow 貼 + 端到端 smoke**（依 [`notify-new-tenant-onboarding.md`](../sop/notify-new-tenant-onboarding.md)）：

- [ ] 貼 4 支 workflow（Post + Action Button × 2 sheets）
- [ ] 鮮勇報價單建一筆 → 儲存 → 鮮勇業助群 30 秒內收到訊息
- [ ] 鮮勇原料驗貨單任意欄位修改 → 儲存 → 鮮勇業助群收到訊息（無條件 push · OQ-NMT-9 修訂）
- [ ] 動作按鈕各測一次 → 立即收到
- [ ] `SELECT * FROM notification_log WHERE tenant_id='xianyong' ORDER BY received_at DESC LIMIT 5` → 有筆、status 全綠

**I. Rollback plan**（若 H 失敗）：

- 只 rollback backend（不 rollback migration；tenant_id 保留為 'twh' 對舊 code 相容）
- 若 registry boot crash → 移除 XIANYONG env 4 條 → redeploy
- 若鮮勇通知推去錯群 → **立即** 停 Ragic Workflow（Post workflow 註解掉 `util.postURL`）→ 排查 secret 拼字

---

### 11.1.c 新客戶 onboarding（第 3 客起套用）

看 [`docs/sop/notify-new-tenant-onboarding.md`](../sop/notify-new-tenant-onboarding.md) 7-step 版本。

### 11.2 失敗模式排查（新增條目）

| 症狀 | 含意 | 處置 |
|---|---|---|
| Ragic 端 200 OK 但錯 tenant 群組收到 | Secret 用錯 tenant | 檢查 Ragic Global Workflow 的 `TENANT_SECRET` 常數 vs backend env |
| `403 sheetPath_not_allowed` | White list 沒配該 sheet path | 加入 `NOTIFY_TENANT_SHEETS_<T>` |
| Boot crash `duplicate tenant slug` | env 兩個 tenant 用同一 secret | 重產一組 secret，改 env |
| 台灣福祉群組沒收到但鮮勇正常 | Default fallback 失效 | 檢查舊 `NOTIFY_WEBHOOK_SECRET` env 還在 |

### 11.3 Secret rotation（per-tenant quarterly）

同 [[notify.md §11.3]]；每 tenant 獨立 rotate、非 lockstep。

---

## 12. 失效場景反思（FMEA）— M5 完成 ✅

> M5 逐路徑 pre-mortem 完成；**P0 全清**（4 個 P0 候選降到 P1 並緩解）。
> 上 prod 前需完成 §11.push checklist（人工補 sheet path + secret + migration 先跑）。

### 12.1 Tenant resolver 入口

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| T1 | Registry boot 時 env 缺項（default token/group/secret 任一缺）| `buildTenantRegistry` throw 明確 `Error` → Nest boot crash（fail-loud）；container 掛掉 log 立即可見 | ✅ 已緩解（`tenant.registry.test.ts` 覆蓋 3 種缺項）| P0 → **P1** |
| T2 | 兩 tenant secret 碰撞 | Boot validation `seen.set(secret)` 檢測 → throw `webhookSecret 碰撞` | ✅ 已緩解（test 覆蓋）| P0 → **P1** |
| T3 | Tenant slug 拼錯（e.g. `NOTIFY_WEBHOOK_SECRET_XIANYON`）| Registry 認得，但客戶 Ragic Workflow 用另一組 secret → guard 掃不到 → 401 `invalid secret` + audit | ✅（正常擋掉）| P1 |
| T4 | **舊 default fallback 失效（`NOTIFY_WEBHOOK_SECRET` 被刪或 rename）** | Registry boot 走 suffix 路徑；台灣福祉 secret 消失 → guard 對台灣福祉 request 全 401；業助群 24 小時內收不到通知 → 用戶投訴 | ✅ 已緩解 — env 未動時零風險；若人工手誤刪除 → boot 時 registry 只認得 xianyong tenant、台灣福祉 Ragic Workflow 401 fail-loud（不會靜默壞）；SOP §11.4 rollback | P0 → **P1** |
| T5 | Registry 建立成功但顯示名未加 | `KNOWN_TENANT_DISPLAY_NAMES` fallback = slug 本身，log 略難讀但功能無影響 | ✅（無感）| P2 |

### 12.2 Cross-tenant 隔離（核心攻擊面）

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| X1 | Secret A 送 tenant B 的 sheet path | Guard 命中 tenant A → service 檢查 `allowedSheetPaths.includes(payload.sheetPath)` → false → 回 `sheet_not_allowed` + audit `tenantId=A, sheetPath=B` | ✅ 已緩解（`service.test.ts` `tenant xianyong 非白名單 sheetPath → sheet_not_allowed`）| P0 → **P1** |
| X2 | 兩 tenant 同 recordId → 誤 dedup | dedup key = `${tenantSlug}:${sheetPath}:${recordId}` → 各 tenant 獨立 namespace | ✅ 已緩解（`dedup.test.ts` `不同 tenant 同 sheetPath+recordId → 不 dedup` + `service.test.ts` `cross-tenant 同 recordId 不 dedup`）| P0 → **P1** |
| X3 | LineClient 讀錯 tenant config 推錯群 | LineClient stateless；`cfg: {token, groupId}` 由 service 從 `req.tenant` 取 → 傳入前無跨層可能 | ✅ 已緩解（`line-client.test.ts` `不同 tenant 傳不同 cfg → token/group 隨之改變` + `service.test.ts` `sent → line.calls[0].cfg.token = twh-token`）| P0 → **P1** |
| X4 | `notification_log.tenant_id` 遺漏 → audit 混淆 | DB `tenant_id text NOT NULL DEFAULT 'twh'`；schema 型別強制；service 一律傳 `tenant.slug`；漏帶時 DB default 兜底且 slug 是 `'twh'`（back-compat 正確） | ✅ 已緩解 | P1 |
| X5 | Timing attack 推測 tenant 數量 | Guard 掃完所有 tenant secret 才回應（不 early return）；長度不同時做 dummy `timingSafeEqual` 消 CPU | ✅ 已緩解 | P2 |
| X6 | 攻擊者拿有效 secret A 打 tenant A 的 sheet 但用 tenant B 的 recordId | 白名單只驗 sheetPath；recordId 屬 tenant A 的 sheet 內部 → 攻擊者能查到 record 也只影響 tenant A 自己的 audit | ⚠️ 已知殘留 — 不視為 cross-tenant 洩漏（tenant A 自曝）；治本方向若做「recordId 與 tenant 綁定」需 Ragic API 反查、成本高 | P2 |
| X7 | **測試階段兩 tenant 共用同一 LINE 業助群**（鮮勇 group id fallback default）| 台灣福祉業助能看到鮮勇通知訊息（反之亦然）；訊息標題帶 sheetName（「【鮮勇報價單｜xxx】」）業助可辨識來源；`notification_log.tenant_id` 仍分流、DB 側審計不混 | ⚠️ 已知殘留（**測試階段刻意**）—— 治本：鮮勇有自己業助群時補 `LINE_GROUP_ID_BUSINESS_ASSIST_XIANYONG` env 即可切開，無需 code 改動 | P2 |

### 12.3 LINE 端錯誤（per-tenant 版本，延用 [[notify.md §12.2]]）

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| L1 | 429 rate limit | 標 `line_failed` line_status=429；不 retry；audit 帶 tenant_id → per-tenant 錯誤率可算 | ✅ | P1 |
| L2 | 401 invalid token（tenant token 過期）| 標 `line_failed`；只影響該 tenant | ⚠️ 已知殘留（沿用 notify.md L2 · startup ping 未實作）| P1 |
| L3 | 網路 timeout（>5s）| AbortController + 標 line_failed | ✅ | P1 |
| L4 | tenant cfg 有 token 但 groupId 空 | LineClient 起手檢查 `cfg.groupId` → 直接 `ok=false, message: "tenant groupId 為空"`、不打 API | ✅（`line-client.test.ts` 覆蓋）| P1 |

### 12.4 DB 寫入（新 tenant_id 相關）

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| D1 | Postgres 連線失效 | `NotifyRepository.writeLog` try/catch → 返回 null；LINE 已發、Ragic 端仍收 200 | ✅（沿用 notify.md v1.0 D1）| P1 |
| D2 | notification_log 表遺失 | `onModuleInit` startup ping | ✅（沿用 notify.md v1.0 D2）| P1 |
| D3 | tenant_id 型別遷移 UUID → text | migration 0004 backfill 'twh' + backwards-safe：先 NULL 化舊 UUID → 改型別 → backfill 'twh' → NOT NULL；down script 存在但已存非 UUID slug 值時無法自動退回（需先手工處理） | ⚠️ 已知殘留（down script 非全自動）| P1 |
| D4 | status CHECK 沒加 `sheet_not_allowed` 就 deploy backend | INSERT 全部 fail（constraint violation） | ⚠️ **部署順序關鍵** — R10 硬性要求 migration 0004 必先於 backend deploy；否則 backend 收 xianyong request 走白名單擋路徑時 INSERT 崩、audit 遺失 | P0 → **P1**（gated by SOP §11 push checklist）|

### 12.5 部署順序（migration → backend → Ragic Workflow）

| # | 場景 | 風險 | 緩解 |
|---|---|---|---|
| P1 | Backend deploy 早於 migration 0004 | INSERT 因 CHECK / NOT NULL 全 fail | ✅ SOP §11 push checklist 明確順序（migration → deploy → smoke → 再貼 Ragic Workflow）|
| P2 | Ragic 端 Xianyong Workflow 已貼、backend env `NOTIFY_WEBHOOK_SECRET_XIANYONG` 還沒填 | Ragic POST 全部 401；業助群沒收到但業助不會覺得異樣（無感靜默失敗）| ⚠️ 已知殘留 — SOP §11 要求「先 backend deploy 完 + env 都補齊 → 再貼 Ragic Workflow」但 order 靠人記；治本方向 startup ping tenant 對應 group（同 L2 未做）| P1 |
| P3 | 台灣福祉舊 Ragic Workflow 完全不動（sheetPath 不在鮮勇白名單、但仍走 default tenant twh、twh 白名單空 → 過）| ✅ back-compat 正確 | ✅ M2 白名單空語意 = 允許所有；`service.test.ts` `twh 白名單空 → 任何 sheetPath 都允許` 覆蓋 |
| P4 | env 補齊順序錯（先加 `NOTIFY_WEBHOOK_SECRET_XIANYONG` + sheet 白名單、但漏加 `LINE_GROUP_ID_BUSINESS_ASSIST_XIANYONG`）| Registry boot crash（`缺 LINE_GROUP_ID_BUSINESS_ASSIST_XIANYONG`）→ backend 完全起不來、台灣福祉 通知也 down | ⚠️ 已知殘留 — fail-loud 是刻意（不想讓 xianyong config 半通半不通）；SOP §11 push checklist 要求「env 4 條一次補齊、redeploy 前檢查」；rollback 為砍 XIANYONG 相關 env、redeploy | P1 |

### 12.6 已知殘留（暫緩處理）

- **X6 recordId 與 tenant 綁定**：現況 sheet path 白名單已擋掉大部分 cross-tenant 攻擊；recordId 綁定需 Ragic API 反查、成本 vs 效益不划算
- **L2 LINE token 過期無 startup 提示**：沿用 notify.md v1.0 殘留；治本方向 startup ping
- **P2 Ragic Workflow 先貼、env 沒補 → 401 靜默**：SOP 靠人記；治本方向 startup 打 test push 到各 tenant group
- **D3 migration 0004 down script 非全自動**：非 UUID slug 值需手工處理；rollback 事件罕見、可接受
- **notification_log 90 天 retention 未做 cron**：沿用 notify.md 殘留

### 12.7 不在本 module scope 修的 pre-existing 問題

- 沿用 notify.md v1.0 的所有 pre-existing 項目
- 新增：本 module `notification_log` 不掛 RLS（Phase 3 開放讀取 API 時才做；讀取用 admin SQL 帶明確 `WHERE tenant_id`）

> **檢查點（M5 完成 · 2026-07-17）**：T1/T2/T4 三個 P0 候選都降到 P1 並緩解；X1/X2/X3 三個 cross-tenant P0 全部 ✅；D4 P0 由 SOP §11 push checklist 硬性 gate。**符合 R17「P0 全清才可上 prod」**——但仍需人工完成 §11 checklist（sheet path 補、secret 產、migration 先跑）才可 push。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-17 | v0.1 | 初版 DRAFT — M0–M5、OQ-NMT-1..11、FMEA skeleton | Claude Code |
| 2026-07-17 | v0.2 | OQ-NMT-1..9、11 全部裁定（OQ-10 sheet path 留 push checklist）；狀態 DRAFT → APPROVED | Claude Code |
| 2026-07-17 | v0.9 | M1–M5 code + 71 unit tests 全綠；migration 0004 寫好；4 個 Ragic Workflow template；onboarding SOP；FMEA 逐路徑填齊、P0 全清；待人工補 §11 push checklist 即可上 prod | Claude Code |
| 2026-07-17 | v1.0 | 上 prod（commit `fc772a5` + `a04141d`）；migration 已跑（37 舊 row backfill 'twh'）；台灣福祉 back-compat 保持；OQ-NMT-9 驗貨單改「任何 save 都發」（原 b2+b3 條件式 push 實測太保守、改 b1+b2 與報價單同策略） | Claude Code |
