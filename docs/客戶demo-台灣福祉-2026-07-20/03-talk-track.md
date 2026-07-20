# 60min demo talk track · 台灣福祉

> **場合**：60 min 會議 · 你（業務端）present · sandy + 決策 stakeholder 參加
> **輔助**：帶 laptop · pre-open `output/台灣福祉-改裝群.html` + 這份 talk track + `05-sam-concept.md`
> **原則**：不 slide dump · 邊 demo 邊講故事 · **講他們自己行業的 case**（車輛改裝、沐浴車、消防法規）

---

## Part 0 · 開場 · Pain framing（3 min）

**開場一句**（不 slide · 面對面問）：
> 「王總 / sandy · 我先問一個問題 —— 你們業助阿豪、每週花多少小時整理 LINE 群訊息、抄成日報？」

**等他們回答**（通常會回 5-10 hr 或「沒特別算過」）

**然後接**：
> 「我們今天要展示的 · 就是**這個時間 AI 幫你們省掉**、+ 順便把 LINE 對話變成三件事：
>   1. 自動日報（Ragic 填單）
>   2. KM 知識庫（未來可查）
>   3. 業務戰情室（客戶跟催 / 業績歸戶）
> 60 分鐘 · 分三段展示、然後定價 · 有問題隨時打斷。」

---

## Part A · Value 1 · AI 對話分析（日報自動化）· 15 min

**動作**：打開 `output/台灣福祉-改裝群.html`

**Talk（逐段講）**：

1. **樣本背景**（1 min）：「這是**你們自己的行業 mock**（車輛改裝、沐浴車、升降機）· 34 訊息 · 兩天 · 內部改裝群」
2. **AI 抽出什麼**（3 min）：滑到 daily_reports 段 · 「AI 抽出 **9 筆結構化日報** · 有工時 / 工位 / 改裝案號 / 記者 / 備註 · 直接可匯入 Ragic」
3. **具體 case walk**（5 min）：
   - 「看這筆：阿源 07/02 · 輪椅升降機水平調校 2.5h · 這是 AI 從一則 LINE 訊息抽的 · **記者對到 P-02 王○○ · 工位 ST-01 升降機組**」
   - 「再看：阿源同一則訊息裡有『另斜坡板焊接 1.5h』· **AI 拆成第 2 筆日報**（machine_code ST-03 車體焊接組）· 這是 human 也會漏拆的」
4. **Metric 秀**（5 min · 開 `02-metric-report.md`）：
   - 「我們手工 label 這批：**訊息分類 90-95% 準確 · event chain 85% 完整度 · 實體對應 93%**」
   - 「跨天 event chain 會斷（鋼索下單 07/02 / 到貨 07/03 拆成兩筆）· 這是**需人工修 15% 的部分**」
   - 「省時：業助手抄 20-30 min · AI 90 秒 · **20-30 倍**」
5. **Take-away**（1 min）：「業助不用手抄 · 只要 confirm 對錯」

---

## Part B · Value 2 · KM 追蹤（records event chain）· 15 min

**動作**：滑到 records 段（同 HTML）

**Talk**：

1. **framing**（1 min）：「除了日報 · AI 還從對話裡抽了 **11 筆事件記錄** · 這是**未來查得到的 KM**」
2. **KM case 1 · 維修事件**（4 min）：
   - 「records[0] 示範車號 A 輪椅升降機鋼索斷裂 · 4 訊息合成 1 筆 · 有現況 + 處理過程 + 結果」
   - 「6 個月後有台車也是升降機問題 · 直接查『鋼索』**這筆立刻跳出** · 不用翻歷史 LINE」
3. **KM case 2 · 法規知識**（4 min）：
   - 「records[4] 消防安全法 §11 · 到宅沐浴車高壓閥位置向上調 15 公分 · 家豪研發員說『這批都要改』」
   - 「這是**藏在 LINE 沒沉澱的關鍵知識** · AI 抽出來 · 未來新進員工訓練直接查」
4. **KM case 3 · 研發討論**（3 min）：
   - 「records[9] 升降機馬達選型 · 家豪跟原廠討論完 · 高頂車體建議大扭力款」
   - 「這種**設計決策**通常沒人記 · AI 幫你留下」
5. **對比**（2 min）：
   - 「若沒 AI · 6 個月後要找『鋼索問題誰處理過』· 翻 3 個月群組**至少 20 min** · 有 AI 秒查」
6. **Take-away**（1 min）：「LINE 對話 = 你們的**隱形知識庫** · AI 幫你顯性化」

---

## Part C · Value 3 · SAM 業務追蹤（8 模組全景）· 15 min

**動作**：打開 `05-sam-concept.md` · 秀 SAM 8 模組地圖（或畫在白板）

**Talk**：

1. **framing**（2 min）：「前面 A/B 是**業助端 + KM 端** · 這段講**業務端**（老闆和業務主管在意的）」
2. **SAM 8 模組 walk**（10 min · 依 `05-sam-concept.md`）：
   - ① 客戶地圖：地理視覺化 · ABC 分級
   - ② 客戶列表：可搜尋 / 篩選
   - ③ 銷售業績統計：長條圖 / KPI 卡
   - ④ 聯絡人管理：LINE 綁定 / 業務代表指派
   - ⑤ 業務員通訊管理：LINE Channel 新增 / 憑證設定
   - ⑥ 互動 Timeline：LINE 訊息摘要按客戶 / 業務代表 / 日期
   - ⑦ 市場觀察：AI 每日快報
   - ⑧ 我的 LINE 助手：聊天 / 排程 / 聯絡人 / 名片辨識 / 行程看板
3. **未來擴展**（2 min）：「今天講的**對話分析 KM** 將是 SAM **第 9 模組** · 融入現有介面 · 業助不學新工具」
4. **Take-away**（1 min）：「這是完整平台 · 不是單一工具 · 你們一次拿到業助 + KM + 業務追蹤三價值」

---

## Part D · 定價 & CTA（5 min）

**Talk**：

1. **試水（Pilot）**：
   - 「一次性 **NT$10-30k**（依對話量調整）· 我們分析你們**真實 1-2 週對話** · 產跟今天看的一樣的 HTML report + metric 表」
   - 「這是**你們自己的資料** · 不是 mock · 真實 metric 我方負責告訴你們」
2. **繼續**：
   - 「若 metric 滿意 · 訂閱 **NT$5k/月** continuing · 每天/每週自動 sync + 進 Ragic + 進 KM 庫」
   - 「或併入 EEA 超級平台整套 offering（含 SAM 8 模組）· 定價另談」
3. **保障**：「**3 個月試用不達標 refund** · 我方吸收 R&D 成本」
4. **下一步**：
   - 「今天決定 pilot 我們**兩週內**開始 · 需要你們指定 1-2 個 LINE 群授權 export 給我方分析」
   - 「不決定也 OK · 我們兩週後 follow up」

---

## Part E · Q&A（7 min）

見 [`04-qa-preparation.md`](04-qa-preparation.md)

未預備的 Q 誠實答「回去查再回」· **不猜**。

---

## Timing 檢查表

- [ ] Part 0 開場 3 min（不超過 5 min · 不然壓縮 Q&A）
- [ ] Part A 15 min（若 stakeholder 提問多 · 壓到 12 min）
- [ ] Part B 15 min
- [ ] Part C 15 min（SAM 概念性強 · 可壓到 10 min）
- [ ] Part D 5 min（**不要跳過** · CTA 是會議目的）
- [ ] Part E 7 min（保留 · 客戶問越多越好）

**Backup 時間**：若某段超時 · Part C 可壓最快（純概念）· Part A/B 是核心不能壓
