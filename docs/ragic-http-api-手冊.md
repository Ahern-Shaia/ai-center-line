# Ragic HTTP API 手冊（離線查閱）

> 本專案後續會頻繁使用 Ragic，這份是官方 HTTP API 文件的整理版，供離線查閱、免每次上網查。
> 來源：<https://www.ragic.com/intl/zh-TW/doc-http-api>（擷取整理於 2026-07-25 · 對應 API v3 / `version=2025-01-01`）
> 相關：本專案 [`docs/modules/notify.md`](modules/notify.md) / [`notify-multi-tenant.md`](modules/notify-multi-tenant.md) 寫入 Ragic；踩坑見 memory `pitfall_ragic_workflow_gotchas` / `pitfall_ragic_post_workflow_relogin`。

## 能力邊界（先看這段）

- ✅ **可做**：對**已存在的表單**做記錄 CRUD、檔案上傳、留言、簽核、執行 Action Button、批次操作、匯出 PDF/Excel、**讀取表單 schema（欄位定義）**。
- ❌ **不可做**：用 API **建立新表單 / 定義欄位 / 改 schema**。建表單只能在**網頁 UI**（設計模式 / 複製 application 當範本 / Excel 匯入）。
- ⚠️ 舊版曾完全不給 metadata；**新版（v3）已有唯讀的 `metadata/schema`、`metadata/actionButton`**（見 §14 / §8）——但仍是「讀」不是「建」。

---

## 1. 認證

API Key 於「個人設定」產生。

**HTTP Basic Auth（推薦）** — API 金鑰當帳號、免密碼：
```
-H "Authorization:Basic YOUR_API_KEY"
```

**URL Query 方式**：
```
-d "APIKey=YOUR_API_KEY"
```

**Session 登入（備用）**：
```bash
curl --get -d "u=jeff@ragic.com" --data-urlencode "p=123456" \
  -d "login_type=sessionId" -d "json=1" -c cookie.txt \
  https://www.ragic.com/AUTH
# 取得 sid 後，後續請求加 ?sid=SESSION_ID
```

---

## 2. URL 結構

```
https://{server}/{apname}{path}/{sheetIndex}[/{recordId}][.{format}]?api
```
- `{server}`：`www`（預設）/ `na3`（北美）/ `ap5`（亞太）/ `eu2`（歐洲）
- `{apname}`：帳號名稱（如 `demo`）
- `{path}`：資料夾路徑（如 `/sales`）
- `{sheetIndex}`：表單編號（如 `1`）
- `{recordId}`：單筆資料 ID（編輯/查看單筆時）
- `.{format}`：`.xhtml` / `.pdf` / `.xlsx` / `.custom` / `.carbone`
- `?api`：**必要**，指定為 API 請求

範例：
```
列表：https://www.ragic.com/demo/sales/1?api
單筆：https://www.ragic.com/demo/sales/1/41?api
PDF ：https://www.ragic.com/demo/sales/1/41.pdf
```

API 版本：`?v=3&api`（舊，v=1/2/3）或 `?version=2025-01-01&api`（新，推薦）。未指定則用最新版。

---

## 3. 讀取（GET）

回傳 JSON，key = record ID：
```json
{
  "12345": {
    "_ragicId": 12345,
    "_star": false,
    "1000001": "Acme Corp",
    "1000002": "2024-01-15",
    "_index_title_": "Acme Corp"
  }
}
```

### 常用查詢參數

| 參數 | 說明 | 範例 |
|---|---|---|
| `where` | 篩選條件 | `where=2000123,eq,Alphabet Inc.` |
| `limit` | 回傳筆數上限 | `limit=50` |
| `offset` | 跳過筆數 | `offset=10` |
| `order` | 排序 | `order=800236,DESC` |
| `reverse` | 反轉排序 | `reverse=true` |
| `fts` | 全文搜尋 | `fts=Alphabet` |
| `filterId` | 套用已存篩選 | `filterId=...` |
| `naming` | 欄位命名 | `naming=EID`（欄位ID）/ `naming=FNAME`（欄位名）· **⚠️ 預設是欄位名，不是 ID**——要用 `metadata/schema` 給的 fieldId 當 key 取值，**一定要明寫 `naming=EID`**（本專案 2026-07-27 踩過：通知訊息每個欄位都「（未填）」）|
| `subtables` | 是否含子表 | `subtables=0` |
| `listing` | 僅列表頁欄位 | `listing=true` |
| `fetchDomainIds` | 指定欄位 | `fetchDomainIds=1000231&fetchDomainIds=1000243` |
| `info` | 含建立資訊 | `info=true` |
| `conversation` / `comment` / `approval` / `history` | 含信件/回應/簽核/修改紀錄 | `=true` |
| `ignoreMask` | 不遮罩欄位值 | `ignoreMask=true` |
| `ignoreFixedFilter` | 忽略固定篩選 | `ignoreFixedFilter=true` |
| `callback` | JSONP 回呼 | `callback=fn` |

### where 語法
```
where=<fieldId>,<operator>,<value>
```
運算子：`eq`（等於）、`regex`、`gte` / `lte` / `gt` / `lt`、`like`（包含）、`eqeq`（依內部資料 ID 精確比對）。

規則：
- 日期值：`yyyy/MM/dd` 或 `yyyy/MM/dd HH:mm:ss`
- 空值篩選：`where=2000127,eq,`（值留空）
- 同欄位多個 `eq`/`regex`/`like` = **OR**；`gte`+`lte` 同欄位 = **AND**（日期區間）
- 值含逗號 → 編碼 `%2C`；含 `%` 後接十六進制 → 雙重編碼（`%2525`）

### 系統欄位 ID
| 欄位 | ID |
|---|---|
| 建立日期 | 105 |
| 資料管理者 | 106 |
| 建立使用者 | 108 |
| 最後更新日期 | 109 |
| 通知使用者 | 110 |
| 是否上鎖 | 111 |
| 是否打星號 | 112 |

範例：
```bash
curl --get -d "where=2000123,eq,Alphabet Inc." -d "limit=50" -d "offset=0" -d api \
  -H "Authorization:Basic YOUR_API_KEY" https://www.ragic.com/demo/sales/1
```

---

## 4. 新增（POST）

```
POST https://www.ragic.com/{apname}{path}/{sheetIndex}?api
```

**JSON（推薦）**：
```json
{ "2000123": "Dunder Mifflin", "2000125": "1-267-922-5599", "2000127": "Jeff Kuo" }
```
**Form Data**：`-F "2000123=Dunder Mifflin" -F "api="`

特殊欄位：
- **日期**：`"2000133": "2018/12/25 23:30:00"` 或 `"2018/12/25"`
- **多選**：`{ "1000001": ["Customer", "Reseller"] }`（Form Data 則重複帶同名）
- **子表**（同列用同一負數 row id）：
```json
{
  "2000123": "Dunder Mifflin",
  "_subtable_2000154": {
    "-1": { "2000147": "Bill", "2000148": "Manager" },
    "-2": { "2000147": "Satya", "2000148": "VP" }
  }
}
```
Form Data 子表：`-F "2000147_-1=Bill" -F "2000148_-1=Manager"`

### 建立/更新可選參數
| 參數 | 說明 |
|---|---|
| `doFormula=true` | 重新計算公式 |
| `doDefaultValue=true` | 載入預設值 |
| `doLinkLoad=true` / `first` | 重算公式並連結載入 / 先連結載入再算公式 |
| `doWorkflow=false` | 跳過 Workflow |
| `notification=true` | 發送通知（預設 true）|
| `doValidation=true` | 執行欄位驗證 |
| `checkLock=true` | 檢查是否被鎖定 |

---

## 5. 修改（POST/PUT/PATCH 到 recordId）

```
POST https://www.ragic.com/{apname}{path}/{sheetIndex}/{recordId}?api
```
主表：`-F "2000123=Dunder Mifflin"`
子表（先 GET 取得子表列 id，再 `{fieldId}_{rowId}`）：`-F "2000147_1=Ms. Amy Tsai"`
刪子表列：`-F "DELSUB_2000154=3"` 或 JSON `{ "_DELSUB_2000154": [3,4,5] }`

## 6. 刪除（DELETE）
```bash
curl -X DELETE -d "api" -H "Authorization:Basic YOUR_API_KEY" \
  https://www.ragic.com/demo/sales/1/3
```

---

## 7. 檔案/圖片

上傳（欄位 id 綁檔）：
```bash
curl -F "1000088=@/path/file" -F "api=" -H "Authorization:Basic YOUR_API_KEY" \
  https://www.ragic.com/demo/sales/1
# 回：{ "1000088": "Ni92W2luv@test.jpg" }
```
下載：`https://www.ragic.com/sims/file.jsp?a=<帳號>&f=<檔名>`
從網址上傳：先 `curl -o __TEMP__ <link>`，再 `-F "1000002=@__TEMP__"`。
留言含附件：`-F "c=留言內容"（必填） -F "at=@/path"（附件·選填）` POST 到單筆。

---

## 8. Action Button
1. 取按鈕 id：`GET .../{sheetIndex}/metadata/actionButton?api&category=massOperation` → `{ "actionButtons":[{"id":123,"name":"..."}] }`
2. 執行：`POST .../{sheetIndex}/{recordId}?api&bId=123` → `{ "status":"SUCCESS","msg":"..." }`

---

## 9. 批次操作（非同步 · 回 taskId）
```
POST .../{sheetIndex}/massOperation/<type>?api
```
指定資料：`?api&where=<f>,<op>,<v>` 或 `?api&recordId=1&recordId=2`。type / body：
- `massLock`：`{"action":"lock"}` / `"unlock"`
- `massApproval`：`{"action":"approve","comment":"..."}` /（`reject`）
- `massActionButton`：`{"buttonId":123}`
- `massUpdate`：`{"action":[{"field":2000123,"value":"New"}]}`（群組欄位 value 用 JSON 字串 `"[\"SYSAdmin\"]"`）
- `massSearchReplace`：`{"action":[{"field":2000123,"valueReplaced":"Old","valueNew":"New"}]}`

追蹤進度：`GET https://www.ragic.com/{apname}?api&taskId=<uuid>` → `status: PROCESSING/...`

---

## 10. 單筆簽核
1. GET 單筆取 `wfId`（回應含 `"wfId":"WF12"` + 下一位簽核人）
2. 簽：`POST .../{recordId}?api&approval&act=sign`（`Content-Type: application/x-www-form-urlencoded`）body：`wfId=WF12`、`sign=A`（同意）/`REJ`（拒絕）、`comment=...`
   - 要求簽名時 `dig_sig`=Base64 簽名圖（data URL）；嚴格驗證時 `pwd` 需放 body 不放 query。

---

## 11. 其他寫入
- **匯入 API**（需管理員 + 已設「定期從網址匯入」）：`-F "importData=" -F "api="` POST。
- **上鎖/解鎖**：`POST .../{recordId}?api&lock` / `?api&unlock`。

## 12. 匯出/列印
- `.xhtml`（列印版）/ `.pdf` / `.xlsx`（單筆或列表）。
- 合併列印：`.custom?cid=1`；列表頁：`.custom?cid=1&listingMode=true&start=1&end=10`（每帳號同時 1 個，過頻 429）。
- 客製報表：`.carbone?fileFormat=pdf&ragicCustomPrintTemplateId=1&fileNameRefDomainId=1001000`（fileFormat：pdf/png/docx）。

---

## 13. 讀取表單 Schema（唯讀 · 僅帳號管理者）
```bash
curl "https://www.ragic.com/{apname}{path}/{sheetIndex}/metadata/schema?api" \
  -H "Authorization: Basic YOUR_API_KEY"
```
回：`sheet`（sheetPath/sheetIndex/sheetName/keyFieldId）+ `fields[]`（fieldId/fieldName/type/required/readOnly/computed/hidden）+ `subtables[]`。
> ⚠️ 只能「讀」欄位定義；**不能用 API 建表/加欄位/改 schema**（見開頭「能力邊界」）。

---

## 14. Webhook
設定：表單 → 三角下拉 → 工具 → 同步 → Webhook。
- 精簡回應：`[1,2,4]`（變更的資料 id）
- 完整回應：`{ "data":[{...}], "apname":"...", "path":"/sales", "sheetIndex":1, "eventType":"CREATE" }`
- eventType：`CREATE` / `UPDATE` / `DELETE`
- **簽章驗證**：取 `data` 序列化為「**key 排序、無縮排、無換行**」的 JSON 當 string-to-sign；用請求的 `signature` + 公鑰（`getWebhookSignaturePublicKey.jsp?type=string|pem`）以 **SHA256withRSA** 驗。

---

## 15. 狀態碼 / 錯誤

HTTP：200 OK · 400 缺參數 · 401 金鑰無效 · 402 參數有效但請求失敗 · 404 資源不存在 · 429 過頻 · 5xx 伺服器錯誤。

錯誤格式：`{ "status":"ERROR", "code":303, "msg":"..." }`

常見 code：101 帳號名無效 · 102 路徑無效 · 103 表單索引無效 · 105 需驗證 · 106 無權限 · 201 參數處理錯 · 202 執行錯 · 204 過頻 · 301 session 超時 · 303 帳號過期 · 304 金鑰無效 · 402 資料已鎖定 · 404 找不到資料。

## 16. 限制 / 踩坑
- **必須 HTTPS**，純 HTTP 會失敗。
- 無硬性呼叫上限；每帳號最多排隊 50 請求；**> 5 req/s 觸發人工審核**。
- 預設回傳 **1000 筆**；預設排序＝建立時間由舊到新。
- 參數含 `%` / `&` → 用 `--data-urlencode` 不用 `-d`。
- 子表同列用同一負數 row id；刪子表列 `DELSUB_<subtableKey>=<rowId>`。
- 多選欄位改值 → JSON 陣列。
- 檔案上傳 content-type 需 `multipart/form-data`。
- 簽核請求 body 需 `application/x-www-form-urlencoded`。
- Webhook 驗簽：JSON 序列化必須 key 排序 + 無縮排無換行。
- **讀 record 的 key 預設是「欄位名稱」不是欄位 ID** → 要用欄位 ID 當 key 必須加 `naming=EID`。沒加的話：欄位沒命名時會回 `未命名` / `未命名2`（同名自動加序號），看起來有資料但用 fieldId 一個都取不到。

## 17. 查欄位 ID
- 設計模式 → 點欄位 → 左側工具列欄位名下方即欄位 ID。
- 或表單 → 三角 → Javascript 工作流程 → 看各欄位 ID。
