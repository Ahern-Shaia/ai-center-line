# extraction-schema-service-order · 抽取 schema 改為服務工單格式

> 狀態：🚧 **M0 DRAFT v0.1**（2026-07-27）· 待用戶裁定 OQ-ESO-1..10
>
> 相關：[`conversation-analysis-pilot.md`](conversation-analysis-pilot.md)（抽取管線）、[`warroom-task-board.md`](warroom-task-board.md)（下游材料化）、[`../customer/台灣福祉_群組分析能做什麼.md`](../customer/台灣福祉_群組分析能做什麼.md)（本文的證據來源）
>
> ⚠️ **這是資料契約變更**。`src/schemas.ts` 改動＝破壞性修改（R1／R12），本文含遷移計畫與回歸要求。
>
> ⚠️ **動手前必須先取得客戶的欄位確認**（OQ-ESO-1）。我方不猜。

---

## 0. 觸發 · 用真實資料量出來的落差

2026-07-27 查台灣福祉正式環境（2026-07-22～27，6 天，唯讀）：

| 指標 | 數字 | 說明 |
|---|---|---|
| 結構化紀錄總數 | 60 筆 | — |
| 其中 `daily_report` 類 | **2 筆**，且信心度皆 medium | **實質為 0** |
| `person`（對口）填充率 | **72%**（43/60） | 抽人很準 |
| `status`（狀態）填充率 | 100% | — |
| **`machine_code`（機台）填充率** | **7%**（4/60） | ⚠️ |
| **`work_order`（工單）填充率** | **8%**（5/60） | ⚠️ |

**不是系統壞了，是 schema 對不上業務型態。**

### 0.1 現行 schema 是為工廠報工設計的

`src/schemas.ts` 的 `daily_reports`：

```
date / reporter_name / reporter_code / line（線別）/ machine_code（機台）
/ work_order（工單）/ output_qty（產出）/ defect_qty（不良）
/ work_hours（工時）/ overtime_hours（加班）/ issues
```

### 0.2 台灣福祉實際的日報長這樣（真實訊息）

```
今日工作內容回報

台中智障者協會（2 區）
一台更換後鏡頭（3,500）
更換行車記錄器硬碟（6,300）
一台更換蜂鳴器（750），小擋板螺絲重新固定
```

```
今日進度回報

高雄宜萃日照
旅玩家查修一台
 *尾門內飾板拆下
 *鋁板變形處復原
 *塑膠邊條脫落，上膠加強固定
 *業主不接受修復現況（待討論）

台南永康志⋯
```

**結構是「客戶／案場 → 車輛 → 施作項目（含金額）→ 狀態」，一則訊息含多個客戶、每個客戶含多個項目。**

這是**服務工單／派工回報**，不是產線報工。兩者沒有共用欄位——所以現行 schema 抽不到，是**設計與現實不匹配**，不是模型能力問題。

---

## 1. 目標與非目標

### 1.1 目標

1. 讓「今日工作內容回報／今日進度回報」這一類訊息能被結構化，且欄位貼合實際
2. 保留現行**已經抽得很好**的部分（`records` 的 person/status/title/detail 準確率佳，不動）
3. 遷移成本降到最低（舊資料只有 2 筆，現在是最好的時機）

### 1.2 非目標

- ❌ 不改 `records`（採購／維保／研發／出勤／閒聊）——那部分實測準確且有用
- ❌ 不做金額加總、業績統計——那是 [`business-query-assistant`](business-query-assistant.md) 的範圍
- ❌ 不做讀圖（20.6% 的訊息是圖片，是另一件事，見 OQ-ESO-9）
- ❌ 不回寫 Ragic

---

## 2. ⚠️ 前置 Gate · 欄位必須由客戶定

**我方不猜欄位。** 猜錯的代價是整套再做一次（改 schema → 改 prompt → 回歸驗證 → 前端顯示 → 已抽的資料再遷移）。

**取得方式**（已寫進業務用文件 §E）：拿他們**現有的真實訊息**去問「這則如果要變成表格，您要哪幾欄？」，比抽象問需求有效得多。

**我方提案（供客戶增刪，不是定案）**：

| 欄位 | 說明 | 從上面真實訊息看得到嗎 |
|---|---|---|
| `customer` | 客戶／案場名稱 | ✅ 台中智障者協會、高雄宜萃日照 |
| `site` | 站點／區域 | ✅ （2 區）、民雄站 |
| `vehicle` | 車型／車號 | ✅ 旅玩家、得利卡 |
| `items[]` | 施作項目陣列 | ✅ 更換後鏡頭、更換硬碟 |
| `items[].name` | 項目名稱 | ✅ |
| `items[].amount` | 金額 | ✅ 3,500／6,300／750 |
| `items[].qty` | 台數／數量 | ✅ 一台 |
| `status` | 完成／待料／待討論／待安裝 | ✅ 待領料安裝、業主不接受（待討論） |
| `issues` | 問題與待議事項 | ✅ 業主不接受修復現況 |
| `reporter` | 回報人 | ✅ 由發話者取得 |

> 一則訊息可能含**多個客戶**，每個客戶含**多個項目** → schema 需支援「一則訊息 → 多筆工單」。

---

## 3. 設計

### 3.1 新增 `service_reports`，不改 `daily_reports`

**不要改 `daily_reports` 的欄位定義**，而是**新增一個並存的類別**：

```
AnalysisResult
├─ classifications   （不動）
├─ daily_reports     （不動 · 工廠客戶仍可能用到）
├─ service_reports   ← 新增
└─ records           （不動）
```

**為什麼並存而不是取代**：

| 取代 | 並存 |
|---|---|
| 未來接到工廠型客戶要再改回來 | 兩種業務型態都支援 |
| 舊資料（2 筆）要遷移 | 舊資料原樣保留，零遷移 |
| 一次性決策，錯了要回滾 | 可以先讓兩者並行、看實測命中率再決定 |

**代價**：prompt 變長、模型要多判斷一次「這是產線報工還是服務工單」。實測 6 天的資料裡 `daily_report` 只有 2 筆，判斷壓力其實很小。

### 3.2 每租戶選用哪一種（避免 prompt 無謂變長）

`category_registry` 已是 per-tenant 設計。建議同樣做成**租戶層設定**：該租戶啟用哪些抽取類別。

台灣福祉 → 啟用 `service_reports`，關閉 `daily_reports`。工廠客戶反之。

> 承用戶鐵則（2026-07-24）：**有配置就要能前端操作**。這個開關放「AIPROOT 管理」。

### 3.3 schema 草案（待 §2 客戶確認後定稿）

```ts
service_reports: z.array(z.object({
  date: z.string().nullable(),
  reporter: z.string().nullable(),
  customer: z.string().nullable(),        // 客戶／案場
  site: z.string().nullable(),            // 站點／區域
  vehicle: z.string().nullable(),         // 車型／車號
  items: z.array(z.object({
    name: z.string(),
    qty: z.number().nullable(),
    amount: z.number().nullable(),        // ⚠️ 金額一律不臆測（R11）
  })),
  status: z.string().nullable(),
  issues: z.string().nullable(),
  source_ids: z.array(z.number()),        // R11 可溯源 · 必填
  confidence: Confidence,
}))
```

**R11 三條紀律沿用**：缺漏填 `null`、金額禁止臆測或換算、`source_ids` 必填可回溯。

---

## 4. 遷移計畫（R1）

| 項目 | 影響 | 處理 |
|---|---|---|
| `analysis_result.records` | 無 | 不動 |
| `analysis_result.daily_reports` | 無（欄位不變） | 原樣保留 |
| 新欄位 `service_reports` | jsonb 內新 key | **不需 migration**（`analysis_result` 是 jsonb，非固定欄位） |
| 已抽的 2 筆 daily_report | 保留 | 不回溯重抽（R11 原始不可變） |
| 前端 | 今日日誌／任務看板需能顯示新類別 | M3 |
| 材料化 → tickets | 需決定 service_report 要不要變成 ticket | OQ-ESO-5 |

**遷移風險極低**——這正是現在動手的理由。累積數百筆之後再改就不是這回事了。

---

## 5. 回歸要求（R12 · 不可省）

改 `src/schemas.ts` 或 system prompt 後**必須**：

1. 重跑 `samples/` 三個樣本檔（`npm run analyze`），確認：
   - 訊息分類覆蓋率仍 100%（console 無「未被分類」警告）
   - 報工群日報抽取 **8 筆**、實體對應（P-xxx / M-xxx / WO-xxx）正確 ← **這是既有基準，新增類別不可讓它下降**
   - prompt caching 仍生效（第 2 次呼叫起 `cache讀 > 0`）
2. 用**台灣福祉的真實訊息**建一組新樣本（去識別化後入 `samples/`），作為 service_reports 的回歸基準

> ⚠️ `samples/` 是回歸基準，**新增不可改動既有三檔**（CLAUDE.md §5.3）。

---

## 6. 失效場景反思（FMEA · R17）

| # | 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|---|
| F-1 | 欄位定義 | 我方自己猜欄位、客戶不認 | **整套重做**（schema→prompt→回歸→前端→資料） | **P0** | §2 Gate：欄位由客戶定，拿真實訊息去對 |
| F-2 | 金額 | 模型把「3,500」誤讀或自行加總 | **報錯金額給主管看** | **P0** | R11 禁止臆測與換算；金額只抄不算；`source_ids` 可回查原文 |
| F-3 | 回歸 | 新增類別導致原本 8 筆日報抽取下降 | 既有客戶能力退化 | **P0** | §5 R12 回歸；新舊樣本都要過 |
| F-4 | 多客戶訊息 | 一則含 3 個客戶被抽成 1 筆 | 資料合併、無法追蹤 | P1 | schema 設計為陣列；樣本要含多客戶案例 |
| F-5 | 型態誤判 | 服務工單被抽成 daily_report（或反之） | 欄位錯位、大量 null | P1 | §3.2 per-tenant 只啟用一種，從源頭消除誤判 |
| F-6 | prompt 膨脹 | 兩套 schema 並存使 prompt 變長、成本上升 | token 成本 | P2 | §3.2 per-tenant 啟用；system prompt 仍走 caching |
| F-7 | 下游 | tickets 材料化未處理新類別 | 抽到了但看板沒東西 | P1 | OQ-ESO-5 先裁定；M3 一起做 |
| F-8 | 期待落差 | 客戶以為改完就能算業績 | 期待管理 | P1 | 業務用文件已寫明「不能問答／算數字」是另一件事 |

**P0 共 3 條**，核心都是「不要在沒確認的情況下動資料契約」。

---

## 7. 開放問題（OQ-ESO-N）

| # | 問題 | 建議 |
|---|---|---|
| **OQ-ESO-1** | ⚠️ **必問客戶**：日報要留哪些欄位？ | 拿 §0.2 的真實訊息去對，讓他們增刪 §2 的提案 |
| **OQ-ESO-2** | 新增 `service_reports` 並存，還是改 `daily_reports`？ | **並存**（§3.1）· 零遷移、兩種業務型態都支援 |
| **OQ-ESO-3** | 抽取類別要不要做成 per-tenant 開關？ | **要**（§3.2）· 避免 prompt 無謂變長與型態誤判 |
| **OQ-ESO-4** | 金額要不要自動加總？ | **不要**。只抄不算（R11）· 加總屬 business-query-assistant |
| **OQ-ESO-5** | service_report 要不要材料化成 ticket？ | 傾向**要**（「待領料安裝」「待討論」本來就是待辦），但需確認不會灌爆看板 |
| **OQ-ESO-6** | 一則訊息含多客戶 → 拆成多筆還是一筆多客戶？ | **拆成多筆**（一客戶一筆工單），較符合追蹤與簽核 |
| **OQ-ESO-7** | 要不要把台灣福祉真實訊息去識別化後放進 `samples/`？ | **要** · 沒有真實基準就無法回歸驗證新類別 |
| **OQ-ESO-8** | 舊的 2 筆 daily_report 要不要重抽？ | **不要** · R11 原始不可變；量太小不值得 |
| **OQ-ESO-9** | 圖片（20.6%）要不要一併處理？ | **不要** · 獨立議題、成本另計，本模組不擴張 |
| **OQ-ESO-10** | 這模組屬本專案還是 EEA/SAM？ | 本專案（緊貼既有抽取管線）· 但與 OQ-BQA-2 / OQ-TPR-11 同一類問題 |

---

## 8. 里程碑

| 里程碑 | 內容 |
|---|---|
| **M0** | 本文件 + **客戶欄位確認**（OQ-ESO-1）+ OQ 裁定 ← 目前在這 |
| **M1** | `schemas.ts` 新增 `service_reports` + system prompt 調整 + per-tenant 類別開關 |
| **M2** | 真實訊息去識別化入 `samples/` + R12 回歸（新舊都要過） |
| **M3** | 前端顯示（今日日誌／任務看板）+ 材料化規則（依 OQ-ESO-5） |
| **M4** | 台灣福祉實跑一週、量測命中率與欄位填充率，對照本文 §0 的基準數字 |
| **M5** | FMEA 覆核 + 上線 |

**M4 的量測是這個模組的驗收標準**：`service_reports` 的產出量與欄位填充率，要明顯優於現行 `daily_report` 的「2 筆 / 機台 7% / 工單 8%」。

---

## 9. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-27 | v0.1 | M0 首版 · 以正式環境 6 天真實資料量出落差（daily_report 實質 0 筆、機台 7%、工單 8%）· 主張新增 `service_reports` 並存而非改既有 · per-tenant 類別開關 · 欄位由客戶定不由我方猜 · FMEA 8 條含 3 個 P0 · OQ-ESO-1..10 | ahern + Claude Code |
