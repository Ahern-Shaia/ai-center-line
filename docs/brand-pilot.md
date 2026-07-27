# Brand Pilot — 戰情室 · observability-light

> 本檔＝戰情室後台的**設計系統實作稿**。上位規範見 `docs/frontend-design-principles.md §B0-OL`；本檔把 §B0-OL 落實成 CSS token / 元件規範 / 用法範例。動 code 改 token 前必回頭讀本檔。
>
> 對應 CLAUDE.md R16 · profile：`observability-light` · 定案 2026-07-04 · **最後更新 2026-07-27**
>
> 2026-07-27 更新內容：§5 動效全數盤點（實作 20 條動畫、原文件只記 6 條；Enter band 校正為
> 180-320ms 對齊實作）；補登定案後新增的 14 個元件家族（任務看板 V3 Signal／來源原文／今日日誌／
> 行程里程／資料表格／診斷區塊／分頁／側欄折疊／確認框／主從雙欄／排程設定／開通結果／LIFF）；
> 修正三處會誤導的舊內容（pill 命名已分三套、範例含 emoji 違反自家 avoid-list、
> 「已同步 Ragic」是不存在的功能）。

---

## 1. 識別 & 原則

### 1.1 產品定位

| 項 | 內容 |
|---|---|
| 產品 | 戰情室（LINE 群組 AI 分類 → 每日簽核 → Ragic 匯流） |
| 使用者 | 工廠 GM（tenant_admin）、群組負責人（group_owner）、顧問、AIPROOT 內部 |
| 情境 | 每天 09:00 掃六格 → 30 秒完成當日簽核 → 出問題時深挖來源 |
| 對標 | Datadog（light）· Grafana（light）· Metabase |

### 1.2 五條核心原則

1. **每個數字要能反查來源**（R11） — 儀表、抽取、簽核，每筆背後掛得到原始 LINE 訊息或工單
2. **一頁掃描 > 多頁跳轉** — daily driver 要能一頁看完六部門，深挖才用 drawer
3. **色彩帶意義，不做裝飾** — emerald / amber / rose 是「正常 / 待確認 / 逾時」的雙編碼，配燈點與 pill 文字，非單靠色
4. **AI 產出必配信心度** — 高信心 pill 綠、中信心黃、低信心紅框攔截；信心度理由可展開查
5. **警訊放在資訊旁，不藏在色裡** — 「已逾期未派工」直接寫在筆數旁，不只讓部門變黃燈就閃過

### 1.3 avoid-list（禁令 — 從 §B0-OL 落實）

- `§01 §02 §03` 章節符（期刊/藍圖排版慣例）
- 四角量測記號（`.rc tl/tr/bl/br` 藍圖繪圖語彙）
- 網格背景線（工程圖紙感）
- Mono 濫用於 label / hint / 按鈕文字（mono **只**用在數字、代碼、ratio、ticket id、路徑）
- 「Client × Vendor」共同 branding（`台灣福祉 × AIPROOT`）
- 9-11px 小字（最小 12px；sidebar group label uppercase 11px 為唯一例外）
- Purple gradient / glow / neon
- 深色區塊（本 profile 只淺色；暗色另議）
- 純 `.catch(()=>undefined)` 卡在「載入中」（三態必齊：skeleton / error / empty）
- Footer 塞 as-of / demo 警語（該資訊放頂部）

---

## 2. 色彩系統

### 2.1 Tokens（CSS 變數）

**Surface（層級由淺到深）**

| Token | Hex | 用途 | 對比 vs ink（AA 需 ≥4.5:1） |
|---|---|---|---|
| `--canvas` | `#F7F8FA` | app 背景（body） | 15.5:1 ✓ AAA |
| `--surface` | `#FFFFFF` | 卡片、drawer、tile、sidebar | 16.6:1 ✓ AAA |
| `--well` | `#F1F3F6` | 展開區、input、hover 態、code 背景 | 14.6:1 ✓ AAA |

**Line（分隔線）**

| Token | Hex | 用途 |
|---|---|---|
| `--line` | `#E5E7EB` | 主要 hairline border（AA 對 canvas 3.1:1，僅視覺分隔，不承載訊息） |
| `--line-2` | `#F0F2F5` | 次要虛線 / 淡分隔 |

**Ink（文字）**

| Token | Hex | 用途 | 對比 vs canvas |
|---|---|---|---|
| `--ink` | `#111827` | 主要文字、metric 大數字、標題 | 15.5:1 ✓ AAA |
| `--ink-2` | `#4B5563` | 次要文字、body 副標、button label | 7.4:1 ✓ AAA |
| `--ink-3` | `#6B7280` | metadata、helper、hint、time stamp | 4.7:1 ✓ AA |

**Primary（品牌 + focus）**

| Token | Hex | 用途 |
|---|---|---|
| `--primary` | `#4F46E5` | 主 button、focus ring、citation marker、Ragic 提示 |
| `--primary-2` | `#4338CA` | primary hover、active user menu link |
| `--primary-tint` | `#EEF2FF` | primary button hover 底、focus ring 光暈、tile 進度條、cite chip |

**Semantic（狀態 · 燈號雙編碼）**

| 語意 | Token | Hex | Tint | 用途 |
|---|---|---|---|---|
| 正常 / 已完成 | `--ok` | `#059669` | `#ECFDF5` | 綠燈、`✓ 已同步 Ragic` pill、指標「健康度」條 |
| 待確認 / 中信心 / 警示 | `--warn` | `#D97706` | `#FFFBEB` | 黃燈、`中信心` pill、demo banner、低信心警語文字 |
| 逾時 / 低信心 / 攔截 | `--danger` | `#E11D48` | `#FFF1F2` | 紅燈、`🛑 低信心 · 已即時攔截` pill、error state |

### 2.2 使用規則

- **禁用純黑純白** — 文字用 `--ink`（`#111827` 帶輕微藍紫調），不用 `#000`
- **hairline 不做語意** — line 只做視覺分隔；「這個部門有問題」用左邊框 3px + 燈點 + 文字，不能只變 line 顏色
- **語意色必配非色訊息**（R6 a11y）— 燈點旁必有 `HEALTH_LABEL` 文字；低信心紅框旁必有「🛑」+ 文字 `已即時攔截`
- **primary tint 是唯一漸層使用場景**（進度條、cite chip 底）— 不做任何 CSS `linear-gradient`（唯一例外：sidebar brand mark 24px 方塊 `#0F172A`，屬品牌識別）

---

## 3. 字體 & 燈號

### 3.1 字體家族

| Token | 值 | 用途 |
|---|---|---|
| `--sans` | `'Inter', 'Noto Sans TC', system-ui, -apple-system, sans-serif` | 幾乎所有 UI |
| `--mono` | `'JetBrains Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace` | 數字、ticket id、代碼、路徑、ratio、時間戳（e.g. `07/02 09:40`） |

**Mono 使用白名單**（其他一律用 sans）：
- 大數字 metric（`.tile .num` — 但要靠 `tabular-nums` 而非 mono；num 實際仍用 sans + `font-variant-numeric:tabular-nums`）
- Ticket id（`.tc-id`, `.tk-id`）
- Ragic 表名（`.tc-ragic`, `.sb-foot-ver`）
- Citation ref code（`.rag-cite-num`, `.rag-cite-meta`）
- 時間戳（LINE bubble `.lb-time`）
- 版號、路徑

### 3.2 Type scale

| 用途 | size | weight | tokens |
|---|---|---|---|
| 頁面 H1（`.pane-hdr h1`） | 20px | 700 | `letter-spacing:-.01em` |
| 品牌 wordmark（`.sb-brand-name`, `.login-brand .name`） | 14-16px | 700 | `letter-spacing:-.01em` |
| Metric 大數字（`.tile .num`） | 32px | 700 | `letter-spacing:-.02em`, `tabular-nums` |
| Metric 副（`.tile .num .pct` 百分號） | 18px | 500 | `--ink-3` |
| Section 標題（`.section h2`） | 14px | 600 | `--ink` |
| Body、button、input | 14px | 400-500 | line-height 1.5 |
| 部門名（`.so-name`, `.dept-row .name`） | 14px | 700 | `--ink` |
| Sub 副標（`.pane-hdr .sub`） | 13px | 400 | `--ink-3` |
| Helper / hint | 12-12.5px | 400 | `--ink-3` |
| Sidebar 分組 label | 11px | 600 | uppercase, `letter-spacing:.05em`, `--ink-3` |
| 時間戳、metadata mono | 10.5-11px | 400 | mono, `--ink-3` |

**行高**：body `1.5`；tight 標題 `1.2`；LINE bubble `1.5-1.6`

**tabular-nums 必用場景**：所有 metric 數字、ratio 分數（`8/13`）、時間

### 3.3 燈號規範（狀態雙編碼系統）

**燈點（`.lamp` / `.dept-row .lamp` / `.so-toggle .lamp`）**：8px 圓，配 3px 同色 tint 光暈。

| 狀態 | class | 燈色 | 光暈 | 必配文字 |
|---|---|---|---|---|
| 正常 | `.lamp.green` | `--ok` | `--ok-tint` | 「正常」/ `HEALTH_LABEL.green` |
| 待確認 | `.lamp.yellow` | `--warn` | `--warn-tint` | 「待確認」/ `HEALTH_LABEL.yellow` |
| 逾時 | `.lamp.red` | `--danger` | `--danger-tint` | 「逾時」/ `HEALTH_LABEL.red` |

**Pill**：`padding:2px 8px`, `border-radius:999px`, `font-size:11.5px`, `font-weight:600`, `tabular-nums`。

> ⚠️ 實作上有三套並存，**新做元件前先確認要用哪一套**，不要再開第四套：

| 家族 | selector | 用在哪 |
|---|---|---|
| 儀表／簽核 | `.pill` + `.ok / .warn / .danger / .review / .muted` | 總覽儀表、簽核手風琴 |
| 表格 | `.nc-pill` + `.ok / .warn / .danger / .mut / .ev / .on / .off` | 通知設定、通知紀錄、租戶管理 |
| 任務看板 | `.kb-tag`（分類）· `.kb-conf` + `.kb-conf-mid / -low`（信心度）· `.kb-over`（逾時） | 任務看板卡片 |

| 語意 | 底 | 字 | 用途 |
|---|---|---|---|
| ok | `--ok-tint` | `#065F46` / `--ok` | 高信心 / 已簽核 / 正常 |
| warn | `--warn-tint` | `#92400E` / `--warn` | 中信心 / 待確認 |
| danger | `--danger-tint` | `#9F1239` / `--danger` | 低信心 / 已鎖定 |
| review | `--warn-tint` + dashed border | `#92400E` | 已攔截需補件 |
| muted | `--well` | `--ink-3` | 無資料 / 無待簽 |
| **逾時（實心例外）** | `--danger` 實底 | `#fff` | **只有逾時用實心** —— 它是唯一需要「跳出來」的訊號 |

### 3.4 燈號 vs pill 分工

- **燈** = 部門/群組**整體**健康狀態（一個部門一顆燈）
- **Pill** = 單筆 ticket 的**信心度 / 狀態**（一筆一 pill；一部門可有多 pill）
- 燈壞 → 一定要有「為什麼」的說明文字（不能只靠色）
- **Pill 一律色 + 文字**，而且**不用 emoji**（§1.3 avoid-list）。範例：`高信心`、`已簽核`、`逾時 5 天`
- **不要標「已同步 Ragic」** —— 目前沒有 Ragic 同步功能、資料也沒有這個欄位。
  在畫面上放一個系統做不到的狀態＝假訊號（2026-07-27 做 V3 卡片時的裁定，見 `design-research-taskboard.md` §5）
- **雙編碼要三重**：色 + **形** + 字。只靠顏色的話色盲與黑白列印分不出來
  （信心度用 `◆` 菱形 `.kb-conf-d`、欄位狀態用 `●` 燈點 `.kb-dot`、卡片用左側色條 `.kb-stripe`）

---

## 4. 元件 & Token

### 4.1 Shape / Spacing / Elevation

| Token | 值 | 用途 |
|---|---|---|
| `--r-sm` | 4px | 極小圓角（code 標籤、id chip） |
| `--r` | 6px | 一般圓角（button、input、pill、tile 內元素） |
| `--r-lg` | 8px | 大元件（tile、drawer、card、dept-list container） |
| `--sh-sm` | `0 1px 2px rgba(17,24,39,.04)` | tile / card 靜態 |
| `--sh` | `0 1px 3px rgba(17,24,39,.08), 0 1px 2px rgba(17,24,39,.04)` | drawer / hover 抬升 |
| `--sidebar-w` | 236px | 左側導覽固定寬 |
| `--topbar-h` | 52px | 頂部欄固定高 |

**Spacing**：無 token（用 tailwind-like 邏輯直寫 px），常用 `4/6/8/10/12/14/16/20/22/26px`，避免 3px、7px、13px 這種奇數。

### 4.2 元件清單

| 元件 | selector 家族 | tokens 使用 | 用途 |
|---|---|---|---|
| **App shell** | `.app`, `.sidebar`, `.main`, `.topbar` | canvas、sidebar-w、topbar-h、line | 左 sidebar + 上 topbar + 主內容三欄 grid |
| **Sidebar 品牌** | `.sb-brand`, `.sb-brand-mark`, `.sb-brand-text` | ink、sh-sm、r | 客戶名 primary、`戰情室` sub、24px 品牌方塊 |
| **Sidebar nav** | `.sb-nav`, `.sb-group`, `.sb-link` | primary-tint (active)、well (hover) | 分組 + icon+text 導覽；未實作標 `soon` badge |
| **Topbar** | `.topbar`, `.crumb`, `.as-of` | ok (dot)、ink-2 | 麵包屑、資料截止、icon-btn、user menu |
| **Icon button** | `.icon-btn` | line、well、r | 32×32；旋轉 `.spin` 用於刷新中 |
| **User menu** | `.user`, `.user-btn`, `.user-menu` | primary-tint (avatar)、danger (登出) | 右上頭像下拉，含 name / email / role · tenant / actions |
| **Banner** | `.banner` | warn / warn-tint | 頂部訊息（demo 提醒、資料語意） |
| **Metric tile** | `.tile`, `.tile .num`, `.tile .bar` | surface、r-lg、sh-sm、primary/ok/warn | 三張大數字儀表（Datadog 風），含 mini 進度條 |
| **Section head** | `.section`, `.section h2`, `.section .hint` | ink、ink-3 | 頁面內小節分隔 |
| **Sign-off accordion（本產品核心元件）** | `.signoff-list`, `.so-item`, `.so-head`, `.so-toggle`, `.so-count`, `.so-detail`, `.so-line` | surface、well、ok-tint（done）、warn（has-low 左邊框）| 每天早上主戰場 |
| **Pill** | `.pill` + variant | 語意色 + tint | 狀態 / 信心度 |
| **Drawer** | `.drawer-scrim`, `.drawer`, `.drawer-hdr`, `.drawer-body`, `.drawer-foot` | surface、line、sh、`animation:drawer-in` | 右側滑出，Esc / scrim 點外關 |
| **Ticket card**（drawer 內單筆深挖） | `.tc`, `.tc-hdr`, `.tc-summary`, `.tc-sec`, `.tc-raw`, `.tc-extract`, `.tc-reason`, `.tc-ragic`, `.lb` | primary-tint、warn-tint、ok-tint、danger-tint | 原始 LINE + AI 抽取 + 信心理由 + Ragic 對應 |
| **Button** | `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-sm` | primary、surface、line | 主 action / 次 action / 小尺寸 |
| **Toast** | `.toast-region`, `.toast` + variant | primary/ok/warn/danger 左邊框 3px | `aria-live="polite"`；4 秒自消 |
| **Skeleton** | `.sk`, `.sk-tile`, `.sk-row` | well → line-2 shimmer | 首載入 fallback（非文字「載入中」） |
| **State** | `.state` | surface、ink-3 | error / empty；含 h3、p、action |
| **RAG chat** | `.rag-shell`, `.rag-msg`, `.rag-bubble`, `.rag-avatar`, `.rag-cite`, `.rag-cites`, `.rag-cite-card`, `.rag-followup`, `.rag-typing`, `.rag-suggestions`, `.rag-chip` | primary、primary-tint、warn-tint、well | typewriter + inline citation + follow-up |
| **Source drawer** | `.src-meta`, `.src-snippet`, `.src-note` | well、warn-tint | Citation drill-down 內文 |
| **Onboarding** | `.ob-steps`, `.ob-step`, `.ob-num`, `.ob-body`, `.ob-arrow`, `.ob-cta` | primary-tint（step num）、sh-sm | 5 步驟原理頁 |
| **Login** | `.login-wrap`, `.login-card`, `.login-brand`, `.field` | surface、sh、primary tint focus ring | 登入卡 |

> 以下為 2026-07-04 定案後陸續加入的元件（2026-07-27 補登）。
> 之前這份清單只涵蓋約一半實作，導致新做元件時容易另起爐灶。

| 元件 | selector 家族 | 用途 |
|---|---|---|
| **任務看板 · V3 Signal**（裁定 2026-07-27）| `.kanban`, `.kb-col`, `.kb-col-hdr`, `.kb-dot`, `.kb-card`, `.kb-stripe`, `.kb-tag`, `.kb-conf` + `.kb-conf-d`, `.kb-over`, `.kb-card-foot`, `.kb-who`, `.kb-avatar` | 簽核 triage 佇列。卡片左 3px 語意色條＝signal；欄首 `●` 燈點；逾時顯「N 天」量級；指派用初字圓標（底色由姓名 hash 決定，**不可隨機**，同一人每次同色）。規範見 [`design-research-taskboard.md`](modules/design-research-taskboard.md) §5 |
| **來源原文對照** | `.ts-wrap`, `.ts-toggle`, `.ts-body`, `.ts-hd`, `.ts-msg`, `.ts-msg-meta`, `.ts-note` | 任務卡抽屜內收合區塊。只列 AI 實際採用的訊息（`source_ids`），不是整天對話。取不到時要說出原因（`.ts-note`） |
| **環形儀表**（Recharts donut） | `.gauge-tile`, `.gauge-donut`, `.gauge-center`, `.gauge-num`, `.gauge-label`, `.gauge-frac` | 總覽儀表三環（簽核率／健康度／高信心）。**狀態靠環本身承載，tile 保持中性**，不要再給 tile 上語意底色。已取代舊的 `.tile .bar` 長條寫法 |
| **今日日誌** | `.dl-day`, `.dl-day-hdr`, `.dl-day-cards`, `.dl-card`, `.dl-report-item`, `.dl-quiet`, `.dl-raw` | 每天一段、每群一卡。`.dl-day-cards` 必須 `align-items:start`（grid 預設 stretch 會把空卡撐成大片空白）；當日無內容的群收成 `.dl-quiet` 一行 |
| **行程 · 里程** | `.trip-tl`, `.trip-tl-row`, `.trip-tl-badge`, `.trip-tl-place`, `.trip-list`, `.trip-row`, `.trip-km`, `.trip-detail`, `.trip-method`, `.trip-map` | 打卡時間軸 + 逐段里程 + 依據展開。地圖走 react-leaflet + CARTO light |
| **資料表格** | `.nc-tbl`, `.nc-t-name`, `.nc-t-sub`, `.nc-t-mono`, `.nc-pill`, `.nc-act`, `.nc-lnk` | 通知設定／通知紀錄／租戶管理共用。**新表格一律用這套，不要 invent `.table`** |
| **診斷區塊** | `.nc-log-diag`, `.nc-log-diag-verdict`, `.nc-log-msg` | 失敗原因要給「所以我該做什麼」的一句話結論，再列對照數字 |
| **分頁** | `.dm-tabs`, `.dm-tab` | 頁內切換（總覽儀表／任務看板／今日日誌、通知規則／通知紀錄） |
| **側欄分組折疊** | `.sb-group-btn`, `.sb-chev` | 分組可收合、狀態存 localStorage；**目前所在分組永遠展開** |
| **確認對話框** | `.cd-scrim`, `.cd-modal`, `.cd-dialog`, `.cd-title`, `.cd-body` | 取代 `window.confirm`；React Aria Modal（focus trap / Esc / scrim 關） |
| **主從雙欄** | `.tm-split`, `.tm-list`, `.tm-item`, `.tm-detail` | 租戶管理：左清單右明細；窄螢幕轉為上下 |
| **排程設定** | `.sc-row`, `.sc-row-lbl`, `.sc-row-hint`, `.sc-row-val` | 時間選擇器 + 下次執行 + 進階 cron 收合 |
| **開通結果** | `.onboard-success`, `.onboard-success-password`, `.onboard-pw`, `.onboard-warn` | 一次性密碼只顯示一次；**必須先複製才能離開** |
| **LIFF（手機端）** | `.liff-wrap`, `.liff-h`, `.liff-sub`, `.liff-group`, `.liff-note`, `.liff-explain`, `.liff-pct` | 外勤打卡／我的日報／我的行程。`.liff-explain` 用於「為什麼是 0」這類白話說明 |

> ⚠️ **觸控裝置輸入框字級下限 16px**（樣式表最後的 `@media (max-width:760px)`）。
> iOS 對 `font-size < 16px` 的輸入框會自動放大整頁且不會縮回 —— 使用者看到的是「版面跑掉、右邊被切掉」，
> 會直接判定功能壞了。這是 iOS 的門檻值，**不是設計偏好，不可為了視覺調小**。

### 4.3 元件組合規則

- **Drawer 內容不重複主頁資訊** — drawer 是深挖，不是主頁的重複 render
- **每張卡片的層級**：canvas → surface（有 border+shadow） → 內部 well/tint（區塊）→ 內部 surface（再嵌套時避免）
- **hover 態一律用 `--well`**（不用 pure grey；不改變陰影） — 除 `.rag-cite-card`（用 `--primary-tint`）
- **focus 態必見**（`:focus-visible` 2px primary outline + 2px offset）— tab 鍵導航必經之處都能看到

---

## 5. 動效

### 5.1 Easing

**唯一 easing**：`--ease: cubic-bezier(.32, .72, 0, 1)`

這是「快出慢入」曲線（fast-out slow-in），對應 Material Design 的 `emphasized decelerate`。所有 UI 動效一律用它，不做多 easing。

### 5.2 Duration bands

| 用途 | 時長 | 範例 |
|---|---|---|
| Micro（hover、focus、button 按下） | 100-160ms | `.sb-link`, `.btn`, `.icon-btn`（實作 42 處用 `.12s`）|
| Overlay 進出（scrim、menu、tooltip） | 100-180ms | `scrim-in` .12s、`menu-in` .12s、`tip-in` .12s、`cd-in` .18s |
| Enter（drawer、卡片、列） | 180-320ms | `drawer-in` .2s、`detail-in` .2s、`page-in` .22-.3s、`card-in` .28s、`so-in` .28s、`row-in` .3s、`tile-in` .3-.32s |
| Slow（進度條首載入） | 500ms | `.bar > i` |
| Loading 迴圈 | 600ms-1.4s | `spin` .6s、`typ` 1s、`sk-shim` 1.4s |

> 2026-07-27 校正：原本 Enter 寫 180-200ms，但實作的卡片／列／tile 進場是 280-320ms。
> 較大面積的元素用 200ms 會顯得突兀，實作是對的 —— 改文件對齊實作，上限拉到 320ms。
> **超過 320ms 就要有理由**（目前只有 loading 迴圈類例外）。

### 5.3 動畫清單

實作共 20 條（2026-07-27 全數盤點；原文件只記了 6 條）。

| 動畫 | 時長 | 用途 |
|---|---|---|
| `scrim-in` / `scrim-out` | .12s | 遮罩淡入淡出 |
| `drawer-in` / `drawer-out` | .2s / .18s | 右側抽屜滑入滑出（translateX 24px）|
| `cd-in` / `cd-out` | .18s / .14s | 確認對話框 |
| `menu-in` / `menu-out` | .12s / .1s | user menu 下拉 |
| `tip-in` / `tip-out` | .12s / .1s | tooltip |
| `toast-in` | .16s | toast 通知 |
| `page-in` | .22-.3s | 頁面主內容進場 |
| `card-in` | .28s | 卡片進場 |
| `row-in` | .3s | 列表列進場 |
| `tile-in` | .3-.32s | 儀表 tile 進場 |
| `so-in` | .28s | 簽核手風琴展開 |
| `detail-in` | .2s | 行程／逐段里程展開 |
| `spin` | .6s linear infinite | 刷新中 icon（**唯一不用 `--ease` 的**，旋轉用 ease 會頓）|
| `sk-shim` | 1.4s infinite | skeleton shimmer |
| `typ` | 1s infinite | RAG typing 指示 |

### 5.4 動效原則

1. **一律靠近 UI 邊緣**（drawer 從右滑、toast 從右上進）；不做中間爆炸/縮放
2. **移動距離小**（4-24px，最多）；不用 `translateX(100%)` 那種大位移
3. **不做迴圈動畫**，除非**表達 loading 狀態**（skeleton, spin, typing）
4. **不做色相過渡**。hover／focus 的 background / color / border-color 可以淡入，
   但限 **100-160ms**（實作用 `.12s`）—— 那是回饋，不是動畫
5. **不做 transform 3D、scale > 1.05**、`filter: blur/glow`
6. **`prefers-reduced-motion:reduce`** → 全域 `animation-duration:.01ms; transition-duration:.01ms` — 保功能不保效果

---

## 6. 頁面示例

### 6.1 主頁（總覽儀表）

```
[Sidebar 236px]  [Topbar 52px: 總覽儀表 · 資料截止 07/02 21:30 · ⟳ · ? · [王] gm 總經理室]
                 ┌ Pane (padding 20/24/40) ────────────────────────────────────────┐
                 │  總覽儀表                                                        │
                 │  全 6 個 LINE 群組 · 每日 AI 分類結果匯總                          │
                 │  [Banner · warn tint] 假名化案例展示 · 敏感資料不出場               │
                 │  ┌ Tile ────┐  ┌ Tile ────┐  ┌ Tile ────┐                        │
                 │  │  33 %    │  │  67 %    │  │  62 %    │                        │
                 │  │  2/6 部門 │  │  4/6 綠燈 │  │  8/13    │                        │
                 │  │ ──▓▓─────│  │ ─▓▓▓▓───│  │ ─▓▓▓▓───│                        │
                 │  └──────────┘  └──────────┘  └──────────┘                        │
                 │                                                                  │
                 │  負責人每日最終確認 · 防呆機制                                     │
                 │  ┌ signoff-list ─────────────────────────────────────────────┐   │
                 │  │● 技術工程   4 筆待簽核        [ 確認今日進度 ]  ▸           │   │
                 │  │● 售後服務   2 筆待簽核（1 筆低信心）[ 確認 ] ▾ (自動展開)     │   │
                 │  │   · 示範車號 A：升降機鋼索斷裂 · [高信心] · 查來源→          │   │
                 │  │   · 「門壞了」· [🛑 低信心 已即時攔截] · 查來源→             │   │
                 │  │   → 對應 Ragic 表: CRM_service_tickets · 可簽核 1 筆         │   │
                 │  │● 業務一部   ✓ 已由 建國 於 09:15 簽核        [已確認]  ▸     │   │
                 │  │● 技術研發   ✓ 已由 宗瀚 於 09:42 簽核        [已確認]  ▸     │   │
                 │  └────────────────────────────────────────────────────────────┘  │
                 └────────────────────────────────────────────────────────────────┘
```

### 6.2 Source drawer（任務卡「對照原始訊息」）

> 文案已於 2026-07-27 拆成兩個入口，用途不同：
> **「對照原始訊息」**＝這張卡的依據（只顯示 AI 實際採用的那幾則 · 所有主管可看）；
> **「查當日完整對話」**＝當天全部對話（仍限 AIPROOT）。
> 下圖為 v7 mockup 的原始構想，實作已簡化為抽屜內的收合區塊（`.ts-wrap` / `.ts-msg`）。

```
                                              ┌─ Drawer 580px ──────────────────────┐
                                              │ T-010 · 來源與抽取                  ✕│
                                              │ 示範車號 A：輪椅升降機鋼索斷裂 …      │
                                              │─────────────────────────────────────│
                                              │ [pill 高信心]                       │
                                              │                                     │
                                              │ 原始 LINE 對話                       │
                                              │ ┌ 07/02 09:40  阿源 ───────────────┐ │
                                              │ │ 示範車號A升降機報一下 鋼索斷裂…    │ │
                                              │ └─────────────────────────────────┘ │
                                              │ ┌ 07/02 09:42  組長-阿豪 ───────────┐│
                                              │ │ OK 淑惠幫忙叫料                  │ │
                                              │ └─────────────────────────────────┘ │
                                              │                                     │
                                              │ AI 抽取結果 [primary-tint 底]        │
                                              │  車號    示範車號 A                  │
                                              │  部位    輪椅升降機 · 鋼索           │
                                              │  症狀    鋼索斷裂 → 升降平台卡住      │
                                              │  ...                                │
                                              │                                     │
                                              │ 信心度理由 [warn-tint 左邊框]        │
                                              │  三則訊息交叉佐證…                   │
                                              │                                     │
                                              │ 簽核後同步至 [ok-tint 底]            │
                                              │  → CRM_service_tickets · 鋼索更換    │
                                              └─────────────────────────────────────┘
```

### 6.3 RAG 對話

```
[主 pane]
┌ 智慧檢索 ─────────────────────────────────────────────────────────┐
│ 跨 LINE 群組 · 工單 · 知識庫 · 工研院 RAG 的多模態問答                │
│ [Banner] 假名化案例 · 5 對預錄 Q&A 展示 grounded citation           │
│ ┌ rag-shell ────────────────────────────────────────────────┐  │
│ │                                    ┌ user bubble ─────┐   │  │
│ │                                    │ 彰化那台復康巴士… │   │  │
│ │                                    └───────────────────┘   │  │
│ │ ┌ AI bubble ─────────────────────────────────────────┐    │  │
│ │ │ 該車輛升降機於 2026-06-18 完成鋼索更換[1]。保養…[2] │    │  │
│ │ │ ─────────────────────────                          │    │  │
│ │ │ [1] WO-2506-041 · 示範車號 A 鋼索更換工單            │    │  │
│ │ │ [2] KM #0089 · 升降機保養規範 v2                    │    │  │
│ │ │ ─────────────────────────                          │    │  │
│ │ │ [warn-tint] 追問：需要我列出近三月異常紀錄嗎？        │    │  │
│ │ └─────────────────────────────────────────────────────┘    │  │
│ │                                                            │  │
│ │ 建議問題                                                    │  │
│ │ [查資料] STARIA 高頂那個標案現在誰在跟？                     │  │
│ │ [統計] 7 月改裝日報總工時多少？    ...                       │  │
│ └────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

---

## 7. 對照上位規範

- `docs/frontend-design-principles.md §A` — 普世核心（動手前對標 / a11y / ≥3 競品研究）**必過**
- `docs/frontend-design-principles.md §B0-OL` — profile 定義（本檔實作） **必過**
- `CLAUDE.md R16` — 前端設計鐵則（授權要換 profile 的唯一入口）
- `CLAUDE.md R11` — 來源可溯源（本設計的 Source drawer + RAG citation 就是 UI 落實）
- `feedback_no_generic_ai_design` — 禁 AI 感（紫漸層 / glow / 深色）已列入本檔 avoid-list

---

## 附錄：token 對應源

所有 token 見 `web/src/styles.css :root` 定義；元件實作見 `web/src/*.tsx`。改本檔時同步：

1. `web/src/styles.css` — token 值
2. `docs/frontend-design-principles.md §B0-OL` — 上位規範
3. `CLAUDE.md R16` — 版本記錄

改前跑 `web/` 型別檢查（`npx tsc --noEmit`），改後至少手測 golden path（登入 → 儀表 → 簽核 → 查來源 → RAG → onboarding → 登出）。
