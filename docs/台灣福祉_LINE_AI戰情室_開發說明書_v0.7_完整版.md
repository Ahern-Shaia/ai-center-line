# 台灣福祉 × Ragic × LINE AI 智慧工廠戰情室 — 系統設計文件 v0.7（完整版）

> 交付對象：技術長／工程團隊、簡報負責人。
> **本版＝v0.6 + 缺陷修正 + 三項 P0 決策拍板 + 融入計畫書設計優勢，取代 v0.6。** 保留 v0.6 的「單一系統四層角色、tickets 通用事件表、human-in-the-loop 簽核」方向並精修；補齊矛盾與缺口（雲端/地端、多模態選型、consultant 代簽、假名化/稽核、失效處理、成本、NFR、驗收）；並融入原計畫書已考慮到的設計優勢（現場痛點、冷啟動、跨訊息事件合併與 KM 知識卡片、LINE 反向問答、確認迴圈三重價值、詞庫資產、POC 實證、KPI、風險因應）。
>
> **相對 v0.6 的關鍵變更（changelog）**
> 1. 部署決策拍板：**只有服務部署在地端**；LLM 分析可用雲端，但一律吃「去識別後」內容（§三）。
> 2. 多模態逐場景選型（§3.2）：語音/知識庫索引留地端，其餘 Claude 分階。
> 3. `tickets.module_type` enum 對不齊六群組 → 改以 `department_id` 為路由主鍵（§五、§六）。
> 4. 補第六個 Agent（人資總務），五 → 六 Agent（§六、§十三）。
> 5. 新增：AI 分析核心設計（§七）、個資治理/假名化/稽核/RLS（§八）、可靠性/失效處理（§十一）、POC 成果（§十四）、KPI（§十六）、NFR（§十七）、風險因應（§十八）、驗收測試（§十九）、整合契約（§二十）。
> 6. consultant 代簽：**預設不可**，授權則強制標記＋稽核（§九）。
> 7. 全文範例假名化。

---

## 目錄
一、專案背景與商業目標　二、單一系統四層角色權限　三、部署與模型架構　四、整體系統架構與導入冷啟動　五、資料架構　六、六大群組對接與訊息路由　七、AI 分析核心設計　八、個資治理・假名化・資安　九、每日簽核防呆機制　十、戰情室前端規格與指標邏輯　十一、可靠性與失效處理　十二、多模態 RAG 與 SFT　十三、後端 AI Agent System Prompt　十四、概念驗證（POC）成果　十五、成本模型　十六、KPI 與預期效益　十七、非功能需求　十八、風險與因應　十九、驗收與測試計畫　二十、整合契約　二十一、實施藍圖　二十二、待確認事項

---

## 一、專案背景與商業目標

### 1.1 合作企業與補助
**合作企業**：台灣福祉科技有限公司——特種車輛改裝廠（復康巴士、福祉車、到宅沐浴車）。
**補助結構**：產業競爭力輔導團 措施1（AI 數位轉型，最高 42 萬）＋ 措施2（AI 人才培育 Coupon，12 萬）。系統定位為措施1 階段二「AI 工具導入」項目。

### 1.2 現場痛點
六大部門的溝通高度依賴 LINE 群組，造成資訊極度碎片化：
- 員工以自由格式在 LINE 傳日報/回報，**無法統計、無法追蹤漏交**。
- 售後維修、研發法規、採購決策散落聊天室，事後查一筆歷史記錄動輒數十分鐘。
- 老師傅的維修經驗（升降機故障根因、鋼索處理手法、預防建議）隨訊息洗版流失，**工廠隱形知識（KM）完全無法留存**。
- 管理層無法即時掌握六群組狀態，管理靠人肉爬訊息。

### 1.3 解題思路
**不改變員工既有 LINE 使用習慣**——員工照常在 LINE 打字、拍照、傳語音，由後端 AI 抓取、分析、結構化：
> LINE 六群組對話 → AI 語意分析（去識別後）→ 結構化匯流（Ragic ERP／工研院 KM）→ AI 戰情室
對員工而言，AI 不是「多一套要學的系統」，而是「**幫我把表填好的助理**」——這是降低導入阻力的核心定位。

### 1.4 變現與多租戶
包裝為標準產品，多租戶架構，License 授權管理。**目前 20 家製造業客戶排隊**，系統從第一天即以多租戶設計，不可為單一客戶寫死。Ragic 作為工廠萬用系統總台。

---

## 二、單一系統，四層角色權限

只有**一個戰情室應用**（一套前端、一套 API），依登入者 `role` 動態決定視圖與資料範圍；權限差異收斂在後端角色判斷與 DB 層過濾（§8.4 RLS），不做兩套系統。

| 角色 | 是誰 | 資料範圍 | 內容細節 |
|---|---|---|---|
| `aiproot_admin` | 系統商人員 | 跨所有租戶 | **看不到內容**，只看聚合統計（健康度燈號、補助階段、License 用量） |
| `consultant` | 導入顧問 | 僅**被指派**的租戶 | 看得到（導入輔導需協助排查）；未指派租戶回空/403 |
| `tenant_admin` | 客戶管理層（總經理室） | 僅自己租戶，跨部門彙總 | 看得到自己租戶全部內容 |
| `group_owner` | 客戶部門負責人 | 僅自己部門/群組 | 看得到自己群組內容，並可執行每日簽核 |

**關鍵差異（`aiproot_admin` vs `consultant`）**：系統商員工預設看不到任何客戶營運內容（保護機密）；顧問因需實際協助導入，在被指派範圍內享有近 `tenant_admin` 的內容存取。差異源於業務角色本質——系統商賣工具、顧問做服務——並以 DB 層物理隔離落實（§八）。

**首頁視圖**：`aiproot_admin`／`consultant` 登入先見「客戶清單」（顧問只見被指派者）；`tenant_admin`／`group_owner` 直接進自己租戶戰情室。`aiproot_admin` 即使點進某租戶，畫面仍只渲染健康度與統計，內容與簽核明細區塊**因 API/DB 本就不回傳而不存在**（非前端隱藏）。

---

## 三、部署與模型架構（P0 已決策 2026-07-03）

### 3.1 部署：只有服務部署在地端
**「地端」界定在服務與資料層**：戰情室 Web 服務、資料庫、原始媒體、語音、知識庫索引皆在地端；**LLM 分析可用雲端 API，但一律吃「去識別後」的內容**。此決策解開 v0.6「全地端」與「Claude API」的矛盾。

```
【地端 On-prem】
  戰情室 Web 服務 + DB（raw_messages / tickets / audit_log / 假名對照表 / RAG 索引）
  raw_messages → 去識別前處理（NER＋規則：人名/車號/客戶名/電話 → 佔位 token，對照表僅存地端）
  語音 → 地端 ASR（音檔不出場）｜影像 → 地端人臉/車牌遮罩｜知識庫 → 地端 Embedding 索引
        │  僅「已去識別文本 + 已遮罩圖」出場
        ▼
【雲端 Cloud LLM】Claude 分類/抽取/摘要/vision（看不到可識別個資）
        │  回傳結構化結果
        ▼
【地端】以對照表還原 token → employee_id / vehicle_id（grounding）→ 寫 tickets
```

**「資料不外流」的誠實定義（對委員的話術照此）**：*服務、資料庫、原始媒體、語音、知識庫索引皆在地端；送雲端的僅為去識別後的文本與已遮罩圖像——機敏原始資料與可識別個資不出場。* 不宣稱「完全不透過雲端 API」；此定義可驗（§十九）。日後客戶若要求更純地端，可逐群組把雲端 Claude 換為地端 SFT 模型，架構不變。

### 3.2 多模態逐場景選型
原則：品質優先用雲端 Claude（分階控成本），含生物特徵/高敏感模態（語音、知識庫索引）留地端；專門聲學任務（真·異音偵測）不假裝 LLM 做得到。

| # | 群組・場景 | 模態 | 選用模型 | 部署 | 理由 |
|---|---|---|---|---|---|
| 0 | 共用・去識別前處理 | 文字 | 地端 NER（規則＋輕量繁中模型） | 地端 | 遮人名/車號/客戶/電話 → token，為上雲前提 |
| 1 | 技術工程・報工日報 | 文字 | Claude Haiku 4.5 | 雲端 | 格式固定、抽取簡單，用最省一階 |
| 2 | 售後服務・維修工單 | 文字＋照片 | Claude Sonnet 4.6（vision） | 雲端（車牌遮罩後） | 照片↔文字因果關聯需 vision＋推理 |
| 2b | 售後・影片「異音」 | 音訊 | 地端 ASR 轉技師口述；**真·聲學異常偵測本期不做** | 地端 | 自動異音辨識為專門 ML，先靠口述＋人工，誠實標示 |
| 3 | 報工生產・進度照片 | 影像 | Claude Sonnet 4.6（vision） | 雲端（遮罩後） | 改裝進度視覺理解 |
| 3b | 報工生產・語音回報 | 音訊 | **Whisper large-v3（地端）** | 地端 | 語音含生物特徵，音檔不出場，輸出去識別逐字稿再上雲 |
| 4 | 業務一部・報價/訂單 | 文件/表格 | Claude（vision 文件理解）；地端備援 PaddleOCR | 雲端（遮客戶名後）/地端 | 繁中表格版面 Claude 強；純地端需求用 PaddleOCR＋LLM |
| 5 | 人資總務・行政/報修 | 文字 | Claude Haiku 4.5（敏感人事可切地端） | 雲端 | 分類指派為主；敏感度高時整群留地端 |
| 6 | 技術研發・KM/法規 | 長文字 | Claude 長上下文摘要 ＋ BGE-M3 embedding（地端索引）＋ 工研院 RAG | 混合 | 知識庫索引地端不外流；生成用 Claude/工研院（§二十） |

---

## 四、整體系統架構與導入冷啟動

### 4.1 系統架構
```
                 ┌───────────────────────────────────────┐
                 │  LINE 群組（六大部門，每租戶獨立 OA）      │
                 └───────────────┬───────────────────────┘
                                 │ webhook 被動接收（reply 不推播，零成本）
╔════════════════════════════════▼══════════ 地端 On-prem ═══════════════════════════╗
║  LINE Bot Server（多租戶 channel 對應）→ raw_messages（依 tenant_id 隔離）             ║
║  → 去識別前處理（NER/遮罩，對照表僅地端）→ 地端 ASR / OCR 備援 / 遮罩                    ║
║  → 每日批次 cron（冪等）                                                              ║
╚════════════════════════════════╤══════════════════════════════════════════════════╝
                                 │ 僅去識別文本 + 已遮罩圖
                     ┌───────────▼───────────┐
                     │  雲端 LLM（Claude 分階）  │ 分類＋抽取＋vision＋摘要＋信心分數
                     └───────────┬───────────┘
                                 │ 結構化結果
╔════════════════════════════════▼══════════ 地端 On-prem ═══════════════════════════╗
║  grounding 還原 → tickets（通用事件表）→ 每日簽核面板（group_owner 限定）              ║
║  → 簽核後 Outbox 同步 Ragic ／ 工研院 RAG（BGE-M3 地端索引）                           ║
║  → 單一戰情室 Web App（依 role 渲染）＋ LINE 反向問答（§7.5）                           ║
║      aiproot_admin(聚合) │ consultant(指派租戶) │ tenant_admin(單租戶) │ group_owner(單群組) ║
╚═══════════════════════════════════════════════════════════════════════════════════╝
```

### 4.2 導入與冷啟動（融入計畫書優勢）
LINE Messaging API **無法回溯 bot 加入前的歷史訊息**。導入時由客戶匯出各群組聊天記錄（`.txt`），**第一天即以歷史資料完成分類法與詞庫調校**，不需等待 1–2 週的訊息收集期。之後 bot 只負責即時流。**每廠導入週期目標 ≤ 2 週（含冷啟動）**。（本專案已具備該匯出檔解析器，見 §十四 PoC。）

---

## 五、資料架構

> 相對 v0.6 的修正以 `‹v0.7›` 標註。

### 5.1 租戶、部門、License、使用者、顧問指派
```sql
tenants        ( tenant_id PK, tenant_name, industry, onboard_status enum[洽談中/測試中/正式上線/暫停], created_at )
departments    ( department_id PK, tenant_id FK, department_name, line_group_id )   -- ‹v0.7› 群組路由主鍵
licenses       ( license_id PK, tenant_id FK, license_type enum, seat_limit int, billing_cycle, start_date, end_date, status )
               -- ‹v0.7› License 為 tenant 級；seat = 可登入 employee 帳號數；部門為使用範圍
users          ( user_id PK, tenant_id FK nullable, employee_id FK nullable,
                 role enum[aiproot_admin/consultant/tenant_admin/group_owner], line_user_id nullable )
consultant_assignments ( assignment_id PK, consultant_user_id FK, tenant_id FK, assigned_at, status enum[active/ended],
                 can_proxy_signoff boolean default false, authorized_by nullable, authorized_at nullable )  -- ‹v0.7› 代簽授權
subsidy_applications ( application_id PK, tenant_id FK, measure enum, status enum[準備中/已送件/審查中/已核准/已撥款], amount, updated_at )
                 -- 僅 aiproot_admin 可讀寫
```

### 5.2 原始訊息與同意
```sql
raw_messages   ( id PK, tenant_id FK, department_id FK, group_id, group_name,
                 user_id[假名化], message_type enum[text/image/video/file], content, media_url nullable,
                 reply_to_message_id nullable, created_at, processed boolean, opt_out boolean default false )
                 -- ‹v0.7› 移除 reply_token（1分鐘即失效，批次用不到；即時路徑另存記憶體）；新增 opt_out
consent_log    ( tenant_id FK, group_id, notice_date, notice_text, notice_version, opt_out_user_ids[] )  -- ‹v0.7› 補版本/退出
retention_policy ( tenant_id FK, raw_message_days int, media_days int )  -- ‹v0.7› 原文/媒體保存期限（到期刪原文留結構化）
```

### 5.3 主檔（grounding）與詞庫
```sql
employees      ( employee_id PK, tenant_id FK, name, line_user_id nullable, role, is_group_owner boolean )
vehicles       ( vehicle_id PK, tenant_id FK, vehicle_no, vehicle_type[復康巴士/福祉車/到宅沐浴車], customer_name )
work_orders    ( wo_id PK, tenant_id FK, wo_code, customer_name, status )
tenant_vocabulary ( id PK, tenant_id FK, term, standard_meaning, category, usage_count, source enum[manual/correction], created_at, updated_at )
                 -- ‹v0.7› source：correction_log 可回饋詞庫（§7.4）
employee_pseudonym_map ( tenant_id FK, employee_id FK, pseudo_token )  -- ‹v0.7› 僅地端，不進雲端/aiproot
```

### 5.4 通用事件表 + 簽核 + 同步
```sql
tickets ( ticket_id PK, tenant_id FK, department_id FK,               -- ‹v0.7› department_id 為路由主鍵（取代 module_type enum）
          category, summary, status, suggested_owner,
          linked_employee_id FK nullable, linked_vehicle_id FK nullable, linked_wo_id FK nullable,
          confidence enum[high/medium/low],                          -- 高信心比例儀表資料源
          confirm_status enum[待簽核/已簽核/逾時警示],                 -- 簽核完成率儀表資料源
          confirmed_by nullable, confirmed_at nullable, proxy_by nullable,  -- ‹v0.7› proxy_by：代簽者（consultant）
          sync_status_ragic enum[未同步/同步中/已同步/同步失敗] default 未同步,  -- ‹v0.7› 取代 sync_to_ragic boolean
          sync_status_itri enum[未同步/同步中/已同步/同步失敗] default 未同步,
          sync_attempts int default 0, last_sync_error text nullable,
          message_count int, created_at, updated_at )
knowledge_cards ( card_id PK, tenant_id FK, department_id FK, ticket_id FK nullable,   -- ‹v0.7› KM 知識卡片（§7.3）
          title, body, entity_tags[], source_message_ids[], indexed_to_rag boolean, created_at )
pending_review ( ticket_id FK, reason, reviewed_by nullable, reviewed_at nullable )
correction_log ( tenant_id FK, ticket_id FK, original_cat, corrected_cat, corrected_by, corrected_at )
ragic_sync_outbox ( id PK, ticket_id FK, target enum[ragic/itri], payload, attempts int, last_error nullable, created_at, done_at nullable )  -- ‹v0.7› Outbox（§十一）
```

### 5.5 稽核（‹v0.7› 新增，治理系統必要件）
```sql
audit_log ( id PK, actor_user_id FK, actor_role enum, action enum[view_tenant/view_ticket/sign_off/proxy_sign/export/assign_consultant/km_query/...],
            tenant_id, target_id nullable, result enum[allowed/denied], ip, created_at )
```

---

## 六、六大 LINE 群組對接與訊息路由

路由邏輯：`raw_messages.group_id → departments.line_group_id → department → 該部門綁定的抽取 schema 與目標 Ragic 表`。schema 綁 department，不硬編 module_type。

| # | 群組 | 抽取 schema | Ragic 表 | Agent（§十三） |
|---|---|---|---|---|
| 1 | 技術工程 | 報工日報（姓名/工時/工項） | `HR_daily_reports` | 生產報工 Agent |
| 2 | 售後服務 | 維修工單（車號/異常件/處置，多模態關聯） | `CRM_service_tickets` | 售後維保 Agent |
| 3 | 報工生產 | 改裝進度（影像/語音→備註） | `MES_production_progress` | 生產進度 Agent |
| 4 | 業務一部 | 採購/訂單（OCR→採購子表格） | `ERP_order_management` | 業務訂單 Agent |
| 5 | 人資總務 | 行政異動/設備報修（指派/追蹤） | `HR_admin_tickets` | **人資行政 Agent** ‹v0.7 補齊› |
| 6 | 技術研發 | 技術/法規長對話摘要 | 同步工研院多模態 RAG | 研發法規 Agent |

---

## 七、AI 分析核心設計（融入計畫書優勢）

這是把「破碎 LINE 對話」變成「可用結構化資料與可留存知識」的核心，五個設計是產品差異化所在。

### 7.1 主檔 grounding
抽取時以該租戶 Ragic 主檔（employees / vehicles / work_orders）作對應依據，把口語的「阿明」「那台沐浴車」「018 單」解析為 `employee_id / vehicle_id / wo_id`，而非自由生成——確保寫回 Ragic 的是可對帳的實體。（注意：送雲端前人名/車號已去識別為 token，grounding 還原在地端完成，§三。）

### 7.2 跨訊息事件合併
同一維修/生產事件常橫跨一日多則零碎訊息（報修 → 拍照 → 判斷 → 處置 → 修復）。系統以會話切分＋語意聚類，把這些訊息**合併為單筆 `ticket`**，狀態隨進展更新（open → in_progress → resolved），`source_message_ids` 保留全部來源可回溯。這解決「事後查一筆記錄要翻整天訊息」的痛點。

### 7.3 隱形知識（KM）知識卡片留存
老師傅口述的**故障根因、處理手法、預防性建議**（如「升降機鋼索半年就磨損，下次保養須以雷射對心儀重新校正」）從對話中獨立抽取為 `knowledge_cards`，帶實體標籤與來源訊息，索引進工研院 RAG 知識庫。這把「隨訊息洗版流失的隱形知識」轉為公司可累積的資產。

### 7.4 工廠專屬詞庫（可規模化資產）
台語/黑話/工廠術語（升降機、斜坡板、五油三水、FQC/IQC）→ 標準語意，存 `tenant_vocabulary`。人工簽核時的更正經 `correction_log` **回饋詞庫**（`source=correction`），越用越準。**每租戶累積專屬詞庫，是可規模化的資料護城河**——換一家客戶，底層架構不動，只需累積該廠詞庫。

### 7.5 雙軌輸出與 LINE 反向問答
- **雙軌輸出**：進度類（報工/工單/採購）走結構化 API 寫入 Ragic 表；知識類（維修經驗/研發法規）摘要成知識卡片進 RAG 知識庫。
- **LINE 反向問答**：員工可在原 LINE 群組直接提問（如「這台復康巴士上次升降機異音怎麼處理？」），bot 以 `reply`（不計費）回覆歷史處理記錄與來源。**資料流因此雙向**——員工不只是被抽取的對象，也是知識庫的受益者，這給了讓知識進系統的內在動機。（KM 查詢寫 `audit_log(action=km_query)`。）

---

## 八、個資治理、假名化與資安（‹v0.7› 新增）

### 8.1 假名化
去識別採**佔位 token（可還原）**——因 grounding 需把「阿明」對回 employee；對照表 `employee_pseudonym_map` **僅存地端、絕不隨結果進雲端或 aiproot**，其存取寫 `audit_log`。送雲端/顯示於 aiproot 的一律是 token 或聚合。

### 8.2 知情同意（state machine）
```
群組導入 → LINE 公告同意文案（記 consent_log：notice_date/text/version）
        → 成員可退出（opt_out=true，其訊息不納入分析）
        → 文案版本變更 → 重新公告
```

### 8.3 保存期限（資料最小化）
`raw_messages.content` 原文保存 N 天（建議 30–90，租戶可設）後刪除原文、僅保留結構化 tickets 與去識別摘要；媒體設 TTL。由 `retention_policy` 控。**閒聊類訊息僅分類、不留存內容**（呼應「不是監看聊天」的定位，§9）。

### 8.4 稽核與租戶隔離縱深防禦
- **全存取寫 `audit_log`**（actor/role/action/tenant/target/result）。
- **DB 層 Row-Level Security（RLS）作第二道防線**：不只 API 過濾，DB policy 依連線的 tenant_id/role 強制過濾；API 邏輯寫錯仍擋得住跨租戶查詢。
- `aiproot_admin` 在 DB 層即被限制為聚合檢視（view 只暴露 `COUNT()`/`GROUP BY`，物理上取不到 `tickets.summary`）。

---

## 九、每日簽核防呆機制（Human-in-the-loop）

**核心原則**：`confirm_status` 未轉 `已簽核` 前，資料視為草稿，不寫 Ragic（`sync_status_ragic=未同步`）、不計入正式統計。

**流程**：
1. 每日批次分析 → 依群組彙整當日新增/更新項目。
2. `group_owner` 於簽核面板展開明細，逐筆查看信心度。
3. 低信心項目標「已即時攔截」，需人工補資訊才轉正式。
4. 負責人點確認 → 該批 `confirm_status=已簽核` → 入 `ragic_sync_outbox`（§十一）。
5. 逾 24 小時未簽核 → 自動轉 `逾時警示`，戰情室紅燈，列入待複核。

### 9.1 確認迴圈的三重價值（融入計畫書優勢）
「AI 草稿 → 一鍵確認」的迴圈同時解決三件事：
1. **資料品質**：AI 錯誤/低信心在入正式系統前被人攔截，最終寫入正確率趨近 100%。
2. **導入信任**：由客戶自己的部門負責人把關，責任在客戶端，不是 AI 說了算。
3. **化解「被監控」心理阻力**：AI 定位是「幫填表的助理」而非「監看聊天」；閒聊不留存（§8.3）。這是讓一線員工願意維持既有 LINE 習慣、不抗拒導入的關鍵。

**consultant 代簽（P0 已決策）**：**預設不可代簽**。若導入初期需協助，採「代理簽核」但**強制標記 `proxy_by=consultant`、寫 `audit_log(action=proxy_sign)`、戰情室與 Ragic 皆顯示「代簽」徽章**，且需客戶一次性書面授權（`consultant_assignments.can_proxy_signoff` + `authorized_by`）。責任可追溯，把關不失真。

**LINE 端補充**：可用 Flex Message 經 `reply_token` 回覆群組（不計費），與面板同步；token 約 1 分鐘失效，過期則導引至戰情室。

---

## 十、戰情室前端規格與指標邏輯

**設計鐵律：畫面每一個數字都必須能回答「從哪張表算出來」，不接受純裝飾示意數字。** 本專案已有參考實作（`src/warroom/aggregate.ts`），由 tickets 實算出三環形指標（實跑得 33%/67%/62%）。

| 區塊 | 呈現 | 計算邏輯 | 資料表 |
|---|---|---|---|
| 本日簽核完成率 | 儀表 | 已簽核群組 ÷ 6 | `tickets.confirm_status` by department |
| 六群組整體健康度 | 儀表 | 綠燈群組 ÷ 6（狀態機見 §11.4） | `tickets` + `raw_messages.created_at` |
| 今日 AI 高信心比例 | 儀表 | `confidence=high` ÷ 當日已分類 | `tickets.confidence`（**刻意不美化**） |
| 本月維修工單 | 數字卡 | 當月 `CRM_service_tickets` 計數 | `CRM_service_tickets` |
| 知識庫累積文件 | 數字卡 | `knowledge_cards` / RAG 索引累積數 | `knowledge_cards`、RAG 索引 |
| 待人工確認 | 數字卡 | `pending_review WHERE reviewed_at IS NULL` | `pending_review` |
| 每日簽核面板 | 列表+按鈕 | 當日 `待簽核` tickets 依 department 分組 | `tickets`、`employees.is_group_owner` |
| 智慧檢索對話 | RAG 問答 | 即時檢索生成，回答標引用來源 | 向量庫 + Ragic + 原始文件 |
| 多模態素材看板 | 卡片 | 最近上傳/關聯媒體 | `raw_messages.media_url` |

**角色差異**：`group_owner` 僅自己 department 簽核且僅自己能確認；`tenant_admin` 跨部門彙總、預設不越權代簽；`consultant` 畫面同 `tenant_admin` 但僅限指派租戶；`aiproot_admin` 僅聚合統計。補助漏斗只在 `aiproot_admin` 視圖（§二）。

> 前端美學：本案採 `civic-trust` profile（暖紙白×深松綠，serif 數字，每數字掛來源表），呼應上述鐵律。三角色視圖已有資料綁定原型（`src/warroom/`）。

---

## 十一、可靠性與失效處理（‹v0.7› 新增）

### 11.1 批次冪等
以 `raw_messages.id` 為冪等鍵＋`processed` 標記＋批次 `run_id`；重跑不重複產 tickets。固定 03:00 Asia/Taipei、取單一鎖防重入、失敗自動重試 3 次後告警。

### 11.2 Ragic 同步（Outbox pattern）
簽核只做兩件事：`confirm_status=已簽核` ＋ 寫 `ragic_sync_outbox`。獨立 worker 排空 outbox、重試、更新 `sync_status_ragic`。**Ragic 寫入失敗不回退簽核**（人已把關），但 ticket 顯示「同步失敗」徽章、列待處理，杜絕「以為進 Ragic 其實沒進」的靜默遺失。

### 11.3 LLM 失效
雲端不可用 → 佇列等待或切地端小模型（依 §三方案），戰情室標「今日分析延遲」，不靜默跳過。

### 11.4 健康度燈號狀態機（可租戶設定）
```
參數：active_window=24h，overdue_window=24h，inactive_red=72h
綠：最近活動 ≤ active_window 且 無逾時 ticket 且 無低信心待簽核
黃：最近活動 ≤ active_window 且（有低信心待補 或 有待簽核未逾時）
紅：有 ticket 待簽核逾 overdue_window（逾時警示）  或  最近活動 > inactive_red（無活動）
```

---

## 十二、多模態 RAG 與 SFT 微調

**RAG**：原始文件 → 地端 Embedding（BGE-M3）/全文索引 → 向量/全文檢索 → Re-ranking → 提示工程 → LLM 精準回答（含來源標記）。知識庫索引留地端（§三）；支援 §7.5 的 LINE 反向問答與戰情室智慧檢索。

**SFT**：對地端開源模型（如 Llama 3 8B/11B）SFT，植入公司術語與標準答案，作為「逐群組把雲端 Claude 換地端」的長期選項。**對外呈現效能數字須標明「參考基準」或「本案場實測」，不可混用他案數字**（呼應 §十鐵律）。

---

## 十三、後端 AI Agent System Prompt（六 Agent，範例已假名化）

```markdown
# 角色定義
你是「台灣福祉智慧工廠 AI 大腦」，精通特種車輛改裝（復康巴士、福祉車、到宅沐浴車）
的技術、零件規格與產業法規。任務：擔任工廠六大 Agent 助手，將破碎的 LINE 對話、
照片、影片、表格，精準轉譯為 Ragic 結構化數據，並沉澱為知識庫（KM）。
（註：送入的內容已於地端去識別，人名/車號/客戶為佔位 token，回傳後由地端還原。）

# 核心運作邏輯
1. 直奔源頭：回答必須基於 Ragic 總表、歷史維修報告、零件圖紙與法規文件；
   句尾用標籤（[來源: Ragic單號]／[文件: 頁碼]）標記出處。
2. 多模態理解：文字＋異常照片＋維修影片＋數據表格，關聯成有因果的技術知識。
3. 減少幻覺：不確定嚴禁猜測，應主動追問。輸出在簽核前僅為草稿；
   confidence 必須誠實反映把握程度，不得為呈現效果系統性高估。

# Agent 職能與 Ragic 寫入規範（節錄，範例假名化）
## 生產報工 Agent
{ "table":"產線報工單", "employee_ref":"EMP_a3f9", "work_date":"CURRENT_DATE",
  "items":[{"task":"輪椅升降機水平調校","duration_hours":2.5,"status":"完成"}], "confidence":"high" }
## 售後維保 Agent
{ "table":"維修工單", "vehicle_ref":"VEH_7b21", "abnormal_component":"輪椅升降機",
  "problem_layer":"鋼索斷裂", "action_suggested":"通知採購備標準升降機鋼索並指派技師", "confidence":"high" }
## 研發法規 Agent（同步工研院 RAG）
{ "table":"研發技術KM", "technical_core":"因應消防安全法規第11條，高壓閥位置向上調整15公分",
  "sync_to_itri_rag":true, "confidence":"high" }
## 人資行政 Agent  ‹v0.7 補齊›
{ "table":"人資行政單", "type":"設備報修|行政異動", "summary":"...", "assignee_ref":"EMP_...",
  "confidence":"medium", "needs_review":true }

# 語氣與格式
- 使用正確術語（FQC、IQC、五油三水、車輛調度、升降機、斜坡板、到宅沐浴車）。
- 每筆輸出含 confidence；低信心標 needs_review:true。
```

---

## 十四、概念驗證（POC）成果

已完成端到端 prototype（LINE 匯出檔 → AI 分類抽取 → 結構化輸出 → 視覺化報告），並以**模擬工廠對話**（含台語混寫、口語、照片、多行日報，共 77 則）驗證核心能力：

| 驗證項目 | 結果 |
|---|---|
| 訊息分類覆蓋率 | 100%（零漏分類） |
| 日報結構化 | 欄位完整、數值正確 |
| 實體對應（grounding） | 暱稱→人員、口語→設備、單號簡稱自動補全，全對（§7.1） |
| 台語/黑話理解 | 經詞庫正確解析（§7.4） |
| 跨訊息事件合併 | 橫跨一日 10 則零碎訊息合併為單筆完整記錄、狀態自動標記（§7.2） |
| 隱形知識抽取 | 師傅口述預防性建議獨立留存為知識卡片（§7.3） |
| 資料誠實性 | 缺漏欄位輸出 null 不臆測；推斷值自動降信心 |
| AI 推論成本 | 約 NT$1–2／群組／日（prompt caching 命中率 100%） |

> **誠實說明**：上表為**通用製造場景的模擬資料**驗證，證明的是「分類/抽取/事件合併/KM/成本」等**能力可移轉性**；台灣福祉真實六群組（車輛改裝）資料須再校正（§十五成本、§十九驗收）。戰情室三角色視圖亦有資料綁定原型（`src/warroom/`）。

---

## 十五、成本模型（‹v0.7› 量化；數字為估算，須實測校正）

**假設**：每租戶 6 群組、每日 150–300 則訊息、每日批次一次、prompt caching 命中主檔、去識別後文本較短。

| 項目 | 估算 |
|---|---|
| 雲端 LLM／租戶／日 | ~NT$15–40（分階：日報用 Haiku、售後/vision 用 Sonnet） |
| 20 租戶／月 | ~NT$0.9–2.4 萬 |
| 地端 GPU capex | 1 張推論級 GPU（Whisper ASR＋BGE-M3 索引＋NER），一次性 |
| PoC 實測參考 | 單群組單日 ~NT$1–2（Opus 4.7＋caching） |

> 送委員前以台灣福祉真實訊息量重跑校正；效能數字標「本案場實測」或「參考基準」。

---

## 十六、KPI 與預期效益（融入計畫書優勢）

| 指標 | 基線（導入前） | 目標 |
|---|---|---|
| 日報/工單結構化率 | 0%（純文字，無法統計） | ≥ 95% |
| 日報漏交追蹤 | 無法追蹤 | 可追蹤，漏交下降 ≥ 50% |
| 查找歷史記錄時間 | 數十分鐘（人工翻訊息） | ≤ 1 分鐘（跨群搜尋/LINE 反向問答） |
| 隱形知識留存 | 0 筆（隨訊息流失） | ≥ 200 筆知識卡片／廠／年 |
| 本日簽核完成率（治理 KPI） | 無（AI 無把關） | 每日可視化，逾時自動警示 |
| 主管掌握群組狀態 | 人肉逐群爬訊息 | 戰情室單一畫面即時呈現 |
| 導入週期 | — | 每廠 ≤ 2 週（含冷啟動） |

---

## 十七、非功能需求 NFR（‹v0.7› 新增）

- **批次 SLA**：每日分析須於上班前（建議 08:00）完成，否則當日戰情室無資料。
- **可用性**：Web 應用 99.5%；批次失敗告警＋人工介入 runbook。
- **備份/DR**：DB 每日備份、異地保存；地端硬體故障定義 RTO/RPO。
- **規模**：20 租戶 × 6 群組 × ~300 則/日 ≈ 3.6 萬則/日；tickets 依 tenant_id 分區。
- **安全 hardening**：地端 OS/網路隔離、金鑰管理、最小權限、依 §八 稽核。

---

## 十八、風險與因應（融入計畫書優勢）

| 風險 | 因應設計 | 對應章節 |
|---|---|---|
| LINE API 無歷史訊息回溯 | 導入以聊天記錄匯出檔冷啟動，bot 只負責即時流 | §4.2 |
| AI 抽取錯誤損害信任 | 確認迴圈＋低信心即時攔截＋錯誤回饋詞庫 | §7.4、§九 |
| 員工抗拒「被監控」 | 不改習慣＋助理定位＋閒聊不留存 | §1.3、§9.1、§8.3 |
| 各廠用語差異大 | 每廠獨立詞庫（可規模化資產） | §7.4 |
| LINE 推播訊息費用 | 確認/問答用免費 reply，不用 push；push 量納成本監控 | §九、§十五 |
| 委員質疑「資料外流」 | 服務地端＋去識別後才上雲，定義可驗 | §三、§十九 |
| 靜默資料遺失（同步失敗） | Ragic Outbox＋重試＋同步失敗徽章 | §11.2 |

---

## 十九、驗收與測試計畫（‹v0.7› 新增；三大宣稱可當場驗）

| 宣稱 | 驗收測試 |
|---|---|
| 租戶隔離 | tenant_admin(A) 查 tenant(B) → API 與 DB RLS 皆回 403/空；aiproot_admin 查任一租戶 tickets → 只得 COUNT，取不到 summary（DB view 物理隔離） |
| AI 不幻覺/不硬寫 | 餵語意模糊訊息（無車號的「門壞了」）→ 標 low + needs_review + 攔截；未簽核前不寫 Ragic、不計正式統計 |
| 簽核 gate | 未簽核 ticket 不進 Ragic；簽核後才寫入且 audit_log 有記錄 |
| 逾時警示 | 造一筆逾 overdue_window 未簽核 → 自動轉逾時警示＋紅燈 |
| 代簽稽核 | consultant 代簽 → proxy_by 記錄、代簽徽章、audit_log(proxy_sign) |
| 資料不外流 | 抽查送雲端 payload → 人名/車號/客戶為 token、無原始媒體/語音 |

---

## 二十、整合契約（‹v0.7› 收斂 TODO）

須向對方確認並寫入合約的介面契約：
- **工研院多模態 RAG**（窗口：資通所 鄧澤宇 Fisher TENG, 03-591-2068）：技轉或 API 串接？端點/認證/請求-回應格式/索引更新頻率/**IP 與資料歸屬**/SLA/地端可用性。
- **Ragic API**：讀主檔（employees/vehicles/work_orders）與寫（各群組目標表）的端點、認證、rate limit、寫入失敗語義（配合 §11.2 Outbox）、schema 版本控管。

---

## 二十一、實施藍圖

### 21.1 初期建置（16 天 sprint）
| 階段 | 內容 | 天數 |
|---|---|---|
| Day 1 | 多租戶/License/users/RLS 權限 schema | 1 |
| Day 2-3 | LINE Bot + Webhook（六群組）+ raw_messages + 同意/去識別前處理 | 2 |
| Day 4-5 | tickets + knowledge_cards + tenant_vocabulary + audit_log + 批次 cron（冪等） | 2 |
| Day 6-7 | 地端多模態（Whisper ASR / 遮罩 / NER / BGE-M3 索引） | 2 |
| Day 8-11 | Claude 分階 prompt（分類/抽取/grounding/vision/事件合併/KM，六 Agent） | 4 |
| Day 12-13 | 每日簽核面板 + 逾時警示 + Ragic Outbox 同步 + 工研院 RAG + LINE 反向問答 | 2 |
| Day 14-15 | 單一戰情室應用，四角色視圖（同套元件依 role 渲染） | 2 |
| Day 16 | 隔離/防幻覺/簽核 gate 驗收測試（§十九）+ 端對端 | 1 |

### 21.2 產品化路線（分階段，融入計畫書優勢）
| 階段 | 重點 | 驗收 |
|---|---|---|
| Phase 1・導入與結構化 | LINE OA 導入＋冷啟動調校；日報/工單結構化；確認迴圈；Ragic 匯流 | 首批示範廠上線；結構化率 ≥ 95% |
| Phase 2・維保 KM 與問答 | 跨訊息事件合併；知識卡片；詞庫管理；向量檢索；LINE 反向問答；照片視覺 | 知識庫 ≥ 200 筆/廠；問答上線 |
| Phase 3・戰情室與規模化 | 四角色戰情室；補助漏斗；多租戶擴至排隊客戶 | 戰情室上線；擴展至排隊客戶 |

---

## 二十二、待確認事項

**P0 已決策（本版）**：① 部署＝只有服務地端、LLM 雲端吃去識別內容 ② 多模態逐場景選型 ③ consultant 預設不可代簽。

**待確認（P1/P2）**：
- [ ] License 計費細節（席位增減如何影響計費）
- [ ] 工研院 RAG 技轉/串接契約（§二十）
- [ ] 六大群組 LINE OA 由台灣福祉或 aiproot 申請管理
- [ ] 各群組簽核負責人名單與代理人
- [ ] SFT 標準答案範例準備分工
- [ ] 地端硬體規格與現場環境評估（含 GPU）
- [ ] 20 家排隊客戶導入優先序與上線排程
- [ ] 全台地理資訊圖表資料來源（台灣福祉自有 CRM，建議延後或明列來源）
- [ ] 成本以真實訊息量實測校正（§十五）
