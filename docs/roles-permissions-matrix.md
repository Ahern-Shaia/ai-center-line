# 身份權限矩陣 · ai-center-line

> 4 role × 全模組權限對照 · 這是實作權限 gate 的 source of truth。
> 任何 backend `@Roles` / frontend `canView / canEdit` 決定 · 都對照本檔。
>
> 版本：v1.0（2026-07-23）
> 對應 memory：[feedback_only_aiproot_creates_tenant_accounts.md](../memory/) v2（本檔取代舊 v1）

---

## 0. 為什麼需要這份矩陣

之前實作 depts/members 時 · 整個 stack（backend `@Roles` + frontend gate）都**只給 aiproot** · tenant_admin 進系統看不到部門/成員頁 · 只能請 aiproot 手動代辦。

用戶在 2026-07-23 對話明確指出**這不合理** · 部門/成員屬客戶方自治範圍 · 應交還 tenant_admin。

本矩陣是**權責重新分配後的 authoritative 版本** · 落地時對照。

---

## 1. 4 種角色定義

| 角色 | 誰用 | scope | 主要職責 |
|---|---|---|---|
| **`aiproot_admin`** | aiproot 平台方員工 | 跨全部租戶 | 開通新客戶 / 管 LINE Bot 技術面 / 管 AI 成本 / 稽核 |
| **`consultant`** | aiproot 派給客戶的顧問 | 跨全部租戶 | 只讀 · 給諮詢建議 · 不動系統 |
| **`tenant_admin`** | 客戶公司總經理室 / 管理層 | 該租戶內 | 管自己公司部門 + 員工 + 看戰情室 · 建部門主管帳號 |
| **`group_owner`** | 客戶公司部門主管 | 該部門內 | 看自己部門任務 · 簽核 · 看部門日報 |
| **`employee`** | 一般員工（v2 加）| 自己 | 只看/送自己的日報 · 用 LIFF 或 web LINE 登入 |

**特殊路徑**：
- 員工（Alice）自服務綁定：透過 LIFF 綁定自動建 `users` 記錄 · role=`employee`（v2 · 舊 group_owner 已透過 migration 0020 遷移）
- 員工 web 登入：用「以 LINE 登入」（LINE OAuth · 對照 user_line_binding · 免密碼）

---

## 2. 帳號建立權限（誰可以建誰）

| 建立者 → | `aiproot_admin` | `consultant` | `tenant_admin` | `group_owner` | 員工（LIFF）|
|---|:-:|:-:|:-:|:-:|:-:|
| **aiproot_admin** 可建 | ✅ | ✅ | ✅ | ✅ | — |
| **consultant** 可建 | ❌ | ❌ | ❌ | ❌ | — |
| **tenant_admin** 可建 | ❌ | ❌ | ❌ | ✅（限自 tenant）| — |
| **group_owner** 可建 | ❌ | ❌ | ❌ | ❌ | — |
| **LIFF 自服務** | — | — | — | ✅（限自己一位）| ✅ |

**規則說明**：
- **aiproot_admin 全能**：因是平台方 · 開通新客戶要建 tenant_admin
- **tenant_admin 只能建 group_owner**：部門主管是 tenant 內部人事 · 客戶自治
- **tenant_admin 不能建 tenant_admin**：避免客戶內部政治鬥爭 · 統一由 aiproot 建才有客觀第三方紀錄
- **員工 LIFF 綁定** = 自服務建自己一筆 users（role=group_owner v1）· 不佔上表「誰建誰」的空格

**密碼 rotate**：一律走 aiproot（`aiproot_admin`）· 或 forgot-password self-service flow · **tenant_admin 不能替下屬重置密碼**（避免濫用）。

---

## 3. 模組權限矩陣

### 3.1 戰情室（Warroom）

| 功能 | `aiproot_admin` | `consultant` | `tenant_admin` | `group_owner` |
|---|:-:|:-:|:-:|:-:|
| 總覽儀表（三環）| 👁 (選 tenant) | 👁 (選 tenant) | 👁 | 👁 (自部門) |
| 每日簽核 · 部門聚合 | 👁 | 👁 | ✅ | ✅ (自部門) |
| 任務看板 Kanban | 👁 | 👁 | ✅ | ✅ (自部門) |
| 單筆簽核 | ❌ | ❌ | ✅ | ✅ (自部門) |
| 今日日誌 | 👁 | 👁 | 👁 | 👁 (自部門) |
| 我的日報（自己）| ❌ | ❌ | ✅ | ✅ |

**RLS scope**：
- aiproot/consultant · 全 tenant · 前端加租戶選擇器
- tenant_admin · 該 tenant 全部（`current_tenant` 匹配）
- group_owner · 該部門（`p_tickets` 加 `current_department`）

### 3.2 資料 · 知識

| 功能 | `aiproot_admin` | `consultant` | `tenant_admin` | `group_owner` |
|---|:-:|:-:|:-:|:-:|
| 智慧檢索 RAG | 👁 | 👁 | ✅ | ✅ (自部門) |
| 素材看板 | 👁 | 👁 | ✅ | ✅ (自部門) |
| 知識庫 | 👁 | 👁 | ✅ | 👁 (自部門) |
| 客戶地圖 | 👁 | 👁 | ✅ | ✅ (自部門) |

（v1 mock 階段 · 實作時對齊）

### 3.3 AI 對話分析

**⚠️ 這組屬 aiproot 平台方維護 · 對 tenant 不可見**（Shell.tsx `roles: aiproot_admin, consultant`）

| 功能 | `aiproot_admin` | `consultant` | `tenant_admin` | `group_owner` |
|---|:-:|:-:|:-:|:-:|
| 分析列表 | 👁 | 👁 | ❌ | ❌ |
| 上傳新對話 | ✅ | ❌ | ❌ | ❌ |
| 分析詳情 | 👁 | 👁 | ❌ | ❌ |
| 語言模型設定 | ✅ | 👁 | ❌ | ❌ |

**原因**：tenant 只看戰情室的最終結果（分析後材料化的 tickets / 日報）· pipeline 內部細節屬 aiproot 平台責任。

### 3.4 通訊接頭層

**⚠️ aiproot 平台方管理 · tenant 不可見**（Shell.tsx `roles: aiproot_admin, consultant`）

| 功能 | `aiproot_admin` | `consultant` | `tenant_admin` | `group_owner` |
|---|:-:|:-:|:-:|:-:|
| LINE Bot 列表 | 👁 | 👁 | ❌ | ❌ |
| Bot CRUD（channel_secret / access_token）| ✅ | ❌ | ❌ | ❌ |
| Bot 遷移到別 tenant | ✅ | ❌ | ❌ | ❌ |
| Bot 群組列表 | 👁 | 👁 | 👁 (自 tenant) | ❌ |
| **群組分派到部門**（`line_group.department_id`）| ✅ | ❌ | **✅**（自 tenant）| ❌ |

**變更點**：**群組分派到部門** 從「僅 aiproot」開放給 `tenant_admin`。因分派是**業務決策**（哪個群屬哪部門）· 屬 tenant 自治。Bot 技術面（channel secret / token）保留 aiproot（涉及 LINE Developer Console）。

**實作**：`server/src/line-ingest/line-group.controller.ts` 的 `@Roles` 需加 `tenant_admin`（分派 endpoint）。列表 endpoint 保留現況（tenant_admin 已可看自 tenant 的）。

### 3.5 設定

| 功能 | `aiproot_admin` | `consultant` | `tenant_admin` | `group_owner` |
|---|:-:|:-:|:-:|:-:|
| **部門 CRUD**（Departments）| ✅ | 👁 | **✅**（自 tenant · 新開）| ❌ |
| **成員 CRUD**（Members）| ✅ | 👁 | **✅**（限建 group_owner · 新開）| ❌ |
| **成員 role change** | ✅ | ❌ | ✅（限自 tenant 內 group_owner ↔ 停用 · **不可**升 tenant_admin）| ❌ |
| **密碼 rotate** | ✅ | ❌ | ❌（走 aiproot or forgot-password）| ❌ |
| 租戶設定 | 👁 | 👁 | ✅ (自 tenant) | ❌ |
| 稽核記錄 | 👁 (跨) | 👁 (跨) | 👁 (自 tenant) | ❌ |
| 自己 profile（display_name 等非核心欄位）| ✅ | ✅ | ✅ | ✅ |

**變更點**（本次修正 · 逆轉舊 rule）：
- **部門 CRUD**：tenant_admin 開放
- **成員 CRUD**：tenant_admin 開放 · **限建 group_owner**（不可建 aiproot_admin / consultant / tenant_admin）
- **成員 role change**：tenant_admin 可停用 group_owner · 但**不可升為 tenant_admin**

**Backend 需三重保障**：
1. `@Roles` 加 tenant_admin
2. Zod schema · POST body 中 `role` 欄位 · tenant_admin caller 只能傳 `group_owner`（backend 校驗）
3. RLS 已限自 tenant（`users` policy）

**Frontend `ASSIGNABLE_ROLES`**：
- aiproot_admin caller：`[aiproot_admin, consultant, tenant_admin, group_owner]`
- tenant_admin caller：`[group_owner]` 只 · 下拉不列其他

### 3.6 AIPROOT 管理

**⚠️ aiproot 平台方獨有 · tenant 完全不可見**

| 功能 | `aiproot_admin` | `consultant` | `tenant_admin` | `group_owner` |
|---|:-:|:-:|:-:|:-:|
| 開通新租戶 wizard | ✅ | ❌ | ❌ | ❌ |
| AI 成本管理 | 👁 | 👁 | ❌ | ❌ |
| 對話分析歷程 | 👁 | 👁 | ❌ | ❌ |
| **手動觸發 batch** | ✅ | ❌ | ❌ | ❌ |
| LINE 綁定稽核 | 👁 + 撤銷 | 👁 | ❌ | ❌ |
| **撤銷 employee 綁定** | ✅ | ❌ | ❌ | ❌ |
| 分類管理（rename / archive）| ✅ | 👁 | ❌ | ❌ |

### 3.7 系統路徑（無 role · scheduled / webhook）

| 功能 | 觸發者 | scope |
|---|---|---|
| LINE webhook 接收 | HMAC 驗證 · 無 role | 依 destination 找對應 bot |
| Cron：每日 08:00 batch 掃描 | 系統 | tenant.batch_enabled=true |
| Cron：每日 09:00 nudge 掃描（未綁員工）| 系統 | 全 tenant |
| Cron：每日 17:30 個人日報生成 | 系統 | 全綁定 user |
| Materialize records→tickets | 系統（analyze upload done 觸發）| upload 所屬 tenant |
| Personal report notify 主管 | 系統（送出時 fire-and-forget）| 該員工部門主管 + tenant_admin |

---

## 4. 資料存取 scope（RLS）

### 4.1 每張表的 RLS 決策層

| 表 | aiproot_admin | consultant | tenant_admin | group_owner | system |
|---|:-:|:-:|:-:|:-:|:-:|
| `tenants` | ✅ 全 | ✅ 全 | ✅ 自 | ❌ | ❌ |
| `users` | ✅ 全 | ✅ 全 | ✅ 自 tenant | ❌ | ❌（❗需補）|
| `departments` | ✅ 全 | ✅ 全 | ✅ 自 tenant | ✅ 自 tenant | ❌（❗需補）|
| `tickets` | ✅ 全 | ✅ 全 | ✅ 自 tenant | ✅ 自部門 | ✅ |
| `line_bot` | ✅ 全 | ✅ 全 | ❌ | ❌ | ✅ |
| `line_group` | ✅ 全 | ✅ 全 | ✅ 自 tenant | ✅ 自部門 | ✅ |
| `line_message` | ✅ 全 | ✅ 全 | ✅ 自 tenant | ✅ 自部門 | ✅ |
| `line_member` | ✅ 全 | ✅ 全 | ❌ | ❌ | ✅ |
| `user_line_binding` | ✅ 全 | ✅ 全 | ❌ (v1) | ✅ 自己 | ✅ |
| `analysis_upload` | ✅ 全 | ✅ 全 | ❌ | ❌ | ✅ |
| `analysis_result` | ✅ 全 | ✅ 全 | ❌ | ❌ | ✅ |
| `category_registry` | ✅ 全 | ✅ 全 | ✅ 自 tenant | ❌ | ✅ |
| `personal_daily_report` | ✅ 全 | ✅ 全 | ✅ 自 tenant | ✅ 自部門 + 自己 | ✅ |

### 4.2 待補的 RLS 差距

**❗ 標記處**（`system` 讀寫 users / departments 有 gap）：
- **p_users 不允 system role**：webhook 觸發的 INSERT users（LIFF 綁定 completeLiffBinding）走 `withTenant + tenant_admin` 兩階段 workaround（已於 employee-binding.service.ts 處理）
- **p_departments 不允 aiproot_admin / system**：跨租戶讀部門需走 line_bot lookup → tenant_admin 上下文（materializer 已用相同 pattern）

**未來 migration 建議**：把 `system` / `aiproot_admin` 加進 p_users / p_departments（對齊 0011+ 遷移 pattern）· 現階段 workaround OK。

---

## 5. UI 呈現規則

### 5.1 Sidebar 過濾（Shell.tsx `NAV`）

| Section | 誰看得到 | 備註 |
|---|---|---|
| 戰情室 | 全 | 戰情室 tab / 簽核 / 我的日報 · role-based scope 內容 |
| 資料 · 知識 | 全 | 已 role-based |
| AI 對話分析 | **僅 aiproot_admin + consultant** | 已 `roles:` gate |
| 通訊接頭層 | **僅 aiproot_admin + consultant** | 已 `roles:` gate |
| 設定 | 全 · **變更後 tenant_admin 可用 depts/members**（本次修正）| 現況 gate 未擋 · 但 `depts` 頁內部 canView 擋掉 tenant_admin · **需改** |
| AIPROOT 管理 | 僅 aiproot_admin + consultant | 已 `roles:` gate |

### 5.2 頁面內 canEdit（e.g. 部門/成員頁）

```typescript
// 修正後的 canEdit 邏輯
const canView = session.role === "aiproot_admin"
             || session.role === "consultant"
             || session.role === "tenant_admin";     // ← 新開

const canEdit = session.role === "aiproot_admin"
             || session.role === "tenant_admin";     // ← 新開 · consultant 只讀

// Tenant selector
const canSwitchTenant = session.role === "aiproot_admin"
                     || session.role === "consultant";
// tenant_admin 自動用 session.tenant_id · 不顯下拉

// ASSIGNABLE_ROLES (成員 role 下拉)
const ASSIGNABLE_ROLES = session.role === "aiproot_admin"
  ? ["aiproot_admin", "consultant", "tenant_admin", "group_owner"]
  : session.role === "tenant_admin"
    ? ["group_owner"]                                // ← 新開 · 僅限
    : [];
```

---

## 6. 實作 checklist（本次修正）

### 6.1 Backend

- [ ] `server/src/tenant-admin/department.controller.ts` · `@Roles("aiproot_admin")` 加 `tenant_admin`（POST / PATCH / DELETE）
- [ ] `server/src/tenant-admin/user.controller.ts` · `@Roles` 加 `tenant_admin`（POST / PATCH · 限制 role 只可傳 group_owner）
- [ ] `server/src/tenant-admin/user.service.ts` · 建帳號時檢查 caller.role · 若 tenant_admin · body.role 必須為 `group_owner`
- [ ] `server/src/tenant-admin/dto/user.dto.ts` · Zod schema 加 role 校驗（可用 discriminated union 或 refine）
- [ ] `server/src/line-ingest/line-group.controller.ts` · 分派 group→dept 的 endpoint · `@Roles` 加 `tenant_admin`

### 6.2 Frontend

- [ ] `web/src/settings/depts-members/Page.tsx` · `canView` / `canEdit` 邏輯改 · tenant_admin 通過
- [ ] `web/src/settings/depts-members/Members.tsx` · ASSIGNABLE_ROLES 依 caller role 動態
- [ ] `web/src/settings/depts-members/Page.tsx` · Tenant selector 對 tenant_admin 隱藏（自動用 own tenant）
- [ ] `web/src/line-bots/Detail.tsx`（若有 group→dept 分派 UI）· canEdit 加 tenant_admin

### 6.3 測試

- [ ] tenant_admin 登入 · 部門/成員頁可打開 + 建部門 OK
- [ ] tenant_admin 建 member · role 只能選 group_owner · 傳 aiproot_admin 應 400
- [ ] tenant_admin 不能建 tenant_admin（backend 擋 + frontend 下拉不列）
- [ ] tenant_admin 不能改別 tenant 的部門（RLS 已擋）
- [ ] group_owner 登入 · 部門/成員頁看不到（僅 admin 級）
- [ ] aiproot_admin flow 不受影響 · 仍可跨 tenant 管

---

## 7. 附錄 · 常見情境對照

### 情境 A · 新客戶 onboard

1. **aiproot** 建 tenant「台灣福祉」
2. **aiproot** 建首位 **tenant_admin** 帳號「陳總經理」+ email 通知
3. **陳總（tenant_admin）**登入
4. **陳總** 進「部門/成員」建部門（品保部 / 業務部）+ 建 **group_owner**「王主管」
5. **aiproot** 建 LINE Bot（channel_secret / access_token）
6. **陳總 or aiproot** 進「LINE 機器人」分派群組到部門
7. AI 分析啟動 · 員工開始使用

### 情境 B · 加新部門主管

1. **陳總（tenant_admin）**登入 · 部門/成員頁
2. 建 group_owner「李主管」→ 分派到業務部
3. 系統寄 email 給李主管（含臨時密碼）· 李主管首登改密

### 情境 C · 陳總想加副總（也是 tenant_admin 級）

1. 陳總不能自建 · 需請 aiproot
2. aiproot 進「開通新租戶 → 這家客戶」加 tenant_admin
3. 建帳號後通知副總

### 情境 D · 員工 Alice 自服務綁定

1. Alice 加 bot 好友
2. 點 LIFF · 綁定
3. 系統自動建 users（role=group_owner v1）
4. Alice 不需管理員審核 · 立即可用

---

## 附錄：本文件變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-23 | v1.0 | 首版 · 逆轉舊 rule「aiproot 統包所有帳號建立」· 開放 tenant_admin 建 group_owner + 管自 tenant depts | ahern + Claude · 對話裁定 |
| 2026-07-23 | **v1.1** | **加 employee role**（migration 0020）· 修 v1 tech debt (LIFF 綁定用 group_owner 卻登不了 web 的邏輯洞)<br>· employee 只能看/送自己日報 · sidebar 只顯「我的日報」<br>· LIFF 綁定 default role 改 employee<br>· 加 LINE Login OAuth 到 web 登入頁 · 員工可用 LINE 一鍵登入 web（免密碼）<br>· 舊 @line.local email users 自動遷 group_owner → employee | ahern + Claude · 對話裁定 |
