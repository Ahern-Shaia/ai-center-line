# Ragic 一鍵列印 → WePrint 整合可行性評估

| 項目 | 內容 |
|---|---|
| 日期 | 2026-07-15 |
| 觸發需求 | 客戶提出「Ragic 點按鈕 → 自動喚起 WePrint 藍牙印表機 App 帶入資料 → 列印」（5 步縮為 2 步）|
| 提案技術路徑 | URL Scheme `weprint://print?url=...` + Ragic「開啟網址」動作按鈕 + 免登入唯讀分享頁 |
| 決策狀態 | **等 30 秒實測 WePrint URL Scheme** 才能定案（見 §3）|
| 相關實體 | Ragic 表單、WePrint App（開發商：上海唯典網絡技術 Shanghai ThanMore）、58mm 藍牙熱感印表機 |

---

## 1. 現況痛點

客戶現場收貨時列印熱感收據流程共 5 步：

1. 於 Ragic 點下載 PDF
2. 打開 WePrint App
3. 手動匯入 PDF（找檔案是主要卡點）
4. 選印表機
5. 點列印

痛點：步驟繁瑣、學習成本高、**「找不到剛下載的 PDF」是最常見卡關**。

## 2. 期待流程

1. Ragic 該筆記錄點「一鍵列印」按鈕
2. 自動喚起 WePrint 並帶入該筆資料 → 使用者直接點列印

## 3. 三段技術點的燈號評估

| 段 | 內容 | 燈號 | 說明 |
|---|---|---|---|
| [a] | WePrint URL Scheme 規格 | 🔴 未驗證 | App Store 描述、開發商官網、Ragic community、Web 搜尋**均查無**「`weprint://` URL Scheme」相關文件。客戶提的 `weprint://print?url=` 是**假設語法**、不是驗證過的規格。開發商是上海廠商、非台灣 in-house、支援管道慢 |
| [b] | Ragic「開啟網址」動作按鈕 | 🟡 部分可行 | Ragic 官方支援 URL 動作按鈕、公式可帶欄位參數（[doc-kb/157](https://www.ragic.com/intl/zh-TW/doc-kb/157/)），但文件裡的範例**全是 http URL（Google、Instagram），從沒示範 mobile deep link 喚起外部 app**。實務行為要看瀏覽器：iOS Safari 對 custom scheme 一般 OK；Android Chrome 可能要 `intent://` 格式、不同語法 |
| [c] | Ragic 免登入唯讀分享頁 | 🟢 可行 | Ragic「這筆資料分享」可產生單筆時效性訪客連結、**自動隱藏側邊欄與其他功能**（[Ragic 分享 doc](https://www.ragic.com/intl/zh-TW/doc-user/51)、[存取權限 doc](https://www.ragic.com/intl/zh-TW/doc/32/access-rights)）|
| [c'] | 58mm 寬列印排版 | 🟡 需客製 | Ragic print layout 官方文件沒說能鎖寬度；可能要客製 print CSS 或用簡化 iframe |

## 4. Gate — 開會前 30 秒可完成的驗證

拿一台**已裝 WePrint 的 iPhone**，Safari 網址列輸入：

```
weprint://
```

- **能喚起 App** → §5 樂觀路徑可走
- **喚不起** → 整案廢，改走 §6 備案

若第一步過了、再測：

```
weprint://print?url=https://www.google.com
```

看有沒有真的把該網址帶進 WePrint 匯入畫面（若只喚起 App、沒帶資料，則要另找正確 param key）。

## 5. 樂觀情境（URL Scheme 存在時）

工程量估 **1–2 天**：

1. Ragic 動作按鈕（URL 類型）
   - 公式：`"weprint://print?url=" + ENCODEURL(該筆唯讀分享連結)`
2. 該筆記錄開「單筆分享」帶時效 token（**不要**開 EVERYONE 唯讀，見 §7）
3. 客製 58mm print CSS（隱藏非必要欄位、控制欄寬、字級 10–12pt）
4. iOS Safari + Android Chrome 各驗一次
5. 加使用手冊（客戶內部 SOP）

## 6. 備案（URL Scheme 不存在時，依成本排序）

- **A. 5 步縮 3 步**（零開發、立即可上）
  Ragic 按鈕 → 直接連 PDF URL → iOS Safari 開 PDF 後右上「分享」→ 選 WePrint。不完美但**痛點大半解決**（不再要「找檔案」），且不動任何整合面
- **B. 換印表機配套 App**
  漢印 HPRT / 佳博 GP / 芯燁 XPrinter Utility 有的支援 deep link 或 iOS Shortcut，改一次硬體換長期可整合性
- **C. Web Bluetooth 直吐 ESC/POS**（跳過 WePrint）
  Chrome 有 [Web Bluetooth Receipt Printer](https://github.com/NielsLeenheer/WebBluetoothReceiptPrinter)，但 **iOS Safari 不支援 Web Bluetooth**、只 Android 可行 → 一般不推薦

## 7. 失效場景反思（FMEA）

| # | 失效模式 | 影響 | 嚴重度 | 緩解狀態 |
|---|---|---|---|---|
| F1 | WePrint 無 `weprint://` URL Scheme | 方案完全不可行 | **P0** | ⚠️ 待 §4 30 秒實測 |
| F2 | URL Scheme 存在但 param key 名不同（`?url=` 不 work）| App 起了但沒帶資料 | P1 | ⚠️ 逐試 `url` / `file` / `pdf` / `html` 等 |
| F3 | 唯讀分享連結被搜尋引擎 index → 客戶收貨資訊外洩 | 資安 / 客戶信任 | **P0** | ✅ 用「單筆分享」帶時效 token，不開 EVERYONE 唯讀 |
| F4 | WePrint 升版改 scheme 或砍功能 | 現場整條路斷、無 fallback | P1 | ⚠️ 記錄鎖定 WePrint 版本 + 客戶端 SOP 備援手動列印 |
| F5 | Android 要用不同 `intent://` scheme | 只 iOS 通、Android 客戶抱怨 | P1 | ⚠️ 兩平台都驗 + UA 分流帶不同 URL |
| F6 | 58mm 換行醜 / 欄位溢出 | 收據無法讀 | P2 | ⚠️ print CSS 客製 + 白名單欄位 |
| F7 | 訪客連結被截圖／轉發滲漏 | 資訊外洩範圍擴大 | P2 | ⚠️ 時效性 token 短（e.g. 15 分鐘）+ 只帶列印必要欄位 |
| F8 | 客戶手機沒裝 WePrint → 按鈕點下去 iOS 彈出 App Store 但體驗差 | 上手挫折 | P2 | ✅ SOP 教學／落地頁預先偵測 |

**P0 未緩解 = 不得上 prod**（CLAUDE.md R17）。目前 F1、F3 兩個 P0 都尚未 close：F1 待實測、F3 需在實作時明確用「單筆分享」而非 EVERYONE 唯讀。

## 8. 建議話術（會前）

> 方案技術路徑清楚，但**成敗卡在 WePrint 有沒有 `weprint://` scheme 這件事查不到官方規格**。開會前拿一支手機 30 秒實測就知道 —— 通了就 1–2 天可上；不通就採備案 A（下載 PDF → iOS 分享 → WePrint，5 步變 3 步，零開發）先解痛點、再評估要不要換 App／換印表機做長期方案。

## 9. 開放問題（OQ）

| ID | 問題 | 誰答 |
|---|---|---|
| OQ-WP-1 | WePrint 是否支援 URL Scheme？param key 命名？ | 現場實測 or 聯繫上海唯典 |
| OQ-WP-2 | 客戶群裡 iOS vs Android 比例？備案優先序影響 | 客戶端 |
| OQ-WP-3 | 收據上有無敏感欄位（單價、成本、供應商聯絡）不宜出現在訪客連結？ | 客戶端 + 業務 |
| OQ-WP-4 | 若換印表機 App，客戶接受度？是否已投資特定型號硬體？ | 客戶端 |

## 附錄：參考資料

- [Ragic：以動作按鈕前往不同網址](https://www.ragic.com/intl/zh-TW/doc-kb/157/)
- [Ragic：分享這筆資料](https://www.ragic.com/intl/zh-TW/doc-user/51)
- [Ragic：存取權限（訪客／EVERYONE）](https://www.ragic.com/intl/zh-TW/doc/32/access-rights)
- [WePrint App on App Store](https://apps.apple.com/tw/app/weprint-app/id1101579363)（無 URL Scheme 說明）
- [Web Bluetooth Receipt Printer（備案 C 參考）](https://github.com/NielsLeenheer/WebBluetoothReceiptPrinter)
