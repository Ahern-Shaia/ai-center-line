# Ragic JavaScript Workflow 模板集

> 給 Ragic 設計模式的 Workflow 編輯區用的 ready-to-paste JavaScript 模板。專案無關 — 換其他 sheet / 換其他 backend endpoint 只要改 3 個地方（sheetPath / endpoint / 欄位對照表）就能複用。
>
> 版本：v1.1（2026-07-07）
> 相關：`docs/modules/notify.md`（notify 模組設計）、`docs/sop/line-messaging-api-setup.md`（LINE API 串接 SOP）

## 快速索引 · 現成模板檔（`ragic-workflow-templates/`）

| 檔案 | 貼到 Ragic 哪 | 觸發時機 |
|---|---|---|
| [`tbp71-post-workflow.js`](ragic-workflow-templates/tbp71-post-workflow.js) | TB-P71 中部 · 修改設計 → Workflow → Post workflow | 記錄儲存後自動 |
| [`tbp71-action-button.js`](ragic-workflow-templates/tbp71-action-button.js) | TB-P71 中部 · 修改設計 → 動作按鈕 → 動作欄 | 手動按「發送 LINE 通知」 |

**要用法**：開對應 `.js` 檔 → 全選複製（Action Button 檔只複製 `BEGIN...END` 之間那一行）→ 貼進 Ragic 對應位置 → 換 `<REPLACE_WITH_NOTIFY_WEBHOOK_SECRET_FROM_ENV>` 為實際值 → 儲存。

複製到別的 sheet：見 §2「換 sheet 複製指南」。

---

## 0. 使用前必讀

### Ragic Workflow JS 執行環境限制（ES5，Nashorn/Rhino）

**不支援**：
- 箭頭函數 `() => {}`
- `const` / `let`（一律用 `var`）
- Template literals `` `hello ${name}` ``（用字串串接 `"hello " + name`）
- 物件屬性 shorthand `{ name }`（要寫 `{ name: name }`）
- `Array.from`、`Object.entries`、`Promise`、`async/await`、`fetch`

**支援**：
- 舊 JS `var` / `function` / `try-catch`
- `JSON.stringify()` / `JSON.parse()`
- 全域物件：`record`（當前記錄）、`util`（HTTP client + header）、`log`（logger）、`db`（DB query）

### 貼碼 SOP（避免踩坑）

1. **打開 sheet 修改設計** → 找 **Workflow** tab（有的版本叫「工作流程」/「表單流程」）
2. **選對觸發時機**：
   - `Pre workflow` — 儲存前執行（可擋存檔、可改 record 值）
   - `Post workflow` — 儲存後執行 ← **本模板用這個**
   - `Action button` — 動作按鈕觸發
3. **`Cmd+A` 清空編輯區** → **不要**在原有程式碼中間插入我的模板，容易被貼歪產生 orphan 語法
4. **貼上模板** → **只改標記為 `<這裡改>` 的部分**（別的先別動）
5. **儲存 workflow** → **儲存修改設計**（有的版本要按兩次「儲存」跳出設計模式）

### 常見報錯速查

| 症狀 | 通常原因 | 解 |
|---|---|---|
| **按鈕沒任何反應 · backend 收不到 request · Ragic 也沒錯誤彈窗** | ⚠️ **Ragic Action Button 的 JS 存在 `<input type="text">` 單行輸入框**，貼上多行 code 時**換行被壓成空白**，若含 `//` 註解 → 後面 code **全被註解掉**、Ragic 靜默失敗 | (1) **所有 `//` 註解全部拿掉**（改用 `/* */` 或無註解）(2) 貼進去看能不能容納完整長度、太長就精簡 (3) 對比 §0.5 「Action Button 單行陷阱」 |
| `Post-workflow:N:2 Expected an operand but found )` (Ragic 儲存記錄時 popup) | ES5 引擎不支援 **函數呼叫**參數列尾逗號 · Prettier 拆行時會自動加 `,` on `foo(a, b,)` | 該行改成**單行**寫（不拆行 Prettier 就不加尾逗號）；或行尾**明確拿掉逗號** |
| `Syntax Error at line N` 但看起來沒問題 | 貼碼時複製到中文全形引號 `「」` / `『』` 而不是英文 `"` | 重貼、用純文字編輯器中轉一次 |
| Line X 附近有 orphaned property | 貼了兩次或中間插入 | `Cmd+A` 清空重貼 |
| `record is not defined` / `util is not defined` | Ragic 版本 API 不同、或用了 Post workflow 專屬 API 在 Action button 內 | 見下方 §6 相容性表；Post workflow 用 `record`，Action button 得用 `_ragicId` + `db.getAPIQuery()` |
| Backend 回 401 invalid secret | `GLOBAL_NOTIFY_SECRET` 值錯 / 前後有空白 | 對 `.env` 比對，去頭尾空白 |
| Backend 回 400 invalid body | 欄位對照 field ID 錯 / record 有欄為空但 Zod 要 string | Ragic 執行 log 印 payload 看 |

### 0.5 Action Button 單行陷阱（重要 · 2026-07-07 踩過）

**症狀**：貼 code 進「動作 → 動作按鈕 → 動作」欄位、按下按鈕沒任何反應、backend 也沒 request。

**原因**：Ragic 的 Action Button 用 `<input type="text">`（**單行**輸入框）存 JS，不是 textarea。所有換行會被視為空白、`//` 註解會把後面 code 一起吃掉。

**規則**：**Action Button 版本的 JS 必須**：
1. **零 `//` 註解**（改 `/* ... */` block 註解或全刪）
2. **每個 statement 都用 `;` 結束**（不可靠 auto semicolon insertion）
3. **可以有換行**（Ragic 會壓成空白）但整段長度不可超過 input 容納限制（實測約 3000 字元內安全）

**Post Workflow 沒此限制**（Post workflow 是 textarea 編輯器、多行 OK、支援 `//` 註解）。

**另一個 Ragic 語法檢查會擋的**：`db.getAPIQuery()` 空手呼叫會被擋 —— 必須帶 sheet path：`db.getAPIQuery("/service-tickets/10")`。這對 Post workflow 也適用。

### 0.6 Prettier 尾逗號陷阱（Post workflow · ES5 引擎）

**症狀**：`Post-workflow:N:2 Expected an operand but found )`（Ragic 儲存記錄時 popup 錯誤）

**原因**：Ragic Post workflow 引擎是 ES5（Rhino/Nashorn），**函數呼叫**的參數列不允許尾逗號。物件字面量 `{a: 1, b: 2,}` 尾逗號 OK，函數呼叫 `foo(a, b,)` **不 OK**。

Prettier / IDE 自動格式化時，會把跨行函數呼叫改成：
```javascript
util.postURL(
  URL,
  JSON.stringify(payload),   ← 這個尾逗號 = ES5 syntax error
);
```

**解**（三選一，本專案用方案 1）：
1. **重點函數呼叫寫單行**、不拆行 → Prettier 不會加尾逗號：
   ```javascript
   util.postURL(URL, JSON.stringify(payload));
   ```
2. 手動拿掉尾逗號 + 前面加 `// prettier-ignore` 註解防再加
3. Project 加 `.prettierrc`：`"trailingComma": "es5"`（會影響全專案 style，不推薦只為 Ragic 改）

**只影響 Post workflow / Pre workflow / Global workflow 這種存 textarea 的多行 JS**。Action button 已經是單行、無此問題。

---

## 1. 標準模板：Ragic Post Workflow → 我方 backend endpoint

### 1.1 完整版（TB-P71 維修保養單-中部 → notify/maintenance-report）

**用途**：Post workflow — 記錄儲存後把 8 欄資料 POST 到 backend、backend 組訊息推 LINE 群

```javascript
// ===== Ragic Post Workflow · TB-P71 維修保養單-中部 → LINE 通知 =====
// Sheet：/service-tickets/10（aitode）
// 觸發：記錄儲存後（Post workflow）
// Backend：POST /notify/ragic/maintenance-report
// 對應設計文件：docs/modules/notify.md v0.2

var BACKEND_URL = "https://ai-center-line.onrender.com";
var GLOBAL_NOTIFY_SECRET = "<這裡改：貼 server/.env 內 NOTIFY_WEBHOOK_SECRET 的值>";

var payload = {
  trigger: "save",
  sheetPath: "/service-tickets/10",
  recordId: record.getId(),
  record: {
    "維修保養單號": record.getFieldValue(1031954),
    "客戶全稱":     record.getFieldValue(1031957),
    "聯絡人":       record.getFieldValue(1031974),
    "聯絡電話":     record.getFieldValue(1031975),
    "車型":         record.getFieldValue(1031980),
    "車牌號碼":     record.getFieldValue(1031978),
    "維修保養狀況": record.getFieldValue(1031986),
    "客戶詳細地址": record.getFieldValue(1032005)
  }
};

util.setHeader("Content-Type", "application/json");
util.setHeader("X-Notify-Secret", GLOBAL_NOTIFY_SECRET);

try {
  var res = util.postURL(BACKEND_URL + "/notify/ragic/maintenance-report",
                         JSON.stringify(payload));
  log.info("[notify] " + res);
} catch (e) {
  log.error("[notify] failed: " + e);
  // 不 setStatus("ERROR")：LINE 失敗不擋使用者存檔（見設計文件 §7-bis.3）
}
```

**恰好 26 行**（不含開頭註解）。貼完檢查行數，超過表示又貼了重複。

### 1.2 動作按鈕版（同 sheet · 手動觸發）

**用途**：修改設計 → 動作按鈕 → 新增類型「JS Workflow」→ 貼此段

跟 1.1 幾乎一樣，只差 `trigger: "button"`：

```javascript
var BACKEND_URL = "https://ai-center-line.onrender.com";
var GLOBAL_NOTIFY_SECRET = "<這裡改：貼 server/.env 內 NOTIFY_WEBHOOK_SECRET 的值>";

var payload = {
  trigger: "button",   // ← 跟 1.1 唯一差別
  sheetPath: "/service-tickets/10",
  recordId: record.getId(),
  record: {
    "維修保養單號": record.getFieldValue(1031954),
    "客戶全稱":     record.getFieldValue(1031957),
    "聯絡人":       record.getFieldValue(1031974),
    "聯絡電話":     record.getFieldValue(1031975),
    "車型":         record.getFieldValue(1031980),
    "車牌號碼":     record.getFieldValue(1031978),
    "維修保養狀況": record.getFieldValue(1031986),
    "客戶詳細地址": record.getFieldValue(1032005)
  }
};

util.setHeader("Content-Type", "application/json");
util.setHeader("X-Notify-Secret", GLOBAL_NOTIFY_SECRET);

try {
  var res = util.postURL(BACKEND_URL + "/notify/ragic/maintenance-report",
                         JSON.stringify(payload));
  log.info("[notify] " + res);
} catch (e) {
  log.error("[notify] failed: " + e);
}
```

---

## 2. 換 sheet 複製模板：3 個地方要改

要把上面模板套到別的 sheet（例：TB-P01 分析表 / 訂購憑單），改**恰好 3 個位置**：

### 2.1 sheetPath — sheet 的 URL 路徑

```javascript
sheetPath: "/order-operation/11",   // ← TB-P01 分析表為例
```

Sheet URL 通常長這樣：`ap16.ragic.com/aitode/order-operation/11` → `sheetPath = "/order-operation/11"`

### 2.2 backend endpoint — 對應的通知端點

```javascript
"/notify/ragic/maintenance-report"
   ↓
"/notify/ragic/analysis-sheet"   // ← 對應 backend 新加的 controller route
```

**backend 側要新增對應的 controller + composer**，見 §5「backend 複製 SOP」。

### 2.3 欄位對照表 — 8 個 field ID + JSON key 名

```javascript
record: {
  "客戶全稱":   record.getFieldValue(<新 field ID>),
  "狀態":       record.getFieldValue(<新 field ID>),
  "訂購單日期": record.getFieldValue(<新 field ID>),
  "分析表編號": record.getFieldValue(<新 field ID>),
  // ... 依 backend DTO 期望的 key 對應
}
```

**field ID 怎麼抓**：進 sheet 修改設計 → 逐一點欄位 → 左邊面板最上方**灰色小字**顯示 `欄位ID: XXXXXXX`（7 位數）。

或如果本專案有跑過 `scripts/ragic-api-import.ts` Discovery，直接查：
```bash
jq '."/order-operation/11".map' .ragic-export/_field-id-map.json
```

---

## 3. Ragic Workflow API 快速參考（本模板用到的）

### 3.1 三種 workflow scope 的 context 差異（重要！）

Ragic 三種 workflow 執行時 **有不同的全域變數**，用錯 scope 就會 `X is not defined`（**實測 2026-07-07 · 完全沒 `record` 全域**）：

| 全域 | Pre workflow | Post workflow | Action Button |
|---|:---:|:---:|:---:|
| `param` — 傳入參數物件（含 recordId / entry） | ✅ | ✅ | ❌ |
| `__actionButtonExecuteNodeId` — 當前記錄 ID | ❌ | ❌ | ✅ |
| `db` / `util` / `log` / `response` / `user` / `account` / `mailer` / `approval` | ✅ | ✅ | ✅ |
| ~~`record`~~ | ❌ **不存在** | ❌ **不存在** | ❌ **不存在** |

**Post/Pre workflow 內取「當下記錄」的正解（用 `param`）**：

```javascript
var entry = param.getUpdatedEntry();    // 剛儲存的 entry 物件
var recordId = param.getRootNodeId();   // 該記錄的 ragicId（新記錄回 -1）
var value = entry.getFieldValue(1031986);
```

**Action Button 內取「當下記錄」的正解**：

```javascript
var rid = __actionButtonExecuteNodeId;
var entry = db.getAPIQuery("/service-tickets/10").getAPIEntry(rid);
var value = entry.getFieldValue(1031986);
```

**踩坑重點**：Ragic 官方 doc 有些範例會用 `record` — **實測 Ragic Cloud 2026-07 版本沒這個全域**，一律走 `param.getUpdatedEntry()` 或 `__actionButtonExecuteNodeId + db.getAPIQuery`。

### 3.2 常用 API

| API | 說明 | 範例 |
|---|---|---|
| `param.getUpdatedEntry()` | Post/Pre workflow：剛儲存的 entry 物件 | `var entry = param.getUpdatedEntry()` |
| `param.getRootNodeId()` | Post/Pre workflow：當前記錄 ragicId（新記錄回 `-1`）| `var rid = param.getRootNodeId()` |
| `__actionButtonExecuteNodeId` | Action Button 專屬：當前記錄 ID | `var rid = __actionButtonExecuteNodeId` |
| `db.getAPIQuery(sheetPath)` | 拿 API query 物件（跨表 / Action Button 讀當下記錄）· **必填 sheet path 字串**，不可空手 | `db.getAPIQuery("/service-tickets/10")` |
| `query.getAPIEntry(recordId)` | 從 query 拉單筆記錄物件 | `query.getAPIEntry(rid)` |
| `entry.getFieldValue(fieldId)` | 讀 entry 某欄 | `entry.getFieldValue(1031986)` → `"冷氣不冷"` |
| `entry.setFieldValue(fieldId, value)` | 改 entry 某欄（配合 `entry.save()`）| `entry.setFieldValue(1031986, "已排程")` |
| `entry.save()` | 儲存改動 | `entry.save()` |
| `util.setHeader(name, value)` | 設 HTTP request header | `util.setHeader("Content-Type", "application/json")` |
| `util.postURL(url, body)` | POST HTTP request（body 為字串）| `util.postURL("https://...", JSON.stringify({...}))` |
| `util.getURL(url)` | GET HTTP request | `util.getURL("https://...")` |
| `log.info(msg)` / `log.error(msg)` | 寫執行 log（Ragic「歷史紀錄 → Workflow 記錄」看得到）| `log.info("[notify] sent")` |
| `response.setStatus("ERROR")` | Pre workflow 中擋掉存檔 | **本模板刻意不用**（LINE 失敗不擋存檔）|

---

## 4. 延伸模板：Pre Workflow 讀跨表主檔補值

**用途**：儲存前，用 `客戶編號` 從共用資料表拉出「客戶全稱 / 地址 / 聯絡人」自動填進當前記錄。避免業助手動 key 錯客戶名。

**注意**：跨表查詢 API 依 Ragic 版本可能不同，請以你 Ragic 的官方 doc 為準，此為典型寫法：

```javascript
// Pre Workflow · 儲存前自動補客戶主檔欄位
var customerCode = record.getFieldValue(<客戶編號 field ID>);
if (customerCode) {
  var query = db.getAPIQuery("/shared-data/11");   // 共用資料/客戶資料設定
  query.addFilter(<客戶編號 field ID in 客戶資料設定>, "eq", customerCode);
  var results = query.getAPIResultList();
  if (results && results.length > 0) {
    var customer = results[0];
    record.setFieldValue(<客戶全稱 field ID>, customer.getFieldValue(<客戶全稱 field ID in 主檔>));
    record.setFieldValue(<聯絡電話 field ID>, customer.getFieldValue(<聯絡電話 field ID in 主檔>));
    // ... 依需求續補
  } else {
    log.warn("[pre] 找不到客戶 " + customerCode);
  }
}
```

---

## 5. Backend 端配對複製 SOP（新 sheet 對應新 endpoint）

當你要把 workflow 複製到新 sheet，backend 也要對應加 endpoint + composer。以 TB-P01 分析表為例：

### 5.1 新 DTO — `server/src/notify/dto/ragic-analysis-sheet.dto.ts`

```typescript
import { z } from "zod";
const strField = z.string().trim().max(500);

export const RagicAnalysisSheetSchema = z.object({
  trigger: z.enum(["save", "button"]),
  sheetPath: z.string().regex(/^\/[a-z0-9-]+\/\d+$/),
  recordId: z.number().int().positive().max(1e12),
  record: z.object({
    分析表編號: strField,
    客戶全稱: strField,
    狀態: strField,
    訂購單編號: strField,
    訂購單日期: strField,
    預交日期: strField,
    聯絡地址: strField,
  }),
});
export type AnalysisRecord = z.infer<typeof RagicAnalysisSheetSchema>["record"];
```

### 5.2 新 composer — `server/src/notify/compose/compose-analysis-sheet.ts`

```typescript
import type { AnalysisRecord } from "../dto/ragic-analysis-sheet.dto.js";

function sanitize(v: string | undefined | null): string {
  if (v == null) return "";
  return String(v).replace(/[\r\n\t]+/g, " ").slice(0, 200).trim();
}

export function composeAnalysisSheetMessage(
  rec: AnalysisRecord,
  trigger: "save" | "button",
): string {
  const label = trigger === "save" ? "已更新" : "手動發送";
  return [
    `【分析表通知 · ${label}】`,
    `分析表：${sanitize(rec.分析表編號) || "（未填）"}`,
    `客戶：${sanitize(rec.客戶全稱) || "（未填）"}`,
    `狀態：${sanitize(rec.狀態) || "（未填）"}`,
    `訂購單：${sanitize(rec.訂購單編號)}（${sanitize(rec.訂購單日期)}）`,
    `預交日期：${sanitize(rec.預交日期) || "（未填）"}`,
    `地址：${sanitize(rec.聯絡地址) || "（未填）"}`,
  ].join("\n");
}
```

### 5.3 controller 加 route — `server/src/notify/notify.controller.ts`

```typescript
@Post("analysis-sheet")
@Public()
@UseGuards(WebhookSecretGuard)
@HttpCode(200)
async analysisSheet(@Body() body: unknown): Promise<HandleResult> {
  const parsed = RagicAnalysisSheetSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException({
    status: "invalid_body",
    errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
  return this.svc.handleAnalysisSheet(parsed.data);  // 新增 service 方法
}
```

### 5.4 service 加 handler

跟 `handleMaintenanceReport` 幾乎一樣，只是換 composer：
```typescript
async handleAnalysisSheet(payload: RagicAnalysisSheetPayload): Promise<HandleResult> {
  // 同 handleMaintenanceReport 結構，只把 composeMaintenanceReportMessage 改成 composeAnalysisSheetMessage
}
```

### 5.5 tests + docs 補齊

每個新 composer / DTO / handler 都要新增 unit tests（至少 3 個 snapshot + edge case），跟現有 `notify.compose.test.ts` 同格式。

---

## 6. Ragic 版本相容性快速表

不同 Ragic 部署可能 API 略有差異：

| API | Ragic Cloud（本專案 aitode）| 舊版 self-hosted |
|---|---|---|
| 當前記錄物件 | `record` | 有的版是 `entry` |
| 讀欄位 | `record.getFieldValue(1234567)` | `entry.getFieldValue(1234567)` |
| 跨表查詢 | `db.getAPIQuery("/tab/sheet")` | `queryEntries("/tab/sheet")` |
| HTTP POST | `util.postURL(url, body)` | `httpAPI.post(url, body)` |
| Log | `log.info()` / `log.error()` | `console.log()` |

**找不到某 API 就先跳過 log 一行嘗試**（例：`typeof util !== "undefined"` 檢查）→ 看 Ragic Workflow 記錄的錯誤，通常會提示 API 正確名稱。

---

## 附錄：變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-07 | v1.0 | 初版：TB-P71 中部 Post workflow + button + 換 sheet SOP + Ragic API 快速參考 + 相容性表 | Claude Code |
