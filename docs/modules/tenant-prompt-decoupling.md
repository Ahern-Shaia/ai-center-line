# tenant-prompt-decoupling · 把 prompt 從「台灣福祉專用」拆成「每家自己的」

> 狀態：🚧 **M0 DRAFT v0.1**（2026-07-28）· 待用戶裁定 OQ-TPD-1..10
>
> 相關：[`ai-analysis-layering.md`](ai-analysis-layering.md)（三層架構的來源）、[`extraction-schema-service-order.md`](extraction-schema-service-order.md)（L2 模板）、[`task-to-personal-report.md`](task-to-personal-report.md)（`directory()` 已存在）
>
> ⚠️ **一句話**：三層架構只有中間那層真的落地了。
> L1 與 L3 都還鎖在一個叫 `tenant-twh.ts` 的檔案裡，
> 而那份主檔**是假資料**，實測 grounding 命中率為 **0**。

---

## 0. 觸發

用戶問：「prompt 是針對商戶去模塊化設計的，對嗎？」

查完程式碼與 prod 資料，答案是**只有三分之一**。

---

## 1. 現況查驗

### 1.1 三層裡只有一層落地

| 層 | 內容 | 設計（AAL） | 實際 |
|---|---|---|---|
| **L1 通用核心** | 分類、抽取規則、信心值定義 | 全租戶共用、不可關 | ❌ 寫死在 `tenant-twh.ts` |
| **L2 業種模板** | general／factory_report／service_order | 開通時選一個 | ✅ **真的可換**（`tenants.extraction_template`） |
| **L3 租戶詞彙** | 人員／工位／車輛／工單／口語 | 是資料不是程式 | ❌ 同樣寫死在 `tenant-twh.ts`，且是假的 |

### 1.2 所有客戶共用同一份 prompt

`pipeline/index.ts:34`：

```ts
export function resolveTenant(slug: string): Tenant {
  if (slug === "twh" || slug === "batch") return TWH_TENANT;
  throw new Error(`unknown tenant slug: ${slug}`);
}
```

而**所有群組分析都帶 `tenantSlug: "batch"`**（`analyze.service.ts:70`），
一律取到 `TWH_TENANT`。system prompt 第一句是：

> 你是「台灣福祉科技」（福祉車／復康巴士改裝廠，合格改裝廠）的 LINE 群組對話分析引擎。

**第二家客戶接進來，AI 會被告知它在分析台灣福祉的群組。**

### 1.3 ⚠️ 更該先處理的：那份主檔是假的，而且沒有作用

`tenant-twh.ts` 檔頭寫得很清楚：「人名皆為假名（姓＋○○）· pilot demo/regression 用」。
主檔內容是 `P-01 洪○○`、`ST-01 升降機工位`、`CV-2507-01`、詞彙「歹去／teh叫」。

prompt 明確要求：「把 LINE 顯示名對應到人員代碼（person 填主檔 code）」。

**prod 實際抽出來的 person 值：**

```
郁芬Sandra 4 · Cathy 4 · 鄧景元 3 · 江冠毅 2 · 汪 2
簡瑋伶 2 · Jack Chen 1 · willa 1 · 許佳惠/SHIN 新 1
```

**沒有一筆是 `P-xx`。** 模型直接忽略主檔、照原文抄人名——
這其實是它能做的最合理的事，因為主檔裡那些人在真實群組裡根本不存在。

這也解釋了先前一直沒解開的數字：**機台 7%、工單 8%**。
不是模型抽不出來，是**要它對應的東西不存在於現實**。

> **主檔目前是純負擔**：佔 prompt 長度、佔快取、可能干擾判斷，命中率 0。

### 1.4 真實的名單其實早就有了

不必等 Ragic。這兩張表現在就有真實資料：

| 來源 | 內容 | prod 現況 |
|---|---|---|
| `line_member` | 群組成員的 LINE 顯示名 | **42 人** |
| `users` | 系統帳號的 display_name | 已建的帳號 |

而且 `AssigneeResolverService.directory()` **已經寫好了**——
它就是為了「給抽取階段當人名候選集」而做的（`task-to-personal-report.md` §3.2），
只是抽取那一端還沒去用它。

---

## 2. 主張

### 2.1 L1 搬出來，成為真正的通用核心

`tenant-twh.ts` 的 SYSTEM_PROMPT 現在混了三種東西：

| 內容 | 該屬於 |
|---|---|
| 「你是台灣福祉科技的分析引擎」 | **L3**（公司身分，從 `tenants.tenant_name` 來） |
| 六類分類（daily_report 改裝報工日報／maintenance 維保…） | **L2**（「改裝報工」是業種特定的說法） |
| 抽取規則、實體對應、null 規則、信心值三級 | **L1**（真正通用） |
| 主檔 JSON | **L3** |

→ 拆成 `core-prompt.ts`（L1）+ 模板 promptFragment（L2）+ 執行期組裝（L3）。

### 2.2 L3 改成執行期從 DB 組，不再寫死

新增 `TenantContextService`，依 `tenant_id` 組出：

```
公司：{tenants.tenant_name}（{tenants.industry}）
群組成員名單：{line_member + users 的 display_name}
客戶／聯絡人：{data_sync_customer / data_sync_contact，若已接 Ragic}
口語對照：{租戶詞彙表，若已維護}
```

**沒有的段落就不放**，不要放空的骨架讓模型去猜。

### 2.3 ⭐ 假主檔直接刪掉，不要「先留著」

留著它有三個壞處：佔快取、命中率 0、而且**讓人以為 grounding 有在運作**。
今天要不是去查 prod 的 person 值，不會發現它一直是空轉的。

> 這與 §1.3 的量測是同一件事：**沒有量測就沒有 grounding**。
> 新的主檔上線後，`extraction-health` 那頁要能看到命中率，
> 否則我們只是把一份假資料換成另一份沒人看的資料。

---

## 3. 會連帶影響的東西

| 位置 | 影響 |
|---|---|
| **prompt caching** | 主檔在 `cacheableContext`。現在全客戶共用一份＝共用一個快取；改成每家一份後，**快取變成每租戶一份**，寫入成本 × N |
| **最小快取門檻** | Opus 4.7 的最小可快取前綴是 **4096 tokens**，低於門檻**靜默不建快取**（AGENTS.md 已記此坑）。小客戶的主檔可能撐不到 → 每次全額計費且不報錯 |
| `analysis_upload.tenant_slug` | 這個欄位語意已死（NOT NULL 所以塞 `'batch'`）。決定是廢掉還是改存真實 slug |
| `samples/` 回歸 | 動 system prompt 屬破壞性修改（**R12**），三個樣本檔必重跑並比對 |
| `extraction-health` | 建議加「主檔命中率」欄位，否則換完沒人知道有沒有變好 |

---

## 4. 失效場景反思（FMEA · R17）

| # | 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|---|
| **F-1** | 多租戶 | 第二家客戶拿到台灣福祉的主檔與公司身分 | **跨租戶資料混入 prompt** | **P0** | 本案要解的就是這條 · 在此之前**不可接第二家客戶做分析** |
| **F-2** | 品質 | 拿掉假主檔後抽取品質下降但沒人發現 | 靜默退步 | **P0** | 動手前先跑 `samples/` 存基準；M1 必須證明「純搬移、輸出不變」 |
| **F-3** | 空主檔 | 新租戶什麼資料都還沒有 → prompt 出現空的 grounding 區塊 | 模型亂填或格式壞 | **P1** | 沒有的段落整段不輸出 · 加一支「空租戶」測試 |
| **F-4** | 成本 | 每租戶一份快取 → 寫入成本 × N；小租戶低於 4096 tokens 靜默不快取 | 成本上升且看不見 | **P1** | 量測每租戶 `cache_creation` / `cache_read`；進 AI 成本管理頁 |
| **F-5** | 名單品質 | `line_member` 含離職者、外部廠商、機器人 | grounding 反而誤導 | **P1** | 名單有上限（`directory()` 已限 60）· 只取近期活躍者 |
| **F-6** | 隱私 | 員工姓名進入 prompt 送到模型供應商 | 個資出境 | **P1** | 客戶知情同意（同 media-and-vision F-1）· 只送顯示名不送聯絡方式 |
| **F-7** | 遷移 | 舊的分析結果用舊 prompt 產出，新舊混在同一個看板 | 判讀不一致 | P2 | 不回頭重跑歷史；`analysis_result` 記下當時的 prompt 版本 |
| **F-8** | 詞彙 | 口語對照表沒人維護 → 永遠空的 | 功能空轉 | P2 | 先不做 UI，等真的有第二家客戶再說（§5 M4 可延後） |

---

## 5. 開放問題（OQ-TPD-N）

| # | 問題 | 建議 |
|---|---|---|
| **OQ-TPD-1** | 假主檔留還是刪？ | **刪** · 命中率實測為 0，留著只會讓人以為有在運作（§2.3） |
| **OQ-TPD-2** | 人名候選集從哪來？ | **`line_member` + `users`**（現成、真實、42 人）· 不必等 Ragic |
| **OQ-TPD-3** | 六類分類算 L1 還是 L2？ | **L2** ·「改裝報工日報」是業種說法，服務業客戶看不懂 |
| **OQ-TPD-4** | 公司身分那句從哪來？ | `tenants.tenant_name` + `tenants.industry`（欄位都已存在） |
| **OQ-TPD-5** | 口語詞彙表放哪？ | 新表 `tenant_glossary`（tenant_id, term, meaning）· **但可延後到有第二家客戶** |
| **OQ-TPD-6** | `tenant_slug` 怎麼辦？ | 廢掉語意，保留欄位（NOT NULL）· 一律以 `tenant_id` 為準 |
| **OQ-TPD-7** | 要不要記錄 prompt 版本？ | **要** · `analysis_result` 加 `prompt_version`，否則新舊結果無法區分（F-7） |
| **OQ-TPD-8** | 主檔命中率要不要進健康度頁？ | **要** · 沒有量測就等於沒有 grounding（§2.3） |
| **OQ-TPD-9** | 什麼時候做？ | **接第二家客戶之前**必做 · 只有一家時不痛，但它是硬性前置（F-1） |
| **OQ-TPD-10** | 要不要一併支援每租戶自訂 prompt？ | **不要** · 那會變成每家一個 prompt＝接案不是 SaaS（AAL 的商業紀律） |

---

## 6. 里程碑

| 里程碑 | 內容 |
|---|---|
| **M0** | 本文件 + OQ 裁定 ← 目前在這 |
| **M1** | **純搬移**：L1 抽成 `core-prompt.ts`、六類下放 L2 · **輸出必須完全不變** |
| **M2** | `TenantContextService`：從 `tenants` + `line_member` + `users` 組 L3 · 刪除假主檔 |
| **M3** | `prompt_version` 落庫 + `extraction-health` 加主檔命中率 |
| **M4** | （選配）`tenant_glossary` 表 + aiproot 維護 UI —— 有第二家客戶再做 |
| **M5** | 第二家租戶端到端演練（建租戶 → 綁群 → 分析 → 確認拿到自己的名單）+ FMEA 覆核 |

> **M1 是 gate**：必須先跑 `samples/` 三個樣本存基準，改完再跑一次比對。
> 這一步只要「輸出不變」就算過——**不要在同一步順手改善抽取**，
> 否則之後品質變動分不清是誰造成的。

---

## 7. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-28 | v0.1 | M0 首版 · 起於用戶問「prompt 是針對商戶模塊化的嗎」· **查證結果：三層只有 L2 落地**，L1 與 L3 都鎖在 `tenant-twh.ts`，且 `resolveTenant()` 除 twh/batch 一律 throw、所有分析都走 batch → 全客戶共用台灣福祉的 prompt（F-1 P0）· **更關鍵的發現：那份主檔是假資料且命中率為 0** —— prod 抽出的 person 全是真實人名（郁芬Sandra／Cathy／鄧景元），沒有一筆 `P-xx`，這正是機台 7%／工單 8% 的成因：要它對應的東西不存在 · 主張刪假主檔、L3 改由 `line_member`+`users` 執行期組裝（`directory()` 早已寫好只是沒被用）· 指出快取影響：改後每租戶一份快取，且低於 4096 tokens 會靜默不快取 · FMEA 8 條含 2 個 P0 · OQ-TPD-1..10 | ahern + Claude Code |
