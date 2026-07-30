# batch-status-reconciliation · 批次狀態與分析結果的對帳

> 狀態：🔨 **M1 / M1.5 / M2 已落地 v0.3**（2026-07-30）· OQ-BSR-1..7 全採建議 · 待 M3（一週觀察）
>
> ⚠️ OQ-BSR-5 的**落地方式**在裁定後修正了（§9 註）：原本寫「tenant_admin 看自家」，
> 但查 prod 發現 `batch-history:view` 只給 `aiproot_admin` / `consultant` ——
> 不是加權限給 tenant_admin，而是**換一個他們本來就會看的地方**（§4.5）。
>
> 相關：[`conversation-analysis-pilot.md`](conversation-analysis-pilot.md)（批次來源）、
> [`extraction-schema-service-order.md`](extraction-schema-service-order.md)（觸發本文的改動）、
> [`../抽取健康度分析報告-2026-07-30.md`](../抽取健康度分析報告-2026-07-30.md)（同一類「失敗長得像成功」）
>
> ⚠️ 本文**不新增功能**，是把一個既有的觀測缺口補上。它之所以現在才寫，
> 是因為 2026-07-30 把 `loadTemplate()` 改成 fail-closed（`01c809e`）之後，
> 「分析失敗」從幾乎不可能變成一條真實路徑 —— 而那條路徑目前**沒有出口**。

---

## 1. 目標與範圍

### 1.1 目標

讓「昨晚的分析到底有沒有成功」這個問題**有一個地方可以看**，且答案不會騙人。

具體是三件事：

1. 分析失敗時，批次不再回報 `completed`
2. 分析**從來沒開始**時（目前完全無聲），有東西抓得到
3. 有一支對帳查詢，能回答「過去 N 天有幾群的分析其實沒產出」

### 1.2 為什麼現在做

`analysis_batch.status` 目前是一根**永遠不會變的柱子**。prod 50 筆全部 `completed`
（見 §2.2）—— `markFailed()` 從上線到現在沒有觸發過一次。
一個只有一種值的狀態欄位不帶任何資訊，但它被當成「分析成功」在讀。

而 `01c809e` 把 `loadTemplate()` 從「查不到就猜 `factory_report`」改成 throw，
理由是抽錯結構不可回溯（R11）比批次失敗嚴重。那個判斷本身沒變，
但它的**前提是失敗會被看到** —— 目前不會。這份 doc 補的就是那個前提。

### 1.3 不做的事

| 不做 | 為什麼 |
|---|---|
| 自動重試分析 | 失敗原因分兩類（暫時性 vs 設定錯），自動重試對後者是無效迴圈。先讓失敗可見，重試等看過真實失敗分佈再談（OQ-BSR-6）|
| 補跑歷史失敗的 6 筆 | 成因都是已修的舊 bug（§2.3）· 補跑要重花 API 費用且那幾天的對話價值已低 · 若要補是獨立決定（OQ-BSR-7）|
| 改 batch 為同步等待 | 方案 B，評估後不建議（§4.2）|
| 把 `analysis_batch` 與 `analysis_upload` 合表 | 兩者語意不同（一次撈取 vs 一次分析），且是 1:1 只是巧合 —— 手動上傳有 11 筆沒有 batch |

---

## 2. 上游 / 既有現況走查

### 2.1 現在的呼叫鏈

```
排程器
 └─ AnalysisBatchService.run()                      ← src/convo-analysis-realtime/analysis-batch.service.ts
     ├─ 撈訊息 → formatAsLineExport → blob
     ├─ createBatchUpload()            → analysis_upload (status=pending)
     ├─ batchRepo.markCompleted()      → analysis_batch (status=completed)   ← ⚠️ 這裡就宣告成功了
     ├─ scheduleJob(uploadId)          → setImmediate，射出去不等            ← ⚠️ 斷點在這
     └─ return { status: "completed" }
            ⋮  （另一條執行緒）
        AnalyzeService.runJob()                      ← src/conversation-analysis/analyze.service.ts:126
         ├─ status=running
         ├─ runPipeline()  ← loadTemplate() 在這裡，01c809e 之後會 throw
         ├─ 成功 → analysis_upload.status=done
         └─ catch → analysis_upload.status=failed + error_message
                    ⚠️ 完全沒有回寫 analysis_batch
```

`markCompleted` 在 `scheduleJob` **之前**，而且兩者中間的順序是刻意的 ——
`analyze.service.ts:91` 的註解說明過：在 tx 內排程會讀不到剛寫入那筆
（2026-07-27 prod 實際發生 `upload N 不存在`）。所以「先 commit 再排程」是對的修法，
**但它順手讓 `completed` 的語意退化成「已排程」**，而欄位名字沒跟著改。

`analysis-batch.service.ts:123` 的註解甚至已經寫下了這個事實：
> `（runJob 走另一條連線 → upload N 不存在，且 batch 仍回報 completed）`

—— 也就是說這件事被知道過，只是當時在修另一個 bug，沒有回頭處理。

### 2.2 prod 實際數字（2026-07-30 唯讀查詢）

| 指標 | 值 |
|---|---|
| `analysis_batch` 總數 | 50（2026-07-22 ~ 07-29）|
| `analysis_batch.status` 分佈 | **`completed` = 50**（沒有其他值）|
| `analysis_upload.status` 分佈 | `done` = 51 / `failed` = 8 / `pending` = 1 |
| 手動上傳（無對應 batch）| 11 |

**⭐ 關鍵數字：batch 的 status 只有一種值。** 50/50。
`markFailed()` 寫在 catch 裡，但 `run()` 的 try 區塊涵蓋的是「撈訊息 + 建 upload + 標完成」，
分析本身在 try 之外 —— 所以那個 catch 抓不到分析失敗，只抓得到撈取失敗，而撈取沒失敗過。

### 2.3 已發生的分歧（6 / 50 ＝ 12%）

`batch=completed` 但分析沒完成的批次：

| 批次日 | upload | upload 狀態 | 成因 | 現況 |
|---|---|---|---|---|
| 07-27 | 45 | `failed` | `upload 45 不存在`（tx 可見性）| ✅ 已修（scheduleJob 移出 tx）|
| 07-27 | 44 | **`pending`** | **無任何錯誤訊息** | ⚠️ **未解釋** |
| 07-23 | （無）| — | batch completed 但 `upload_id` 是 NULL | ⚠️ 未解釋 |
| 07-22 | 2 | `failed` | `ANTHROPIC_API_KEY 未設` | ✅ 已修（env 已設）|
| 07-22 | 5 | `failed` | 同上 | ✅ 已修 |
| 07-22 | 10 | `failed` | `upload 10 不存在` | ✅ 已修 |

**07-28 之後沒有再發生** —— 所以這不是正在流血的傷口，是一個沒有儀表的引擎。
四筆成因已修，但那四筆**當時沒有任何人知道**，是今天為了別的事查 prod 才翻到的。

### 2.4 三種失效形狀（差別很大，不可混為一談）

| # | 形狀 | batch | upload | 有錯誤訊息嗎 | 現在抓得到嗎 |
|---|---|---|---|---|---|
| **S1** | 分析執行後失敗 | `completed` | `failed` | ✅ 有（`upload.error_message`）| 只有翻 uploads 列表才看得到 |
| **S2** | **分析從來沒開始** | `completed` | `pending` 永遠 | ❌ **完全沒有** | ❌ **抓不到** |
| **S3** | batch 沒有 upload | `completed` | （不存在）| ❌ 沒有 | ❌ 抓不到 |

**S2 是最危險的**，因為沒有任何一段程式碼認為出了錯 —— 沒有 exception、沒有 catch、
沒有 log。`setImmediate` 的 callback 若因為 process 重啟（Render rolling deploy！）
而沒跑到，就是這個形狀。**Render 每次部署都在滾實例**，而批次是 18:00 跑，
兩者撞上的機率不是零。

> ⚠️ S2 也解釋了為什麼 07-27 那筆 upload 44 停在 `pending` 而 45 是 `failed`：
> 45 跑了但讀不到資料列，44 連 `runJob` 都沒進去（否則至少會被標 `running`）。
> 這是推論不是證據 —— 當天沒有 log 保留。

---

## 3. Scope 切分

| 代號 | 內容 | 解決 |
|---|---|---|
| **A** | 下游回寫：`runJob` 的成敗回寫 `analysis_batch` | S1 |
| **B** | 拿掉 async：batch 等分析跑完才 `markCompleted` | S1 + S2 |
| **C** | 對帳查詢 + 儀表：找出「completed 但 upload 不是 done 超過 N 分鐘」| S1 + S2 + S3 |

---

## 4. 方案評估

### 4.1 A · 下游回寫（建議做）

`runJob` 的 catch 裡多一步：若這個 upload 有對應的 batch，一起標 `failed`。
成功時標 `analyzed`（或維持 `completed`，見 OQ-BSR-2）。

- ✅ 約 20 行，不動架構、不動排程語意
- ✅ 讓 S1 立刻誠實
- ❌ **對 S2 完全無效** —— 沒人 throw 就沒人回寫

⚠️ 一個必須注意的細節：回寫要走 `withSystemTx`，而 `analysis_batch` 是不是 AND-only
policy 要先確認 —— 這是我們踩過 11 次的 RLS 靜默歸零，
一個回寫失敗且無聲的 fix 比不 fix 更糟（它會讓人以為已經有儀表了）。

### 4.2 B · 拿掉 async（不建議）

語意上最乾淨：`completed` 真的代表分析完成。

- ✅ 一次解掉 S1 + S2
- ❌ 每群數十秒到數分鐘 × 8 群，批次變成長交易
- ❌ Render 的 process 若在中途重啟，變成「跑一半的長工」——**S2 沒有消失，只是換位置**
- ❌ 排程器的 timeout / 重入保護要一起重新設計，改動面遠大於 A + C

**結論：語意最好但不划算**，而且它仍然需要 C 才抓得到「排程器根本沒被觸發」。

### 4.3 C · 對帳（建議做 · 這才是治本的那一半）

一支查詢：`analysis_batch.status='completed'` 且
（`upload_id IS NULL` **或** `upload.status <> 'done'`）且 `created_at < now() - interval 'N minutes'`。

- ✅ **唯一抓得到 S2 與 S3 的做法**
- ✅ 不需要任何一段程式碼「認為出錯了」—— 它是從外面比對事實
- ✅ 可以直接掛在抽取健康度那一頁（與 #40 同一畫面，同一個問題的兩半）
- ❌ 事後發現不是即時（延遲 = N 分鐘 + 看的人多久看一次）

### 4.4 結論：**A + C，不做 B**

A 讓已知的失敗立刻誠實（便宜）；C 補「沒人 throw 所以誰都不知道」那個洞
—— 而那才是真正看不見的一類。B 的語意最好，但把每晚的批次變成長交易，
風險換得不划算，且無法取代 C。

---

## 4-bis. UI 落點（C 顯示在哪裡）

### 4-bis.1 結論：不新增頁面、不新增 tab

對帳結果放**兩個既有畫面**，因為它有兩種讀者、要回答的問題不同：

| 讀者 | 落點 | 他要問的 |
|---|---|---|
| aiproot / consultant | **系統健康 → 對話分析歷程**（既有 tab）| 「昨晚哪幾群沒接住，要不要重跑」|
| tenant_admin / 客戶方 | **群組日誌**（他們本來就在看的頁）| 「這一天真的沒事，還是你們沒抽到」|

### 4-bis.2 為什麼不開獨立的「對帳」頁 / 第五個 tab

`web/src/App.tsx:283` 有一段自己寫下的理由，說明系統健康為什麼是四頁合一：

> 「這四頁回答的是同一個問題『這套系統跑得好不好』，而且互相解釋……
> **分成四個入口的結果是每一個都要點進去看一眼**」

對帳正是第五個「同一個問題」。開新頁就是重犯那次已經修過的錯。
而且 §11.2 的 P1 殘留是「**沒有人去看那一頁**」—— 新增一個要記得去看的頁面，
直接把那個殘留放大；折進既有表格則相反，它出現在人本來就會經過的路上。

### 4-bis.3 aiproot 面：`BatchHistory.tsx` 的「狀態」欄改成推導值

⚠️ **這一頁現在正在說謊，而且原因已經被寫在檔案裡了。** `BatchHistory.tsx:130` 有：

> 「⚠️ 不可以說『完成』。後端的 completed 是『訊息收齊、分析已排入』」

—— 但那段只修了**手動重跑的 toast**。表格的欄位仍然是
`completed: "已完成"`（第 31 行）配 `var(--ok-600)` 綠色（第 38 行）。
50 筆全綠、全部寫「已完成」。**知道了但只修了一半，這是本次要收的尾。**

狀態欄不再只讀 `analysis_batch.status`，改成 batch ⋈ upload 推導：

| batch | upload | 顯示 | 色 |
|---|---|---|---|
| completed | `done` | 已分析 | 綠 |
| completed | `failed` | **分析失敗** + 錯誤訊息 | 紅 |
| completed | `pending`，< 30 分 | 分析中 | 灰 |
| completed | `pending`，> 30 分 | **分析未啟動** | 琥珀 |
| completed | 無 upload | **無分析結果** | 琥珀 |
| failed | — | 收訊息失敗 | 紅 |

表頭上方一條摘要（不必逐列掃）：

```
過去 7 天 · 48 批次 · 已分析 44 · 需檢查 4          [ 只看需檢查 ]
```

「需檢查」＝上表琥珀＋紅。**筆數為 0 時這條也要在**，寫「48 批次 · 全部已分析」——
不顯示等於又一個「空白看起來像正常」。

### 4-bis.4 「已完成」這三個字要改

即使不動 `analysis_batch.status` 的值（OQ-BSR-2/3 裁定不改），
**label 要改**：`completed` → 「**已排入分析**」。
它現在是整個系統裡最誤導的一個字 —— 綠色 + 「已完成」讓人停止懷疑。

### 4-bis.5 tenant_admin 面：群組日誌不要讓失敗長得像「當日無資料」

`batch-history:view` 只給 `aiproot_admin` / `consultant`（prod 查證），
所以 tenant_admin 進不了對帳表。**但不要為此加權限給他** ——
他不需要一張對帳報表，他需要的是**看日誌時不被誤導**。

現在 `DailyLog.tsx` 的空狀態是「當日無資料」/「當日無工作日報」/「此期間內無日誌」。
分析失敗那天，客戶看到的就是這個 —— 跟「那天真的很閒」完全分不出來。

改法直接沿用**同一支檔案裡已經有的 pattern**（`dl-card-nodept`，
第 225 行，起因是 2026-07-29 客戶問「AI 抽出 11 項為什麼任務看板沒有」）：

```
┌────────────────────────────────────────────────┐
│ 業助群 · 業務部                                 │
│ ⚠ 這一天的分析未完成 · 內容尚未整理              │
│    已通知系統管理員 · 完成後會自動出現            │
└────────────────────────────────────────────────┘
```

- 語意是「**還沒好**」不是「壞了」—— 客戶不需要知道我們的內部狀態機
- **不給客戶重跑按鈕**：重跑要花 API 費用且要判斷原因，那是 aiproot 的事
  （對照 `feedback_novice_comfort_is_the_moat`：判斷次數目標 0 次）
- 這一條同時是 §11.2 那個 P1 殘留「沒有人去看那一頁」的部分解 ——
  客戶會看日誌，所以失敗會被看到，只是延遲到隔天

---

## 5. 資料模型變動

### 5.1 SQL Migration

**A 需要**：`analysis_batch.status` 目前的 CHECK constraint 要能容納新值（若有 CHECK）。
**C 不需要 migration** —— 純查詢。

```sql
-- 待確認：analysis_batch.status 是否有 CHECK constraint、允許哪些值
-- 若要新增 'analyzed' / 'analysis_failed' 需 ALTER CONSTRAINT
```

⚠️ 依 R1，若 `status` 的允許值變更＝破壞性修改，須列影響範圍：
前端讀 `status` 的地方、`markCompleted`/`markFailed` 的呼叫點、任何 `WHERE status='completed'`。
**M0 階段還沒盤點完，這是 OQ-BSR-1 的一部分。**

### 5.2 RLS / Permission

- 回寫走系統上下文 → 必須確認 `analysis_batch` 的 policy 有沒有 `system` 逃生門
- 對帳查詢若上儀表，讀取權限沿用抽取健康度那頁（`tenants:view` 或 aiproot 專屬，待定 OQ-BSR-5）
- ⚠️ 對帳結果**跨租戶**時只給 aiproot；tenant_admin 只能看自家（沿用 `current_tenant`）

---

## 6. 企業級 cross-cutting 檢核

### 6.1 安全模型
對帳查詢會揭露「哪個租戶的哪一天分析失敗了」。這是營運資訊不是內容，
但仍須租戶隔離 —— tenant_admin 不該看到別家有幾次失敗。

### 6.2 容量
對帳查詢掃 `analysis_batch` ⋈ `analysis_upload`，目前 50 × 62 列。
一年後單租戶約 8 群 × 365 ≈ 2,900 列，十租戶 3 萬列 —— 加 `(status, batch_date)` 索引即足。

### 6.3 失效模式
見 §11 FMEA。

### 6.4 觀測性
**這整份 doc 就是觀測性的補洞。** 額外要加的是：
`scheduleJob` 射出去時 log 一行、`runJob` 進入時 log 一行 ——
目前 S2 完全無跡可循的原因之一是「射出去」與「開始跑」之間沒有任何足跡。

### 6.5 成本
A 幾乎為零。C 是一支查詢。
**不做的成本才是重點**：一次靜默失敗 ＝ 該群當天的結構化資料永久沒有（R11 不回溯），
而客戶不會知道要抱怨（他們看到的日誌本來就不完整過）。

### 6.6 向後兼容 + Rollout
A 若新增 status 值 → 前端要能顯示未知值而不是空白（否則又是一個「失敗長得像正常」）。
C 純新增，無兼容問題。建議 **C 先上**（純讀、零風險、立刻有能見度），A 隨後。

---

## 7. 測試策略

| 測試 | 釘住什麼 |
|---|---|
| `runJob` 失敗 → `analysis_batch` 也是失敗狀態 | A 的核心行為 |
| 手動上傳（無 batch）失敗 → 不炸、不寫不存在的 batch | A 的邊界（11 筆手動上傳沒有 batch）|
| 回寫走 system 上下文 → 真的寫進去（不是 RLS 靜默 0 列）| ⭐ 踩過 11 次 |
| 對帳查詢：completed + upload=pending → 被列出 | S2 |
| 對帳查詢：completed + upload_id IS NULL → 被列出 | S3 |
| 對帳查詢：剛建立（< N 分鐘）的不列出 | 避免把「正在跑」報成失敗 |
| 對帳查詢跨租戶隔離 | tenant_admin 看不到別家 |

---

## 8. 里程碑

| # | 內容 | 依賴 |
|---|---|---|
| **M0** 📋 | 本文件 · 待裁定 OQ-BSR-1..7 ← 目前在這 | — |
| **M1** ✅ | C · 對帳推導（`analysis-state.ts`）+ `BatchHistory` 狀態欄改推導值 + 摘要條 + 「只看需檢查」· `8ae4f6b` / `7b9e43d` | — |
| **M1.5** ✅ | C · 群組日誌不再把分析失敗顯示成「當日無資料」· `80a1215` / `b48b7bc` | — |
| **M2** ✅ | A · 下游回寫（`markBatchAnalysisFailed`，走 `withSystemTx`）+ `scheduleJob`/`runJob` 足跡 log · `8ae4f6b` | — |
| **M3** | 用 M1 的對帳結果覆核：07-23 與 07-27 那兩筆未解釋的是否還會重現 | M1 ＋ 一週觀察 |
| **M4** | FMEA 覆核 + 依 M3 結果決定要不要重試機制（OQ-BSR-6）| M3 |

---

## 9. 開放問題（OQ-BSR-N）— ✅ **全採建議**（2026-07-30 裁定）

| # | 問題 | 裁定（＝原建議）|
|---|---|---|
| **OQ-BSR-1** | `analysis_batch.status` 要新增值，還是沿用 `failed`？ | **沿用 `failed`** —— 少一次破壞性變更（R1）。代價是分不出「撈取失敗」與「分析失敗」，但 `error_message` 已能區分 |
| **OQ-BSR-2** | 分析成功時要不要把 batch 從 `completed` 改成 `analyzed`？ | **不改** —— 語意雖然更準，但要動所有讀 `completed` 的地方，收益不抵風險。改的是**失敗**那一側就夠 |
| **OQ-BSR-3** | `completed` 這個名字要不要改成 `dispatched`（它現在的真實語意）？ | **不改，但在 schema 註解寫清楚**。改名是純 churn，寫清楚能防下一個人誤讀 |
| **OQ-BSR-4** | 對帳的「N 分鐘」門檻設多少？ | **30 分鐘**。單群分析數十秒到數分鐘，30 分鐘足以排除「正在跑」，又能當天發現 |
| **OQ-BSR-5** | 對帳結果給誰看？ | **aiproot 看全部、tenant_admin 看自家** —— ⚠️ **裁定後修正落地方式**：查 prod 發現 `batch-history:view` 只給 `aiproot_admin` / `consultant`，tenant_admin 進不了對帳表。**不加權限給他**（他不需要對帳報表），改成讓群組日誌不再把失敗顯示成「當日無資料」（§4-bis.5）。方向不變 —— 客戶方仍然看得到「這天沒抽到」，只是換一個他本來就會看的地方 |
| **OQ-BSR-6** | 要不要自動重試？ | **先不要**。等 M1 收到一週真實失敗分佈再決定 —— 目前唯一有樣本的失敗成因都是「設定錯」，自動重試對那類是無效迴圈 |
| **OQ-BSR-7** | 歷史那 6 筆要不要補跑？ | **不補**。成因已修、對話已過期、要重花 API 費用。但**要在對帳頁保留它們**，別假裝沒發生 |

---

## 10. SOP · 對帳查詢（現在就能用，不必等 M1）

```sql
-- ⚠️ 必須先設 RLS session 變數，否則靜默回 0 列（已踩 11 次）
SET app.actor_role = 'aiproot_admin';

SELECT b.batch_date, b.batch_id, b.upload_id, u.status AS upload_status,
       left(coalesce(u.error_message, b.error_message, '(無錯誤訊息)'), 120) AS err
  FROM analysis_batch b
  LEFT JOIN analysis_upload u ON u.id = b.upload_id
 WHERE b.status = 'completed'
   AND (b.upload_id IS NULL OR u.status IS DISTINCT FROM 'done')
 ORDER BY b.batch_date DESC;
```

**判讀**：
- `upload_status = failed` → 看 `err`，是設定問題還是暫時性
- `upload_status = pending` → **分析從來沒開始**（S2）· 查當天有沒有部署／重啟
- `upload_id IS NULL` → batch 建了但沒建 upload（S3）· 查 `b.error_message`

---

## 11. 失效場景反思（FMEA）· R17

### 11.1 A · 下游回寫

| 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|
| 回寫本身被 RLS 靜默擋掉（回 0 列不報錯）| **裝了儀表但它永遠顯示正常** —— 比沒裝更糟，因為會讓人停止懷疑 | **P0** | ✅ 已緩解：policy 有 `system` 逃生門、回寫走 `withSystemTx`、測試斷言 `rowCount === 1` 且讀回是 `failed`；另加一條測試**釘住危險本身**（同一句 UPDATE 用裸連線必須回 0 列），並把 `rowCount` 寫進 log —— 若某天每次回寫都是 0 列，那是 RLS 又擋住了而且不會有 exception |
| 手動上傳（無 batch）也走回寫 → 更新不存在的列 | 無害（0 列）但若寫成 throw 會讓成功的上傳變失敗 | P1 | ✅ 已緩解：回寫整段包 try/catch 且不影響主流程；測試釘住「prod 那 11 筆手動上傳的 0 列是正常不是錯」 |
| 前端遇到新的 status 值顯示空白 | 又一個「失敗長得像正常」 | P1 | ✅ 不存在：採 OQ-BSR-1「沿用 `failed`」，CHECK constraint 原本就允許，無 migration。且顯示改吃 `analysisState`（八種全有 label／色）|

### 11.2 C · 對帳查詢

| 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|
| 查詢漏設 RLS 變數 → 回 0 列 → 顯示「一切正常」 | **P0 · 同上，儀表騙人** | **P0** | ✅ 已緩解：沿用既有 `listByTenant`（呼叫端 `withSystemTx`，未改變 tx 取得方式）；測試塞五種分歧資料並斷言 `analysisState` 逐一對上 |
| N 分鐘門檻太短 → 把正在跑的報成失敗 | 狼來了，人開始忽略這個儀表 | P1 | ✅ OQ-BSR-4 建議 30 分鐘（單群實測數十秒到數分鐘）|
| 跨租戶洩漏（tenant_admin 看到別家失敗數）| 隱私 | P1 | ✅ 不存在：對帳表在 `batch-history:view`（僅 aiproot_admin / consultant）；客戶面走群組日誌，本來就受 `warroom-daily:view` ＋ RLS 限自家 |
| **沒有人去看那一頁** | 儀表存在但無效 | **P1 · 殘留** | ⚠️ **本 module 不解決**。治本是主動通知（LINE／email），但那是另一個模組的事；先有得看再談推播 |

### 11.3 部署順序

C 純讀 → 無順序要求。
A 若動 CHECK constraint → migration 必須**先於**後端部署（否則新碼寫入被 constraint 擋）。

### 11.4 不在本 module scope 修的 pre-existing 問題

| 問題 | 為什麼不在這裡修 |
|---|---|
| `setImmediate` fire-and-forget 本身 | 那是方案 B，評估後不建議（§4.2）。本模組讓它的失敗可見，不改它的形狀 |
| 排程器有沒有被觸發（batch 連建都沒建）| 更上游 —— 對帳查的是「已建的 batch」。「該建但沒建」需要另一個基準（哪些群該有 batch），與 #40 的分母問題同源 |
| 07-23 與 07-27 那兩筆未解釋的分歧 | 當天無 log 可查。M1 之後若重現才有材料 |

---

## 12. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-30 | v0.3 | **M1 / M1.5 / M2 落地**（`8ae4f6b` `7b9e43d` `80a1215` `b48b7bc`）· FMEA 的兩個 P0 皆已緩解，做法是**連「危險本身」一起釘住**：除了斷言回寫 `rowCount === 1`，另加一條測試證明同一句 UPDATE 用裸連線會回 0 列 —— 未來有人改用裸連線時測試會紅，而不是靜默失效 · ⭐ 過程中發現 M1.5 有個會造成退步的坑：`listDailyReports` 的 `DISTINCT ON` 只按 `uploaded_at` 取最新，把失敗的列一起撈進來後，一次**重跑失敗**就會蓋掉同一天先前成功的分析（有內容的卡片變成一句警語）→ 排序加 `(status='done') DESC` 讓成功優先 · ⭐ `needsAttention` 改由後端算並回傳，前端不維護第二份狀態集合（否則新增狀態時漏改前端會讓它安靜地不進「需檢查」）· 順手把 `GroupCard` 抽成獨立檔案（`DailyLog` 加完橫幅到 398 行，貼在 400 紅線）· 測試 402 → 407 全綠 | ahern + Claude Code |
| 2026-07-30 | v0.2 | **OQ-BSR-1..7 全採建議** · 加 §4-bis UI 落點：**不新增頁面、不新增 tab** —— aiproot 面折進既有「系統健康 → 對話分析歷程」，客戶面折進「群組日誌」· ⭐⭐ 走查發現 `BatchHistory.tsx:130` **已經寫下「不可以說『完成』」的警語，但只修了手動重跑的 toast**，表格欄位仍是 `completed: "已完成"` + 綠色（第 31／38 行），50 筆全綠 —— 知道了但只修一半，這是本次要收的尾 · ⭐ 不開第五個 tab 的理由引用 `App.tsx:283` 自己寫的「分成四個入口的結果是每一個都要點進去看一眼」，且 §11.2 的 P1 殘留正是「沒有人去看那一頁」，新增頁面會放大它 · ⭐⭐ **OQ-BSR-5 落地方式修正**：`batch-history:view` 只給 aiproot_admin／consultant（prod 查證），tenant_admin 進不了對帳表 —— **不加權限**，改成讓群組日誌別把失敗顯示成「當日無資料」，沿用同檔已有的 `dl-card-nodept` pattern（那個 pattern 的起因是 2026-07-29 客戶問「AI 抽出 11 項為什麼任務看板沒有」，同一類問題）· 新增 M1.5 里程碑（前端，與 M1 分開 commit）| ahern + Claude Code |
| 2026-07-30 | v0.1 | M0 首版 · 起因是 `01c809e` 把 `loadTemplate()` 改 fail-closed 後，「分析失敗」成為真實路徑而該路徑沒有出口 · ⭐⭐ prod 查出核心事實：**`analysis_batch.status` 50 筆全是 `completed`，`markFailed()` 從未觸發** —— 一個只有一種值的狀態欄位不帶資訊卻被當成「分析成功」在讀（真正的結果在 `analysis_upload.status`，兩者無回寫）· ⭐ 已發生分歧 6/50 ＝ 12%，四筆成因已修但**當時無人知道** · ⭐⭐ 拆出三種失效形狀，**S2（分析從來沒開始 → upload 永遠 pending、任何地方都沒有錯誤訊息）最危險**，因為沒有一段程式碼認為出了錯；`setImmediate` 撞上 Render rolling deploy 就是這個形狀，而批次 18:00 跑、部署隨時滾 · 建議 **A（下游回寫）+ C（對帳查詢）不做 B（拿掉 async）**：B 語意最好但把批次變長交易且 S2 只是換位置，仍需 C · FMEA 兩個 P0 都是同一件事 —— **回寫或查詢自己被 RLS 靜默擋掉，儀表會永遠顯示正常，比沒有儀表更糟** · OQ-BSR-1..7 | ahern + Claude Code |
