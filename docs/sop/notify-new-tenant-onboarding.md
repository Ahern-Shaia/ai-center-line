# notify — 新客戶 onboarding SOP

> notify 多租戶架構（notify-multi-tenant.md v0.1）落地後，加新客戶只需**配 env + Ragic 貼 workflow**、無 code 改動。本 SOP 給 admin 逐步照做。

## 前置

- 客戶已有 Ragic 帳號（e.g. `freshfruits`）
- 目標 sheet 已存在、你能取得 sheet path（`/tab-slug/id`）與各欄位 fieldId
- 已決定該客戶要用**共用**還是**獨立** LINE 官方帳號
- 該客戶已有專屬 LINE 業助群、群組 ID 已取得

## Step 1：產 tenant secret

```bash
openssl rand -hex 32
```

複製結果備用。**每個 tenant 一組獨立 secret**（不共用；洩漏隔離）。

## Step 2：加 backend `.env`

`server/.env`（tenant slug = `<T>`，全大寫代入 env key）：

```env
NOTIFY_WEBHOOK_SECRET_<T>=<Step 1 產的 32-hex>
LINE_GROUP_ID_BUSINESS_ASSIST_<T>=<業助群 group ID>

# 獨立 LINE 官方帳號才填；共用留空 → fallback default
LINE_CHANNEL_ACCESS_TOKEN_<T>=

# Sheet 白名單（縱深防禦）— 多個 path 以 comma 分隔
NOTIFY_TENANT_SHEETS_<T>=/tab1/id,/tab2/id

# 若之後也要走 Ragic API 對帳/回拉，補這三個
RAGIC_<T>_BASE_URL=https://ap16.ragic.com
RAGIC_<T>_ACCOUNT=<客戶 Ragic account slug>
RAGIC_<T>_API_KEY=<客戶授權的 Ragic API key>
```

**命名慣例**：
- 首客（台灣福祉）沿用無後綴變數當 default fallback（`NOTIFY_WEBHOOK_SECRET` 等）
- 第 2 客起 slug 後綴（`_XIANYONG`、`_ACME` 等）

## Step 3：加 tenant slug 顯示名（可選）

若要在 log 顯示中文名稱，`server/src/notify/tenant.registry.ts`：

```typescript
const KNOWN_TENANT_DISPLAY_NAMES: Record<string, string> = {
  twh: "台灣福祉",
  xianyong: "鮮勇",
  <new_slug>: "<客戶中文名>",  // 加這行
};
```

不加也可以 —— log 顯示為 slug 本身、不影響功能。

## Step 4：Deploy backend

- Migration 若還沒跑（0004 起 tenant_id 啟用）→ 先 psql prod 跑
- Push code → Render 自動 deploy
- 檢查 `Startup log` 有：
  ```
  [TenantRegistry] notify tenants 註冊：twh(台灣福祉), <new_slug>(<顯示名>)
  ```
- 若 boot crash（`duplicate tenant slug` / `NOTIFY_WEBHOOK_SECRET_X 缺` 等）→ 檢查 env 拼字

## Step 5：客戶端 Ragic 貼 Workflow

對**每張要通知的 sheet** 重複下列步驟：

### 5.1 準備 template

從 `docs/sop/ragic-workflow-templates/` 挑對應的兩支：

| 客戶 | Sheet | Post workflow | Action button |
|---|---|---|---|
| 台灣福祉 | 分析表 | `tbp01-post-workflow.js` | `tbp01-action-button.js` |
| 台灣福祉 | 維修保養單 | `tbp71-post-workflow.js` | `tbp71-action-button.js` |
| 鮮勇 | 報價單 | `xianyong-quotation-post.js` | `xianyong-quotation-action-button.js` |
| 鮮勇 | 原料驗貨單 | `xianyong-material-inspection-post.js` | `xianyong-material-inspection-action-button.js` |
| 其他 | 其他 | 複製既有 template 改名 + 換 fieldId | 同左 |

### 5.2 替換 template 內的 placeholder

- `<REPLACE_WITH_SHEET_PATH>` → 該 sheet 實際 path（e.g. `/quotation/6`）
- `<REPLACE_WITH_NOTIFY_WEBHOOK_SECRET_<T>_FROM_ENV>` → Step 1 產的 secret

⚠️ **Ragic Workflow 8 大踩坑** — 貼前先讀 `docs/sop/ragic-workflow-templates.md`（尤其 Rhino ES5 尾逗號、Action Button 單行、`param.getUpdatedEntry()` 等）

### 5.3 貼上

**Post workflow**（多行編輯器）：
1. Ragic sheet → 修改設計 → JavaScript Workflow → 上方切「Post-workflow」（不是 Global）
2. Cmd+A 清空 → 貼 `-post.js` 整份
3. 儲存 workflow → 儲存修改設計

**Action button**（單行 input）：
1. Ragic sheet → 修改設計 → 表單設定 → 動作按鈕 → 新增
2. 動作類型：**JS Workflow**
3. 動作欄位貼 `-action-button.js` 內 BEGIN/END 之間**那一行**
4. 儲存按鈕 → 儲存表單設定

## Step 6：手動 smoke test

1. 開該 sheet 一筆 record → 儲存 → 業助群應在 30 秒內收到訊息
2. 點 Action button → 業助群立即收到訊息
3. Backend 端跑 SQL 確認 audit：
   ```sql
   SELECT tenant_id, trigger, sheet_path, status, received_at
   FROM notification_log
   WHERE tenant_id = '<new_slug>'
   ORDER BY received_at DESC
   LIMIT 5;
   ```

## Step 7：失敗排查

| 症狀 | 含意 | 處置 |
|---|---|---|
| 業助群沒收到、Ragic log 印 `401 invalid secret` | Ragic 端 secret 跟 backend env 不一致 | 比對 template 內 `GLOBAL_NOTIFY_SECRET` vs `.env` 的 `NOTIFY_WEBHOOK_SECRET_<T>` |
| `notification_log.status = 'sheet_not_allowed'` | `NOTIFY_TENANT_SHEETS_<T>` 沒配該 sheet path | 補 env、redeploy |
| 業助群收到但推去錯 group | secret 用錯 tenant | 檢查 template 用的是不是該 tenant 的 secret |
| Backend boot crash `duplicate tenant slug` | 兩 env 用相同 secret | 其中一個重產 secret |
| Backend boot crash `NOTIFY_WEBHOOK_SECRET_X 缺` | env 拼字錯 | 檢查大小寫 / 底線 |
| Ragic log 印 `Expected an operand but found )` | Rhino ES5 尾逗號 | 檢查 `.postURL(...,)` 尾逗號、參見 pitfall |

## 相關文件

- 設計文件：`docs/modules/notify-multi-tenant.md`
- 基礎架構：`docs/modules/notify.md`
- Ragic Workflow 陷阱：`docs/sop/ragic-workflow-templates.md`
- 模板檔案：`docs/sop/ragic-workflow-templates/`
