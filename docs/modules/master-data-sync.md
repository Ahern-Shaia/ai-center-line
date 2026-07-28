# master-data-sync · 主檔同步（沿用通知設定已經連好的 Ragic）

> 狀態：🚧 **M0 DRAFT v0.2**（2026-07-28）· 待用戶裁定 OQ-MDS-1..14
>
> 相關：[`four-features-reflection.md`](four-features-reflection.md)（P2 · 這是它的 gate）、[`tenant-prompt-decoupling.md`](tenant-prompt-decoupling.md)（同一件事的另一半）、[`notify-selfserve-platform.md`](notify-selfserve-platform.md)（要沿用的機制）
>
> ⚠️ **兩句話**：
> ① 客戶**已經連好 Ragic 了**（通知設定頁）——不要再叫他連一次。
> ② **`SourceConnector` 抽象也早就寫好了**（含 `pullCustomers()`），
> 只是憑證走環境變數所以從沒跑過。這一案主要是**把兩套接起來**，不是新寫。

---

## 0. 現況查驗：已經有的東西比想像中多

用戶指出「Ragic 目前是在通知功能頁有設定」。查證後，可沿用的部分幾乎是全部：

| 已經有的 | 位置 | 主檔同步能不能直接用 |
|---|---|---|
| Ragic 帳號（server / apname / **加密 API key**）· per-tenant | `ragic_account` 表 | ✅ **完全共用** |
| 讀表單欄位清單 | `RagicApiClient.fetchSchemaFields()` | ✅ 直接用 |
| 前端「輸入表單路徑 → 讀出欄位 → 勾選」的流程 | `notify-config/Wizard.tsx` 步驟 2–3 | ✅ 同一套互動 |
| 權限 | `notify-config:manage` | ⚠️ 需新增獨立權限（§4.4） |
| **批次拉多筆** | — | ❌ **只有這個要新做** |

`RagicApiClient` 目前只有 `fetchRecord()`（單筆，webhook 用）。
主檔要的是「一次拉幾百筆」。

### 0.1 Ragic API 查過了，做得到

手冊（`docs/ragic-http-api-手冊.md` §3）確認支援：

| 參數 | 用途 |
|---|---|
| `limit` / `offset` | 分頁拉取 |
| **`fetchDomainIds`** | **只拉指定欄位** ← 這一條很重要，見 §3 |
| `order` / `where` | 排序與篩選 |
| `naming=EID` | **必帶**（不帶的話 key 是欄位名，跟 schema 的 fieldId 對不上——2026-07-27 踩過） |

寫入（POST/PUT）也支援——與用戶提到的「Ragic 後續可能透過 LINE 操作調用」有關，見 §6。

### 0.2 ⭐⭐ 更大的發現：兩套 Ragic 整合並存，而且錯配

`src/data-sync-layer/connectors/base.ts` 有完整的 `SourceConnector` 介面：

```ts
readonly name: "ragic" | "weyver" | "sap" | "manual";
pullOrders() / pullCustomers() / pullContacts() / healthCheck()
```

**weyver、SAP、manual 當初就在型別裡。** Ragic 只是第一個實作，而且 `pullCustomers()` 已經寫好。

問題是現在有**兩套**，而且好的地方各在一邊：

| | 憑證來源 | 有沒有抽象 | 實際狀況 |
|---|---|---|---|
| `data-sync-layer/connectors/ragic.ts` | **環境變數** `DSL_TENANT_<SLUG>_RAGIC_API_KEY` | ✅ 有 | ❌ **prod 0 筆，從沒跑過** |
| `notify-config/ragic-api.client.ts` | **資料庫** `ragic_account`（加密、per-tenant） | ❌ 沒有 | ✅ **48 則通知在跑** |

**抽象的那套沒在用，在用的那套沒抽象。**

原因很具體：走 env 的話，每接一個租戶就要改環境變數、重新部署——
**客戶不能自助設定**，所以沒人設過。通知那套把憑證存進 DB、做了自助 wizard，客戶自己就設好了。

> **所以本案的核心不是「新寫主檔同步」，是「把憑證來源統一，讓已經寫好的 connector 活過來」。**
> 這讓原本估的 M2/M3 便宜很多。

---

## 1. 設計主張

### 1.0 憑證統一走 DB，讓現有 connector 活過來

`SourceConnector` 的設計是對的，錯的是憑證來源。

```
現在                                     改成
env DSL_TENANT_*_RAGIC_API_KEY           ragic_account（DB · 加密 · 客戶自助）
  ↓ 每接一租戶要改 env 重新部署              ↓ 客戶自己在畫面上設好
  ↓ 沒人設過                               ↓ 已經有 48 則通知在跑
RagicConnector（寫好了但沒跑過）           RagicConnector（同一份程式碼，活過來）
```

**不要再寫第三套 Ragic 存取。** 兩套已經夠亂了。

### 1.1 帳號共用，不要問第二次

客戶在通知設定已經：找到 Ragic 帳號名稱、產生 API key、貼進系統、驗證通過。
**那是整個流程裡最難的一段**（API key 要帳號管理者權限）。

主檔同步頁應該直接顯示：

```
Ragic 連線：taiwanhomecare  ✅ 已連線（沿用通知設定）
```

**不要有第二個「新增 Ragic 帳號」的入口。** 一家公司一組憑證，兩個地方各設一次
就會出現「改了一邊沒改另一邊」的經典問題。

### 1.2 但設定頁分開，不要塞進通知設定

兩者回答的是不同問題：

| | 通知設定 | 主檔同步 |
|---|---|---|
| 問題 | 哪張表**變更**時要通知誰 | 哪張表是你的**客戶名冊** |
| 觸發 | Ragic webhook 推過來（event-driven） | 我們定期去拉（periodic pull） |
| 頻率 | 即時 | 每日 |
| 設定者關心 | 訊息長什麼樣、發到哪個群 | 名稱在哪一欄 |

塞進同一頁會讓客戶必須先分辨「我現在是在設哪一種」——
**多一次點擊可以，多一次判斷不行。**

→ 新增頁面「**資料來源**」（暫名），與「通知設定」並列。

### 1.3 只問兩個問題

沿用 Wizard 的互動，但比通知設定簡單得多：

```
① 哪張表是你的客戶名冊？   [/customer/6      ] [讀取]
② 客戶名稱是哪一欄？        [▾ 客戶全稱      ]
   客戶編號是哪一欄？（選填）[▾ 客戶編號      ]
```

**就這樣。** 不問電話、不問地址、不問聯絡人——理由見 §3。

---

## 2. 資料落點

`data_sync_customer` 表**早就建好了**（prod 0 筆）。不新增表。

新增一張設定表：

```sql
CREATE TABLE master_data_source (
  source_id   uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  kind        text NOT NULL,          -- 'customer'（v1 只做這個）
  account_id  uuid NOT NULL,          -- 指向 ragic_account · 共用憑證
  sheet_path  text NOT NULL,          -- 例 /customer/6
  name_field  text NOT NULL,          -- fieldId · 客戶名稱
  code_field  text,                   -- fieldId · 客戶編號（選填）
  enabled     boolean NOT NULL DEFAULT true,
  last_sync_at    timestamptz,
  last_sync_count int,
  last_sync_error text,
  UNIQUE (tenant_id, kind)            -- 一種主檔一個來源，不做多來源合併
);
```

> `UNIQUE (tenant_id, kind)` 是刻意的：多來源合併會立刻帶出「同一個客戶在兩張表裡
> 名字不同怎麼辦」的問題，那是 v2 的事。**現在一種主檔只准一個來源。**

---

## 3. ⭐ 只拉需要的欄位（這是隱私設計，不是效能設計）

`four-features-reflection` 的 FMEA F-1 原本寫「電話地址不進 prompt」。
但既然 Ragic 支援 `fetchDomainIds`，**更好的做法是根本不要拉進來**。

```
GET .../customer/6?api&naming=EID&fetchDomainIds=<名稱>&fetchDomainIds=<編號>&limit=200&offset=0
```

| 做法 | 個資風險 |
|---|---|
| 全拉進來，只是不放 prompt | 電話地址存在我們的資料庫裡 · 外洩面擴大 |
| **只拉名稱與編號** | **我們根本沒有那些資料** |

**沒有的東西不會外洩。** 這也讓「要不要給客戶簽資料處理同意」這題簡單很多。

> ⚠️ 之後若真的需要聯絡方式（例如客戶頁要顯示電話），
> 那是一個**獨立的決定**，要重新評估，不是順手加一個 fieldId。

---

## 4. 失效場景反思（FMEA · R17）

| # | 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|---|
| **F-1** | 隱私 | 拉進整張客戶表（含電話／地址／身分證） | **個資範圍擴大** | **P0** | `fetchDomainIds` 只拉名稱＋編號（§3）· 欄位選單只讓選這兩項 |
| **F-2** | 租戶隔離 | 同步時寫錯 tenant_id → A 客戶的名冊進 B 家 | **跨租戶外洩** | **P0** | 寫入一律帶 tenant_id · 沿用 RLS · 加測試斷言 |
| **F-3** | 憑證 | 主檔同步另存一份 API key，與通知設定不同步 → 客戶改了 key 只有一邊壞 | 靜默失效 | **P1** | **共用 `ragic_account`**（§1.1）· 不另存 |
| **F-4** | 同步失敗 | Ragic 掛掉／key 過期 → 主檔停止更新但沒人知道 | **靜默失效** | **P1** | `last_sync_at` / `last_sync_error` 落庫並在頁面顯示「上次同步：⋯」· 連續失敗告警 |
| **F-5** | 資料量 | 客戶表上萬筆 → 一次拉爆記憶體／逾時 | 同步中斷 | **P1** | `limit`/`offset` 分頁 · 單次上限（如 5000 筆）· 超過只警告不中斷既有資料 |
| **F-6** | 刪除 | Ragic 那邊刪掉的客戶，我們這邊還留著 | 選單出現已刪客戶 | P2 | 每次同步標記 `synced_at`，過期的標為 inactive **不刪**（歷史打卡還指著它） |
| **F-7** | 覆蓋 | 同步把使用者手動修正過的資料洗掉 | 人的修正被 AI／同步蓋掉 | **P1** | 主檔是唯讀鏡像，**不允許在我們這邊編輯** —— 要改去 Ragic 改 |
| **F-8** | 欄位改名 | 客戶在 Ragic 改欄位 → fieldId 不變但語意變了 | 抓到錯的欄位 | P2 | 同步時比對 schema，欄位消失就停並報錯（不要靜默抓到空值） |
| **F-9** | 期待落差 | 客戶以為「同步」是雙向、在我們這邊改會回寫 Ragic | 資料不一致 | **P1** | 頁面明寫「唯讀鏡像 · 要修改請到 Ragic」（呼應 F-7） |
| **F-10** | 兩套並存 | 憑證統一後忘了廢掉 env 路徑 → 兩個來源打架、debug 時查錯地方 | 難以排查 | **P1** | M2 明確刪除 `DSL_TENANT_*` 讀取，不留「暫時保留相容」 |
| **F-11** | CSV | 客戶上傳的 CSV 欄位順序／編碼不同（Big5、無標頭） | 匯入全錯或亂碼 | **P1** | 匯入前顯示前 5 列預覽讓他確認對到哪一欄 · 不猜編碼，明講要 UTF-8 |

---

## 5. 開放問題（OQ-MDS-N）

| # | 問題 | 建議 |
|---|---|---|
| **OQ-MDS-1** | 帳號共用還是各設一份？ | **共用**（§1.1 · F-3）· 那段是客戶最難的一步，不要問第二次 |
| **OQ-MDS-2** | 設定塞進通知設定頁還是另開？ | **另開一頁** · 兩者回答不同問題，混在一起要客戶先判斷（§1.2） |
| **OQ-MDS-3** | v1 做哪幾種主檔？ | **只做客戶** · 人已經有（`line_member`+`users`）· 車輛／工單等有需求再說 |
| **OQ-MDS-4** | 要拉哪些欄位？ | **只拉名稱＋編號**（§3 · F-1）· 聯絡方式是獨立決定 |
| **OQ-MDS-5** | 同步頻率？ | **每日一次 + 手動「立即同步」** · 客戶新增客戶當天就想用得到 |
| **OQ-MDS-6** | Ragic 那邊刪掉的怎麼辦？ | **標 inactive 不刪**（F-6）· 歷史打卡還指著它 |
| **OQ-MDS-7** | 允不允許在我們這邊編輯主檔？ | **不允許** · 唯讀鏡像（F-7 · F-9）· 兩邊都能改就會打架 |
| **OQ-MDS-8** | 誰能設定？ | 沿用通知設定的層級（tenant_admin 以上）· 需新增 `master-data:manage` 權限 |
| **OQ-MDS-9** | 沒接 Ragic 的租戶怎麼辦？ | 主檔為空 → 打卡選單退回「自己去過的地方」（已實作），AI 候選集退回 `line_member` · **不因為沒主檔而壞掉** |
| **OQ-MDS-10** | 要不要現在就設計「LINE 操作 Ragic」的寫回路徑？ | **不要現在做，但不要擋住** · 見 §6 |
| **OQ-MDS-11** | 要不要把 `RagicConnector` 憑證改讀 DB？ | **要** · 那是它從沒跑過的唯一原因（§0.2 · §1.0） |
| **OQ-MDS-12** | `manual`（CSV）要不要跟 Ragic 平級？ | **要** · 多數台灣中小企業沒有 ERP（§7.2/7.3）· 寫成備案等於告訴他們「你是次等的」 |
| **OQ-MDS-13** | `manual` 要做到多完整？ | **只做 CSV 覆蓋式匯入** · 逐筆新增／編輯等於要我們變成小型 CRM，那是另一個產品 |
| **OQ-MDS-14** | 現有 `data_sync_order` / `contact` 要不要一起啟用？ | **不要** · v1 只做客戶（OQ-MDS-3）· 訂單目前由通知走，沒有第二個用途 |

---

## 6. 關於「Ragic 後續可能透過 LINE 操作調用」

用戶提到這個方向。**本案不做，但有一個設計決定要現在下**：

`RagicApiClient` 目前散在 `notify-config/` 底下（因為當初只有通知在用）。
主檔同步是**第二個**使用者，若之後再加「LINE 指令寫回 Ragic」就是第三個。

→ **把 `RagicApiClient` 與 `RagicAccountService` 抽到共用位置**，
不要讓主檔同步 `import ../notify-config/...`。

這是純搬移、零行為改變，但**現在做很便宜，第三個使用者出現時再做就得改三處**。

> ⚠️ 除此之外**不要為寫回預先設計任何東西**（同 channel-adapter 的教訓：
> 沒有第二個實例時設計介面，等真的要用會發現介面錯）。

---

## 7. 不只 Ragic：ERP-agnostic 與「根本沒有 ERP」

> 用戶：「Ragic 太小眾，普及率不高。」

### 7.1 抽象已經在了，不用再設計一層

`SourceConnector` 的 `name` 欄位就是 `"ragic" | "weyver" | "sap" | "manual"`。
要接 weyver（自家產品，兩邊都控制得了）或別家 ERP，就是**多寫一個 implementation**，
上層（主檔同步、打卡選單、AI 候選集）完全不用改。

⚠️ 但誠實講：這個介面是**只有 Ragic 一個實作時設計的**，可能有幾處是照 Ragic 的形狀長的。
第二個實作接上時要有「介面可能要調」的心理準備（同 `channel-adapter.md` F-1 的道理）。
好處是第二個大概率是 weyver ——**兩邊都是自己的，改起來不用求人。**

### 7.2 ⭐ 但真正的缺口不是「別家 ERP」，是「沒有 ERP」

台灣中小企業很多**根本沒有 ERP**，用的是 Excel 和紙本。

所以 ERP-agnostic 的重點與其說是「多接幾家 ERP」，不如說是**「沒有 ERP 也能用」**：

| 客戶情況 | 主檔從哪來 | 難度 |
|---|---|---|
| 有 Ragic | 現有 connector（換憑證來源就能動） | **低** |
| 用 weyver | 自家產品，兩邊都控制得了 | 中 |
| 有別家 ERP（SAP／鼎新） | 再寫一個 connector | 高 |
| **什麼都沒有** | **CSV 匯入 ／ 後台手動維護** | **低** |

`manual` 這個值當初就寫在型別裡了——這條路被想過，只是沒實作。

**而它可能是最有價值的一條**：它讓「沒有 ERP 的小客戶」也能成為客戶，
而那正是要從傳統產業往外擴時會遇到的那一群。
反過來說，接 SAP／鼎新那種大型 ERP 的客戶通常已有資訊部門與完整系統，
不見得是我們的主場。

### 7.3 主張：`manual` 與 Ragic 平級，不是備案

「資料來源」頁應該一開始就給兩個選項，而不是「接 ERP（推薦）／沒有的話手動」：

```
你的客戶名冊在哪裡？
  ○ Ragic          （已連線 · 沿用通知設定）
  ○ 上傳 CSV        （沒有 ERP 也沒關係）
```

把手動寫成備案，等於告訴沒有 ERP 的客戶「你是次等的」。
**多數台灣中小企業就是第二種。**

> ⚠️ 但 `manual` 也不要現在就做完整的維護介面。
> **CSV 匯入 + 覆蓋式更新**就夠了（一次上傳整份、取代舊的），
> 不要做逐筆新增／編輯 —— 那等於要我們變成一個小型 CRM，是另一個產品。

---

## 8. 里程碑

| 里程碑 | 內容 |
|---|---|
| **M0** | 本文件 + OQ 裁定 ← 目前在這 |
| **M1** | `RagicApiClient` / `RagicAccountService` 抽到共用位置（**純搬移，行為不變**）|
| **M2** | **`RagicConnector` 憑證改讀 `ragic_account`**（§1.0）· 廢掉 `DSL_TENANT_*` env 路徑 |
| **M3** | `master_data_source` 表 + 同步服務（用現有 `pullCustomers()`）+ 每日排程 + 失敗落庫 |
| **M4** | 前端「資料來源」頁：Ragic 與 **CSV 兩個平級選項**、選表、對欄位、立即同步、上次同步狀態 |
| **M5** | `ManualConnector`（CSV 匯入 · 覆蓋式）—— §7.3 |
| **M6** | 打卡選單與 AI 候選集改吃主檔（**保留現有 fallback**）+ 命中率量測 |
| **M7** | FMEA 覆核（2 個 P0）+ 客戶操作說明 |

> **M5 的 fallback 不可拿掉**：沒接 Ragic 的租戶、主檔還沒同步完的空窗期，
> 都要能照常運作（OQ-MDS-9）。**新機制上線不可以讓舊路徑消失。**

---

## 9. 需要跟客戶確認的一件事

**「你們的客戶名冊是哪一張 Ragic 表？」**

目前只知道 `TB-P01 分析表`（`/order-operation/11`）裡有「客戶編號／客戶全稱」，
但那是訂單表不是客戶主檔——**同一個客戶會出現很多次**。

問法建議（給業務）：

> 「你們 Ragic 裡有沒有一張表是**客戶清單**（一家客戶一列，不是訂單那種）？
> 如果有，麻煩把網址複製給我——就是打開那張表時網址列後面那一段，
> 例如 `/customer/6`。」

---

## 10. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-28 | v0.2 | 起於用戶問「Ragic 可以做成模組嗎，因為 Ragic 太小眾」· ⭐⭐ **查證後發現抽象早就有了**：`SourceConnector` 介面完整（`pullOrders`/`pullCustomers`/`pullContacts`/`healthCheck`），`name` 欄位當初就寫了 `"ragic" \| "weyver" \| "sap" \| "manual"` · **但問題是兩套 Ragic 整合並存且錯配**：data-sync-layer 那套有抽象卻走 env 憑證（每接一租戶要改環境變數重新部署 → 客戶不能自助 → **prod 0 筆從沒跑過**）；notify-config 那套沒抽象卻把憑證存 DB 加自助 wizard（**48 則通知在跑**）· → 本案核心從「新寫主檔同步」改成「**把憑證來源統一，讓已寫好的 connector 活過來**」，M2/M3 因此便宜很多 · ⭐ **對「Ragic 太小眾」的回答**：真正的缺口不是「別家 ERP」而是「**根本沒有 ERP**」—— 台灣中小企業多數用 Excel 和紙本，而 `manual` 這個值當初就在型別裡只是沒實作 · 主張 **CSV 與 Ragic 平級不是備案**（寫成備案等於告訴多數客戶「你是次等的」），但只做覆蓋式匯入不做逐筆編輯（那是另一個產品）· 里程碑改為 M1–M7 · FMEA 新增 F-10（憑證統一後要真的廢掉 env 路徑，不留相容）/ F-11（CSV 編碼與欄序）· OQ 擴至 14 條 | ahern + Claude Code |
| 2026-07-28 | v0.1 | M0 首版 · 起於用戶指出「Ragic 目前是在通知功能頁有設定」· **查證後可沿用的比想像多**：`ragic_account`（含加密 key、per-tenant）、`fetchSchemaFields()`、Wizard 的選表選欄位互動全部能共用，**只有「批次拉多筆」要新做** · Ragic API 確認支援 `limit`/`offset`/**`fetchDomainIds`** · ⭐ 主張**只拉名稱＋編號**：不是效能考量而是隱私設計 —— 沒有的東西不會外洩，比「拉進來但不放 prompt」乾淨得多（F-1 P0）· 主張帳號共用不問第二次（API key 是客戶最難的一步）但設定頁分開（兩者回答不同問題，混在一起要客戶先判斷）· 主檔為唯讀鏡像不允許在我們這邊編輯（F-7/F-9）· 沒主檔的租戶要能照常運作，fallback 不可拿掉（OQ-MDS-9）· 因應用戶提到「Ragic 後續可能透過 LINE 操作」：M1 先把 RagicApiClient 抽到共用位置（純搬移、現在便宜），但**不為寫回預先設計介面** · FMEA 9 條含 2 個 P0 · §8 列出要問客戶的那一個問題 | ahern + Claude Code |
