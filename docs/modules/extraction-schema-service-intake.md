# extraction-schema-service-intake · 客服報修派工單抽取（service_intake）

> 狀態：✅ **M0 定案 + M1 程式就緒**（2026-08-01）· OQ-ESI-1..7 全數裁定 · migration 0057 待人套 prod（R10）、未 push · **M2 真實樣本回歸前，判別準則尚未經實跑驗證**（見 §8 註）
> · 觸發＝查 [`extraction-schema-service-order.md`](extraction-schema-service-order.md) M1 一週填出率時，發現 **warranty 0% 的真因是報修單整個沒被抽**（§0）
>
> 相關：[`extraction-schema-service-order.md`](extraction-schema-service-order.md)（進度回報抽取／本文的姊妹區塊）、[`conversation-analysis-pilot.md`](conversation-analysis-pilot.md)（抽取管線）、[`task-completion-tracking.md`](task-completion-tracking.md)（報修單＝任務 intake 的天然來源）、[`warroom-task-board.md`](warroom-task-board.md)（下游材料化）
>
> ⚠️ **這是資料契約變更**（新增 `analysis_result.service_intake` 欄位 + 抽取 schema）＝破壞性修改（R1／R12）。本文含遷移計畫與回歸要求。
>
> 決策定調（2026-08-01 用戶裁定）：報修派工單**另立 `service_intake` 區塊**，不混進 `service_reports`（進度回報）—— 兩者是不同 lifecycle（派工 intake vs 施作進度），分開存資料最乾淨、可各自對回任務追蹤。

---

## 0. 觸發 · 用真實資料量出來的落差

2026-08-01 查台灣福祉正式環境（service_order 模板上線後 07-29～07-31，3 天，唯讀），
複核 [`extraction-schema-service-order.md`](extraction-schema-service-order.md) §3.4 新增的 `items[].warranty` 欄位填出率：

| 指標 | 數字 | 說明 |
|---|---|---|
| `service_reports` 記錄數 | 10 筆 | 進度回報，抽得不錯 |
| `items[].vehicle` 填出率 | 52% | v0.2 新增，值得保留 |
| `items[].status` 填出率 | 48% | v0.2 新增，值得保留 |
| **`items[].warranty` 填出率** | **0%** | ⚠️ 一筆都沒有 |

**追下去發現：warranty 0% 不是抽漏，是「帶 warranty 的訊息類型整個沒進抽取」。**

台灣福祉群組裡有**兩種**服務訊息，型態完全不同：

| | 進度回報（師傅寫） | 報修派工單（客服貼） |
|---|---|---|
| 範例開頭 | `今日進度回報` / `今日工作內容回報` | `客戶: X` / `聯絡人: X`（冒號標籤表單） |
| 結構 | 客戶 → 項目（自由文字） | 固定欄位表單 |
| 帶 `是否保固內`？ | 幾乎不提 | **有**（結構化欄位） |
| lifecycle 位置 | 施作中／已完成 | 派工前（intake，尚未施作） |
| 目前抽取 | ✅ 進 `service_reports` | ❌ **完全沒抽**（0 筆進任何區塊） |

真實報修單長這樣（07-31，已去識別化欄位值示意）：

```
客戶: 祝三
聯絡人: 黃先生
電話: 09xx-xxx-xxx
車種: VERYCA
車牌: RFB-3630
是否保固內: 否
地址: 板橋
狀況: 斜坡板放不下來
```

量體：07-30 有 1 張、07-31 有 5 張，**共 6 張報修單、100% 未被抽取**。
`是否保固內` 這個結構化欄位只存在報修單裡 —— 所以只要不抽報修單，warranty 填出率永遠 0%。

> ⭐ 教訓（延續父檔 §3.5 的紀律）：填出率 0% 有兩種可能——「抽漏」與「來源根本沒進抽取集」。
> 先分清是哪一種，才不會去修一個沒壞的 prompt。這次一開始誤判成前者（差點只改 warranty 用字），
> 去 prod 對客戶名（祝三／VERYCA 完全不在 `service_reports`）才確認是後者。

---

## 1. 目標與非目標

### 1.1 目標

1. 讓客服的**報修派工單**（冒號標籤表單）能被結構化，欄位貼合表單既有格式
2. **救起 warranty 填出率** —— `是否保固內: 是/否` 有明確、跨日期、結構化的訊號
3. 與 `service_reports`（進度回報）**分區並存**，不互相污染

### 1.2 非目標

- ❌ 不改 `service_reports`（進度回報）與 `records` —— 兩者實測有用，不動
- ❌ 不在本模組把報修單與後續進度回報**串成同一張工單**（lifecycle linking 屬 [`task-completion-tracking.md`](task-completion-tracking.md) #48，見 OQ-ESI-6）
- ❌ 不做金額加總／業績統計（屬 business-query-assistant）
- ❌ 不回寫 Ragic

---

## 2. 上游 / 既有現況走查

- `analysis_result` 目前的 jsonb 欄位：`messages` / `daily_reports` / `records` / `service_reports`（皆為離散欄位，非塞在同一包 jsonb）。→ 新增 `service_intake` 走**同一個 pattern**（新離散欄位）。
- `src/conversation-analysis/pipeline/templates.ts`：每個模板一個 `resultKey: string`（單一輸出區塊）。`factory_report` 例外——它一次同時吐 `daily_reports` ＋ `records`，但那是走 `records` 這條**固定路徑**、不是靠 `resultKey`。→ 要讓 `service_order` 模板**多吐一個 `service_intake` 區塊**，需把 `resultKey` 一般化成能吐第二區塊（§3.4）。
- 模板綁在**租戶**上、一租戶只有一個（台灣福祉＝`service_order`）；報修單與進度回報**混在同一群、同一批訊息**裡 → 只能在**同一次抽取**同時吐兩區塊，**不能另開模板**（另開模板＝同一批訊息要跑兩次、且租戶無法同時掛兩模板）。
- warranty 用字映射（`是否保固內:是/否`→保內/保外）目前暫寫在 `service_order` 的 rule 13（`templates.ts`，2026-08-01 已加、type-check 過、**未 push**）—— M1 時**遷到 `service_intake` 抽取規則**，那才是它的家。

---

## 3. 設計

### 3.1 新增並存區塊 `service_intake`，不動 `service_reports`

```
AnalysisResult
├─ classifications   （不動）
├─ daily_reports     （不動）
├─ records           （不動）
├─ service_reports   （不動 · 進度回報）
└─ service_intake    ← 新增 · 報修派工單
```

理由同父檔 §3.1「並存優於取代」：零遷移、兩型態各自乾淨、可先並行看命中率。

### 3.2 ⭐ 報修單 vs 進度回報的判別準則（這是 P0，misclassify 兩邊都爛）

判別訊號**很強**，靠結構就能分：

| 判給 `service_intake`（報修單） | 判給 `service_reports`（進度回報） |
|---|---|
| 出現**冒號標籤表單**：`客戶:` `聯絡人:` `車種:` `是否保固內:` `狀況:` 連續多行 | 開頭是 `今日進度回報` / `今日工作內容回報` |
| 由**客服**貼、描述**待處理**的維修需求 | 由**師傅**貼、描述**當日施作**內容 |
| 狀態＝派工前（`待派工` / `待聯絡` / `待安排`） | 狀態＝施作中／完成（`待領料安裝` / `已完成`） |

> 兩者都沒命中就照舊走 `records`（L1 分類），不硬塞任一區塊。

### 3.3 schema 草案 · `serviceIntakeSchema`（v0.1）

```ts
service_intake: z.array(z.object({
  date: z.string().nullable(),
  customer: z.string().nullable(),      // 客戶：祝三、台中智障者協會
  site: z.string().nullable(),          // 站點／地址區域（原文照抄，見 OQ-ESI-3 是否含完整地址）
  vehicle: z.string().nullable(),       // 車種＋車牌合併原文：「VERYCA RFB-3630」
  warranty: z.string().nullable(),      // ⭐ 是否保固內:是→「保內」/否→「保外」/未知→null · 讀明寫欄位非推斷
  issue: z.string().nullable(),         // 狀況：斜坡板放不下來
  status: z.string().nullable(),        // 派工狀態：待派工／待聯絡客戶／已排（原文語意）
  contact: z.string().nullable(),       // 聯絡人姓名（見 OQ-ESI-4 PII）
  phone: z.string().nullable(),         // 電話 · ⚠️ PII · **存遮罩尾三碼**（09xx-xxx-670）· 遮罩在 pipeline 後處理、非叫模型遮（見 OQ-ESI-2 / §3.4）
  source_ids: z.array(z.number()),      // R11 可溯源 · 必填
  confidence: Confidence,
}))
```

欄位對照真實表單：`客戶`→customer、`聯絡人`→contact、`電話`→phone、`車種`+`車牌`→vehicle、`是否保固內`→warranty、`地址`→site、`狀況`→issue。

**warranty 映射（核心，救填出率）**：`是否保固內: 是`→`"保內"`、`否`→`"保外"`、`未知`／空白→`null`。
這是**讀取表單明寫的欄位值**，不是推斷保固期 —— 與父檔「不自行判斷」不衝突（那條禁的是「沒寫卻猜」）。

**R11 三條紀律沿用**：缺漏填 `null`、金額禁臆測、`source_ids` 必填。

### 3.4 pipeline 管線改動（小重構）

- `TemplateDef.resultKey: string` → 支援第二輸出區塊（擇一）：
  - (a) `resultKey: string | string[]`，`service_order` 給 `["service_reports", "service_intake"]`；或
  - (b) 加獨立 `intakeKey?: string`。
  - 傾向 **(a)**：語意一致、`index.ts` 迴圈把每個 key 各推一個陣列即可。M1 定案。
- `analyze.service.ts`：把 `service_intake` 映進 `AnalysisResult`（現行只映 `serviceReports`）。
- prompt：`service_order` 的 `promptFragment` 加一條「報修單 → service_intake」規則（含 §3.2 判別準則 + §3.3 warranty 映射），並把暫放的 rule 13 warranty 邏輯遷過來。
- **phone 遮罩在 pipeline 後處理**：模型輸出完整號碼（transient、不落庫），persist 前用 deterministic regex 遮成尾三碼（`09xx-xxx-670`）。**不叫模型自己遮**——模型遮罩會不一致、甚至改動數字，違反 R11「不臆測數字」。

### 3.5 ⚠️ raw_content 已明文存電話 —— phone 遮罩的真實邊界

同一支電話**在 `analysis_upload.raw_content` 是明文**（報修單原文整段落庫）。所以 `service_intake.phone` 遮罩尾三碼**只降低「結構化欄位被批量撈」的風險**，擋不住：

- **DB dump／備份外洩**：正本在 raw_content 明文，加密或遮罩結構化副本無濟於事。
- **F-4 無 RLS 端點外洩**：見 §4／FMEA F-4，這是 access control 問題。

要「任何地方都沒有完整電話」，只能在 ingest 就遮 raw_content —— 但那與 **R11（原始訊息不可變、核銷/稽核佐證）直接衝突**，且動到 line-ingest 與所有讀 raw_content 的地方（健康度、重抽、回歸）。**這是獨立的「PII-at-rest」工程，不在本模組 scope**，記為 backlog（見 §7 註）。本模組的遮罩是**務實的密度降低**，不是完整的 at-rest 保護——誠實標明，不自欺。

---

## 4. 資料模型變動（R1 · 遷移計畫）

| 項目 | 影響 | 處理 |
|---|---|---|
| `analysis_result.service_intake` | 新離散 jsonb 欄位 | **additive migration**：`ADD COLUMN service_intake jsonb NOT NULL DEFAULT '[]'`，不動既有欄 |
| RLS | `analysis_result` **無 RLS**（見 memory `pitfall_analysis_tables_no_rls`） | 讀 `service_intake` 的使用者可見端點**必須 service 層明確 filter tenant/dept**，不可靠 RLS |
| 既有 `service_reports` / `records` | 無 | 不動 |
| 已抽批次 | 不回溯重抽（R11 原始不可變） | 只有新批次會有 service_intake |
| 前端 | 戰情室／群組日誌顯示報修單區 | M3（可延後） |
| 材料化 → tickets | 報修單＝天然待辦 | OQ-ESI-6（傾向要，但看板灌爆風險先評估） |

> 遷移風險低（additive、無 RLS 但端點本就要自 scope），但**因為動 schema 欄位＋新輸出結構，屬 R1／R6，需本 M0 review 通過才進 M1**。

---

## 5. 回歸要求（R12 · 不可省）

改 `src/schemas.ts` / `templates.ts` / system prompt 後**必須**：

1. 重跑 `samples/` 三個既有樣本檔（`npm run analyze`）：分類覆蓋率仍 100%、報工群日報仍 **8 筆**、caching 仍生效 —— 新增區塊不可讓既有基準下降。
2. 用**台灣福祉真實報修單**（去識別化，尤其遮電話）建一組新樣本入 `samples/`，作為 `service_intake` 回歸基準。**新增不可改動既有三檔**（§5.3）。
3. 驗收：對 07-30/07-31 那 6 張報修單重跑，`service_intake` 應抽到 6 筆、`warranty` 填出率明顯 > 0%（保內/保外正確對應 `是否保固內`）。

---

## 6. 失效場景反思（FMEA · R17）

| # | 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|---|
| F-1 | 型態判別 | 報修單被抽成進度回報（或反之） | 欄位錯位、warranty 又掉 0% | **P0** | §3.2 判別準則靠強結構訊號（冒號標籤 vs 「今日進度回報」開頭）；樣本要含兩型態各數筆 |
| F-2 | warranty 語意 | `是否保固內:未知` 被填成「保內／保外」 | 誤導收費判斷 | **P0** | 只映 是→保內／否→保外，未知/空白一律 null；`source_ids` 可回查表單原文 |
| F-3 | PII | 電話結構化長期存 → 被批量撈／隱私面擴大 | 個資風險（居家長照客戶電話） | **P0** | ESI-2 定案：**存遮罩尾三碼**（09xx-xxx-670）、遮罩在 pipeline 後處理（§3.4）· ⚠️ 殘留：raw_content 仍明文（§3.5），完整 at-rest 保護屬獨立 PII-at-rest backlog（§7 註）|
| F-4 | 端點 scope | `analysis_result` 無 RLS，讀 service_intake 端點沒自 filter → 跨租戶/跨部門外洩 | 資料外洩 | **P0** | §4：service 層明確 filter tenant/dept（memory pitfall 已有前例 61f4440） |
| F-5 | 回歸 | 新增區塊使既有 8 筆日報抽取下降 | 既有能力退化 | **P0** | §5 R12 回歸；新舊樣本都要過 |
| F-6 | pipeline | `resultKey` 改陣列後只推第一個 key、service_intake 靜默空 | 抽了但沒落庫、又像 0% | P1 | §3.4 迴圈對每個 key 各推；單元測試斷言兩區塊都有值 |
| F-7 | 重複 | 同一報修單跨日重貼 → service_intake 出現重複筆 | 看板重複、任務重開 | P1 | 依 `source_ids` 去重；lifecycle linking 屬 #48（OQ-ESI-6） |
| F-8 | prompt 膨脹 | 兩區塊規則使 prompt 變長、成本上升 | token 成本 | P2 | system prompt 走 caching；規則精簡 |
| F-9 | 部署順序 | 程式先上、migration 0057 未套 → `analyze.service` insert `service_intake` 撞「欄位不存在」，**每個 service_order 批次都失敗** | 台灣福祉當天所有批次掛掉 | **P0** | **順序：先套 migration 0057（人工 · R10）→ 確認欄位存在 → 再 deploy 程式**。additive + default '[]'，早套不影響舊程式 |

**P0 共 6 條**：型態判別、warranty 未知誤填、PII、無 RLS 端點 scope、回歸、部署順序。任一未緩解不得上 prod（R17）。

> ⚠️ **部署 runbook**：① 人工在 prod 套 `0057_analysis_service_intake.sql`（psql）② `\d analysis_result` 確認 `service_intake` 欄在 ③ 才 push 觸發 Render 部署 ④ smoke：跑一批 service_order 確認 insert 不炸、`service_intake` 有值。**F-1 判別準則的真實驗收在 M2**（靜態測不到模型行為）。

---

## 7. 開放問題（OQ-ESI-N）— 待裁定

> ✅ **2026-08-01 全數裁定（用戶「全採建議」）**。ESI-1,3,4,5,6,7 採下表建議，ESI-2 見上方獨立裁定。M1 已依此落地。

| # | 問題 | 裁定 |
|---|---|---|
| ~~**OQ-ESI-1**~~ | `resultKey` 一般化用 (a) 陣列還是 (b) 獨立 `intakeKey`？ | ✅ 實作採 **`extraSection`**（key+schema+postProcess 一組，比純陣列多帶 schema/後處理，語意更完整）· 不動 factory/general 路徑 |
| ~~**OQ-ESI-2**~~ | 電話（PII）要不要結構化存？ | ✅ **已裁定（2026-08-01）：存遮罩尾三碼**（09xx-xxx-670）· 遮罩在 pipeline 後處理非叫模型遮 · ⚠️ 前提認知：raw_content 已明文（§3.5），此遮罩是密度降低非完整 at-rest 保護 · 曾評估「加密單欄位」→ 因正本明文而屬資安劇場，不採 |
| ~~**OQ-ESI-3**~~ | `site` 存完整地址還是只區域？ | ✅ 只存**區域/站點**（板橋、朴子站）· 完整地址也是 PII，`issue` 已可承接 · prompt 規則 16 已註明「只取區域」 |
| ~~**OQ-ESI-4**~~ | `contact`（聯絡人姓名）存不存？ | ✅ **存姓名、phone 遮罩尾三碼** · 姓名派工實用、敏感度較低（仍去識別化入樣本） |
| ~~**OQ-ESI-5**~~ | 要不要對台灣福祉真實報修單去識別化入 `samples/`？ | ✅ **要**（M2 執行）· 沒有真實基準無法回歸驗證新區塊 |
| ~~**OQ-ESI-6**~~ | 報修單要不要材料化成 ticket、並與後續進度回報串成同一工單？ | ✅ 材料化**要**（報修單＝待辦 intake，M3）；lifecycle linking **延後**給 #48，本模組先各自成筆 |
| ~~**OQ-ESI-7**~~ | 前端顯示放哪？ | ✅ 群組日誌新增「報修派工」區 + 戰情室待辦來源 · M3 |

> 📌 **Backlog（不在本模組 scope）· PII-at-rest**：`raw_content` 全欄位明文含電話/地址/聯絡人。要達成「任何地方都無完整 PII」需在 ingest 遮罩或加密 raw_content + 定保留期，但與 R11（原始不可變、核銷佐證）衝突，且跨全租戶、動 line-ingest 與健康度/重抽/回歸。等有合規壓力（個資法／長照稽核）再獨立開模組評估。本模組先做結構化欄位的密度降低（§3.5）。

---

## 8. 里程碑

| 里程碑 | 內容 |
|---|---|
| **M0** ✅ | 本文件 · OQ-ESI-1..7 全數裁定（2026-08-01） |
| **M1** ✅ | `serviceIntakeSchema` + `service_order` promptFragment 加報修單規則 15-18（判別準則 + warranty 映射）+ `extraSection`（key/schema/postProcess）+ `buildAnalysisSchema` 吐第二區塊 + pipeline 收集+phone 遮罩 + `analyze.service` 映射 + `analysis_result.service_intake` 欄位（migration 0057）+ 單元測試 6 支（templates.test）← **程式已就緒；migration 待人套 prod（R10）、未 push** |
| **M2** | 真實報修單去識別化入 `samples/` + R12 回歸（新舊都過）+ §5.3 驗收（6 張報修單、warranty > 0%）|
| **M3** | 前端顯示（群組日誌「報修派工」區）+ 材料化規則（依 OQ-ESI-6）+ **讀取端點自 scope（F-4 · 無 RLS）**|
| **M4** | 台灣福祉實跑一週、量 `service_intake` 產出量與 warranty/customer/vehicle 填出率 |
| **M5** | FMEA 覆核 + 上線 |

> ⚠️ **M1 目前的驗證邊界**：靜態驗（schema/prompt/遮罩）已綠（templates.test 21 支）。
> **判別準則（報修單 vs 進度回報）是模型行為，靜態測不到** —— 要 M2 用真實報修單樣本實跑才算驗收（FMEA F-1）。
> 在 M2 通過前，service_intake 會落庫但**尚未經真實資料證實抽得準**。

**M4 驗收基準**：`service_intake` 抽到的報修單數 ≈ 群組實際報修單數；`warranty` 填出率從 0% 拉到與 `是否保固內` 出現率相當。

---

## 9. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-01 | v0.2 | **M1 程式落地** · `serviceIntakeSchema` + service_order promptFragment 規則 15-18（判別準則 + 是否保固內→warranty 映射）+ `TemplateDef.extraSection`（key/schema/trackedFields/postProcess，不動 factory/general）+ `buildAnalysisSchema` 吐第二區塊 + pipeline 收集並 `maskIntakePhone` 遮罩 + `analyze.service` 映射 + migration 0057（additive `service_intake` 欄）· 單元測試新增 6 支（含遮罩/兩區塊/prompt 教學）· ⚠️ 途中發現：把 service_intake 設為 output schema 必填（同 service_reports）會讓既有 3 支 service_order 測試缺 key → 補 `service_intake: []`（正確：模型應永遠吐兩區塊，F-6）· tsc 綠、templates.test 21 支綠 · migration 待人套、未 push | ahern + Claude Code |
| 2026-08-01 | v0.1 | M0 首版 · 觸發＝service_order M1 一週填出率查驗發現 warranty 0% 真因是**報修單整個沒被抽**（6 張 100% 漏，客戶名比對 prod 確認非抽漏）· 用戶裁定報修單**另立 `service_intake` 區塊**不混進進度回報 · schema 草案含 warranty 映射（是否保固內→保內/保外）· **ESI-2 裁定：phone 存遮罩尾三碼**（§3.5 補「raw_content 已明文＝遮罩是密度降低非完整 at-rest；加密單欄位屬劇場」的認知，PII-at-rest 記 backlog）· FMEA 5 個 P0（型態判別/warranty 未知誤填/PII/無 RLS 端點 scope/回歸）· 其餘 OQ-ESI-1,3,4,5,6,7 待裁定 | ahern + Claude Code |
