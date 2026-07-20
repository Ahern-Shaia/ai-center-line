# Q&A 預備（5 個最可能的問題）

> **原則**：短、誠實、有 data 佐證、不 overclaim
> **未預備的 Q 答「回去查再回」** · **不猜**
> **關鍵 stakeholder 心理**：他們怕**「這東西用了之後出事誰負責」** · 你要 relax 他們

---

## Q1 · 「AI 抽錯怎麼辦？資料進 Ragic 錯了誰負責？」

**答（30 秒）**：

> 「這正是為什麼我們**設計 human-in-loop confirm** · AI 抽出來**先進 pending queue** · 業助點 confirm 才進 Ragic · 錯就 reject 不進。
>
> Metric 顯示 pilot 樣本 **10-15% 需人工修** · 大部分是 event chain 跨天斷 / person 用名字沒 map 到 code 這種邊界問題 · 不是關鍵錯。
>
> 我方在 pilot 期間**跟客戶一起 review 前 100 筆** · 確保 confirm 迴圈 UX 順 · 才 handover。」

**Key point**：講 「pending queue」+ 「confirm 迴圈」 · 讓客戶知道**AI 不直接寫 Ragic**、有人在中間 gate。

---

## Q2 · 「客戶對話裡有 PII（客戶名、電話、地址、報價）· 洩漏怎麼辦？」

**答（30 秒）**：

> 「三層保護：
>
> **1. 資料歸屬**：對話原檔存**你們的**帳號（Ragic 現況、未來自建平台）· 我方**不保留副本超過 30 天**（pilot 分析完 30 天內刪）。
>
> **2. AI 呼叫**：對話送到 Anthropic API 分析 · Anthropic 有 data policy 不拿去訓練模型 · 我們可提供合作合約條款。
>
> **3. 傳輸加密**：HTTPS + TLS 全鏈路 · Postgres at-rest AES-256（Render 內建）。
>
> 若你們有更嚴格資安需求（例：不出台灣境內）· 我方可**本地部署**（EEA 平台支援 hybrid Cloud + Edge Gateway）。」

**Key point**：講「不保留副本」+「Anthropic policy」+ 「可本地部署」 · 三層都 addressed。

---

## Q3 · 「未來我們如果換 ERP（從 Ragic 換到 SAP 或其他）· 這套還能用？」

**答（20 秒）**：

> 「**能** · 這正是我方架構的核心設計。EEA 平台有『**ERP 接頭層 · Source Connector**』抽象 · 現在接 Ragic · 未來要接 SAP / 鼎新 / 或你們自建系統 · **只換 Connector · 上層 AI / LINE / KM / SAM 全部不動**。
>
> 這是我方**跟其他純 SaaS 對手最大差別** · 他們綁死一個 ERP · 我們設計就是要**跟著客戶走**。」

**Key point**：講「接頭層抽象」+ 「跟著客戶走」 · framing 為 differentiation。

---

## Q4 · 「多少錢？完整版 / SaaS 訂閱區間？」

**答（30 秒）**：

> 「三層定價（**pilot 級數字 · 完整版待實測後定案**）：
>
> **1. 試水 pilot**：**NT$10-30k 一次性** · 分析你們真實 1-2 週對話 · 產完整 report + metric（就是今天看的形式 · 但用你們真實資料）
>
> **2. 訂閱基本版**：**NT$5k/月** · 每天/每週自動 sync + 進 Ragic + 進 KM 庫 · 三價值都給
>
> **3. EEA 超級平台 offering**：含 SAM 8 模組 + 對話分析 + 中介資料層 + 未來換 ERP 跟著走 · **定價另議**（依貴司規模）· 目前類比市場 mid-market ERP + BI 訂閱是 NT$50-200k/月區間 · 我方可有競爭力
>
> **3 個月試用不達標 refund** · 我方吸收 R&D 成本。」

**Key point**：三層 · 講 range 不講精確 · 「refund」讓客戶降低顧慮。**若客戶壓價 · 讓 pilot 折半（NT$5-15k）不動月費**。

---

## Q5 · 「多久上線？從決定 pilot 到真的能用」

**答（30 秒）**：

> **Pilot（NT$10-30k 一次性 report）**：
>   - **決定 → 2 週** 交 report
>   - Day 1-3：你們授權 export 對話給我方
>   - Day 4-10：我方跑 pipeline + metric label + tailored report + Q&A follow-up
>   - Day 11-14：交付會議 + 決策
>
> **訂閱基本版（NT$5k/月）**：
>   - **1-2 個月上線** · 依你們業助工作流複雜度
>   - 主要時間在**串接 confirm 迴圈 UI**（業助登入 · 點 confirm）+ Ragic 寫回自動化
>
> **EEA 完整平台**：
>   - **6 個月以上** · 這是完整產品線 · 含 SAM 8 模組 · 中介資料層 · 對話分析 · KM · 業務追蹤全套
>   - Solo 開發時程 · 我們照 EEA PDF §7 拍板決策的路線走
>
> 「**先 pilot 試水** · 若滿意再決定要不要走訂閱 or 完整平台。」

**Key point**：分階段 · pilot 快（2 週）· 訂閱中（1-2 月）· 完整慢（6 月+）· 客戶自選節奏。

---

## Bonus · 未預備但可能被問

**「你們公司有幾個人做這個？」**
> 「創辦人主導 · AI-augmented 開發（Claude Code 輔助）· 產品規劃 + 工程 + 客戶對接一條龍。我方**選擇小而精** · 專注特定領域（LINE + ERP + AI 智能中介） · 不做通用平台 vendor 大而全。」

**「有其他客戶案例嗎？」**
> 「你們（台灣福祉）跟鮮勇是**首兩家 notify 客戶** · 對話分析 pilot 你們是**首發**。這代表**你們的 feedback 直接影響產品方向** · 也代表定價會**特別優惠**（首發 pilot 客戶通常給 40-50% discount 換 case study 授權）。」

**「如果我們自己用 ChatGPT 貼對話進去分析就好、為什麼要付你們錢？」**
> 「三個 ChatGPT 做不到的：**1. 主檔對應**（AI 認得 P-02 阿源 · 認得 ST-01 升降機組）· **2. 團隊 confirm 迴圈**（業助點對錯 · label 進系統學習）· **3. 進 Ragic / 進戰情室** · 不用你們手工複製貼。
>
> 個人用 ChatGPT 是 productivity tool · 我們賣的是**企業級整合方案**。」

---

## 反問客戶（引導 · 若冷場）

- 「你們業助阿豪最花時間的**單一項工作**是什麼？」（引出 pain）
- 「王總你最想從 LINE 群組看到什麼**你現在看不到的資訊**？」（引出 KM / 業務追蹤需求）
- 「如果今天有個工具能幫你們做 X · 但需要業助**每天 5 分鐘 confirm** · 你們業助願意嗎？」（測試 confirm 迴圈接受度）
