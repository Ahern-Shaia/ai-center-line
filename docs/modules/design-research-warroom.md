# 戰情室前端設計研究（A5：先研究、再設計）

2026-07-02・v5 設計依據。規則：≥3 參考，各記「做對的 1–2 點＋最弱 1 點」；設計 = 贏過最強者強項＋修掉共同弱點。

## 參考對象

### 1. Evocon（OEE 監控，同領域）
- **做對的**：(a) **Shift View 班別時間軸**——生產狀態畫成小時級色帶（綠=運轉/黃=慢速/紅=非計畫停機/灰=計畫停機），現場零訓練看懂，這是工廠的時間敘事語言；(b) operator-first 的乾淨介面，幾次點擊完成操作。
- **最弱的**：資訊深度淺——時間軸告訴你「幾點停了」，但**為什麼停、誰處理、怎麼解**要去別處翻；事件背後沒有對話脈絡。

### 2. MachineMetrics（機台監控，同領域）
- **做對的**：(a) 機台磚顯示**目前狀態＋狀態持續時間**（"Idle 23m"），持續時間是比狀態本身更有行動意義的資訊；(b) 同一磚牆可切 Parts Goal / OEE / Utilization / Downtime 多視角。
- **最弱的**：整磚大面積飽和填色＋工程軟體級排印，視覺粗糙疲勞。

### 3. Tulip（前線作業平台，同領域）
- **做對的**：角色導向——「operator 和廠長要的畫面不同」，dashboard 圍繞角色決策而非圍繞資料。
- **最弱的**：no-code 自組導致視覺品質不一，無設計性格。

### 4. Grafana（監控 dashboard，鄰域標竿）
- **做對的**：(a) 敘事優先——dashboard 講一個故事、由大到小、Z 字視線、最重要資訊放左上；(b) 色彩紀律——閾值色只給「情緒讀數」，須配 pattern/形狀輔助色盲。
- **最弱的**：面板陣列同質化，每個 dashboard 長一樣，無品牌識別。

## 綜合：v5 怎麼更好（向上設計）

| 吸收 | 來源 | 我們的向上版 |
|---|---|---|
| 班別時間軸色帶 | Evocon | **時間軸上的事件可溯源**：LINE 訊息（照片/異常/日報）以形狀 marker 釘在時間軸上，點開直接看原始對話——Evocon 看得到「幾點停」，我們看得到「為什麼、誰說的、怎麼解」 |
| 狀態＋持續時間 | MachineMetrics | 機台即時狀態併入時間軸右欄（「● 運轉 41m」），不做整磚填色 |
| 廠長視角 | Tulip | 左上放 AI 晨間摘要（白話敘事），不是給 operator 的操作畫面 |
| Z 字敘事、左上最重 | Grafana | 摘要（左上）→ 時間軸（中央 hero）→ 明細（下） |

**修掉的共同弱點**：(1) 有數字沒敘事 → AI 晨間摘要；(2) 事件無脈絡 → 逐筆 LINE 溯源；(3) 排印粗糙 → craft 級字體階層（Avenir Next 幾何數字＋PingFang）；(4) 狀態靠色 → 色＋形狀 marker＋文字三重編碼（預設開啟，非 Evocon 的切換模式）。

## 落地對照（v5）
- 時間軸面板：`mockup/warroom-overview-v5.html` `.timeline`——5 機台軌道、色段、形狀 marker（●異常 ▲照片 ◆日報）、now/事件 callout、右欄即時狀態＋持續時間
- 配色：跳出 v1–v4 的綠系/黑系——暖紙白 canvas＋藍墨 ink＋鈷藍品牌色；狀態語意色維持行業慣例（綠/琥珀/紅/灰藍）
- AI 晨間摘要沿用（v3 起被驗證的意義性元素）

---

## v7 civic-trust（台灣福祉／委員簡報，2026-07-03）

**脈絡轉變**：實際客戶＝台灣福祉（福祉車改裝廠），場景＝產發署審查委員簡報。合夥人 CTO 說明書 v0.6 與委員問答準備為權威資料源（`合夥人/`）。合夥人既有原型是深藍墨+橘 AI-感風，為向上基準。

**參考（≥3，institutional/civic 領域）**：
1. **gov.uk Design System** — 做對的：極克制、內容優先、可信＞花俏、清楚的資料層級；弱點：偏冷、無品牌溫度。
2. **NHS / 現代 EHR 介面** — 做對的：狀態語意色＋文字雙編碼、密集但可讀、臨床可信；弱點：常過於工具化、缺敘事。
3. **政府白皮書／審計年報排版** — 做對的：serif 標題的權威感、來源標註（腳註/表號）、規矩表格；弱點：靜態、無互動治理迴圈。

**向上設計**：吸收 gov.uk 的內容優先＋NHS 的雙編碼狀態＋年報的來源標註可信感，補上三者共同缺的——**活的治理迴圈**（每日簽核 human-in-the-loop）與**溫度**（福祉/照護客戶性格）。落地：暖紙白×深松綠×赤土；serif 數字（環形儀表/指標）給行政份量、mono 只留代碼；每個數字掛來源表名（CRM_service_tickets/pending_review…），呼應委員鐵律「每個數字可回溯」。
- 檔案：`mockup/warroom-taiwanhomecare-v7.html`（台灣福祉 tenant_admin 視角，六大群組真實資料）

---

## v8 向上設計（以 v7 civic-trust 為基礎精煉，2026-07-03）

**問題**：v7 仍有 AI 感，最重的是**三並排環形儀表**（donut）＝頭號 dashboard 陳腔。

**參考（craft 層，≥3）**：
1. **年報／財報編輯設計**（H&FJ、CreativePro 字體指南）— 做對的：大 serif 數字＋tabular figures、數字右對齊、腳註/來源引用、大留白、「大字帶出資料故事」；弱點：靜態、無即時性。
2. **資料新聞（The Economist / FT data team）** — 做對的：先問「我想說什麼」再選圖、bullet/small-multiples 勝過單值儀表、克制用色帶註解；弱點：偏敘事、非操作介面。
3. **dashboard 反面教材彙整**（Martynas Jočys、Plecto）— 明證：donut 是「beautiful dashboard」搜尋 8 中 5 的通用陳腔；單值儀表「看似厲害實則浪費空間」，改用 bullet chart/sparkline/small multiples。

**向上設計（v8＝Governance Broadsheet）**：整個總覽變成「一份治理報告頭版」而非卡片 dashboard——
- **殺掉三環**：改「治理摘要」編輯段落，三個關鍵數字寫進句子（大 serif inline figure）＋上標腳註 ¹²³ 指向公式/來源表；右欄三條 bullet meter（水平規線填充，非 donut）＝small multiples。委員鐵律「每個數字可回溯」直接變成腳註引用。
- **單一報告頁**：一張框、內部用規線分節（§I 治理摘要 / §II 群組名冊 / §III 每日簽核 / 附錄），取代多張浮動卡片。
- **六群組名冊（register）**：規線列表＋兩位數索引＋右對齊表名/時間，取代六等分方塊。
- **線性 SVG 圖示**取代 emoji；小圓角（報告感）取代大圓角；serif 標題＋mono 資料。
- 檔案：renderTenantAdminV8（render.ts）→ output/warroom-tenant_admin-v8.html。

---

## v9 向上設計：Blueprint 工程藍圖（2026-07-03）

**關鍵反省**：重讀 `frontend-design-principles.md` §A1，發現 **v5–v8 的 civic-trust（奶油底#F6F3EC＋襯線標題＋赤土 accent）正好是文件點名的「AI 預設群集 #1」**；v8 報紙版面又踩「群集 #3」。用戶「拒絕重複配色/AI感」有據——我一直用文件明令避開的預設。

**參考（≥3，2026 配色與工程美學）**：
1. **2026 UI 配色趨勢**（IxDF/Recursion）— 做對的：冷中性 zinc/slate（帶藍調）取代通用米色、藍綠(teal)為年度趨勢、「藍是最安全＝最冒險」；弱點：趨勢文常流於清單。
2. **Blueprint/Vercel 工程格線美學**（Setproduct）— 做對的：外露量測格線＋技術標註（刻度/引線）暗示「經過驗證與思考」，Swiss grid 紀律；弱點：格線濫用會變 dev-tool 通用味。
3. **v8 自身**（報告骨架）— 做對的：數字寫進敘事＋腳註溯源、bullet meter 非 donut、單頁分節；弱點：奶油＋襯線＝AI 群集 #1。

**向上設計（v9＝Blueprint）**：吸收冷 slate 中性＋工程格線紀律＋v8 的可溯源骨架，補上三者共缺的——**領域根植**（福祉車改裝廠＝畫改裝圖紙，用工程圖語言最貼題）。落地：
- 配色全換：冷石板白 `#EEF1F4`／石墨藍黑 `#1B2733`／藍圖藍 `#2D5B8E`／訊號琥珀 `#B8791C`（僅告警）——非奶油非襯線非赤土非松綠。
- 材質：外露藍調格線底、**角落 registration 刻度框**、工程圖 **title block**（日期/產線/檢視/狀態 mono 格）。
- signature：**量測刻度儀表**（bullet bar＋四分格線＋共用 0–25–50–75–100 尺規），取代 donut/serif 數字；大數字改 mono（技術圖），與 v8 的 serif 徹底區隔。
- 狀態：outlined pill（框線非填底）＋ ▍HIGH/MED/LOW mono tag，色＋文字雙編碼（A3）。
- 檔案：renderTenantAdminV9（render.ts，自成一體 tokens）→ output/warroom-tenant_admin-v9.html。

---

## v10 向上精修（redesign-existing-projects skill 稽核 v9 → 升級，2026-07-03）

用 redesign skill 稽核 v9 blueprint，抓出仍偏通用/可升級處，逐項升級（留在 blueprint profile、不換配色、不破壞資料綁定）：
- **字體（skill #1 優先）**：Helvetica/system grotesk → **IBM Plex Sans + IBM Plex Mono**（Google Fonts；工程 DNA、辨識度高；大數字/資料/標註全用 Plex Mono，CJK PingFang）。
- **材質**：單層淡格線 → **雙尺度工程紙格線**（細 28px＋粗 84px）＋極淡 grain 疊層（fixed/pointer-events-none，紙張紋理）。
- **儀表**：共用尺規加**刻度線（tick）**＋數字對位；title block 加**製圖 meta**（SCALE 1:1 · SHEET 01/01 · REV v10 · 來源可回溯）。
- **互動狀態（§A6/§A3）**：nav/register 列/table 列 hover、primary 按鈕填色＋:active translateY、`:focus-visible` 藍圖藍 ring、transition 用 custom cubic-bezier、`prefers-reduced-motion`。
- **語意 HTML**：header/nav/main/article/section/aside/footer（原 div soup）。
- **細節**：h1 收 tracking＋text-wrap balance、內文 max-width 56ch＋text-wrap pretty、陰影加外白邊模擬紙浮起、outlined pill/mono tag 維持雙編碼。
- 檔案：renderTenantAdminV10（render.ts）→ output/warroom-tenant_admin-v10.html。v9 保留供 before/after。
