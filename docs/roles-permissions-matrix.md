# 角色權限矩陣 · ai-center-line

> 更新：2026-07-30（v2 · 重寫成 6 角色 + prod 實況 + MDA 目標）
> 資料來源：prod `role_permissions` 實查（61 條權限）· 非憑印象
>
> ⚠️ v1（2026-07-24）寫「4 種角色」已過期 —— 漏了 `assistant` / `employee`，
> 且宣稱「員工部門調整：只有 tenant_admin 可改」與實作不符（實際 aiproot-only，
> 見 §5，這正是 [`modules/member-department-assignment.md`](modules/member-department-assignment.md) 要修的）。

---

## 0. 怎麼讀

- 六個角色代號：**A**=aiproot_admin · **C**=consultant · **T**=tenant_admin（總經理室）· **G**=group_owner（部門主管）· **S**=assistant（助理）· **E**=employee（員工）
- ✅🆕 = MDA（成員部門分配）**2026-07-30 已落地**（migration 0052/0053 · commit 68a749f/05a5a5b）
- 表格內：有標代號＝該角色有此權限；空白＝沒有

---

## 1. 六種角色

| 角色 | 誰用 | 資料範圍 | 一句話 |
|---|---|---|---|
| **A · aiproot_admin** | 我司平台員工 | 跨全部租戶 | 平台全能：開通客戶、管 Bot/AI/成本、稽核 |
| **C · consultant** | 我司派駐顧問 | 跨全部租戶（多為只讀）| 給建議、看資料，不動關鍵設定 |
| **T · tenant_admin** | 客戶公司**總經理室** | 該租戶內全部 | 管自己公司的部門、成員、戰情室 |
| **G · group_owner** | 客戶公司**部門主管** | **自己部門內** | 看/簽自己部門的任務、看部門日報 |
| **S · assistant** | 客戶公司助理 | 該租戶內（限通知設定）| 只管通知規則 |
| **E · employee** | 一般員工 | **只有自己** | 看/送自己的日報與行程 |

**特殊路徑**
- 員工一律 **LIFF 自綁**產生（role=employee）· 部門 server 自動推導（見 §5）· 沒有人「手動建員工帳號」
- 員工 web 登入：主路徑「以 LINE 登入」（免密碼）· 選配「設密碼」後可 email 登入

---

## 2. 帳號建立（誰能建誰）

| 建立者 ↓ | 建 A | 建 C | 建 T | 建 G | 建 員工 |
|---|:-:|:-:|:-:|:-:|:-:|
| **A** | ✅ | ✅ | ✅ | ✅ | —（員工自綁）|
| **C** | ❌ | ❌ | ❌ | ❌ | — |
| **T** | ❌ | ❌ | ❌ | ✅（限自租戶）| — |
| **G / S / E** | ❌ | ❌ | ❌ | ❌ | — |

- **T 只能建 G，不能建 T** —— 建 T 統一走 aiproot，留客觀第三方紀錄（避免客戶內部人事互建）
- 密碼重設 / 解鎖：**aiproot only**（`users:reset-password` / `users:unlock`）· T 不能替下屬重設

---

## 3. 能力矩陣（依 prod 實況）

### 3.1 戰情室 · 營運（客戶日常用）

| 功能 | 權限碼 | A | C | T | G | S | E |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| 總覽儀表 | `warroom:view` | | | T | G | | |
| 任務看板 | `warroom-tasks:view` | | | T | G | | |
| 群組日誌 | `warroom-daily:view` | | | T | G | | |
| 簽核 · 檢視 | `signoff:view` | A | C | T | G | | |
| 簽核 · 動作 | `signoff:action` | A | | T | G | | |
| 素材 | `media:view` | | | T | G | | |
| **部門日報**（看下屬）| `personal-report:team` | A | | T | G | | |
| 我的日報 | `personal-report:mine` | | | T | G | | E |
| 我的行程 | `trips:mine` | | | T | G | | E |

> A/C 看戰情室是靠「跨租戶選 tenant」機制，不吃 `warroom:view` 這顆（所以上表 A/C 多為空）。

### 3.2 設定 · 組織（總經理自治範圍）

| 功能 | 權限碼 | A | C | T | G | S | E |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| 部門 · 檢視 | `departments:view` | A | C | T | | | |
| 部門 · 管理（自租戶）| `departments:manage-tenant` | A | | T | | | |
| 成員 · 檢視 | `users:view` | A | C | T | | | |
| 成員 · 建群組負責人 | `users:create-group-owner` | A | | T | | | |
| **成員 · 分配部門** | ✅ `users:assign-department` | A | | **T** | | | |
| **成員 · 改角色（限 員工↔部門主管）** | ✅ `users:assign-role` | A | | **T** | | | |
| **成員 · 刪除（限 員工/部門主管）** | ✅ `users:delete-member` | A | | **T** | | | |
| 成員 · 改高階角色/改 email/重設密碼 | `users:manage` | A | | | | | |
| LINE 群組 · 檢視 | `line-groups:view` | A | C | T | G | | |
| LINE 群組 · 分派部門 | `line-groups:assign` | A | | T | | | |
| 任務設定 · 檢視 | `task-config:view` | A | C | T | | | |
| 任務設定 · 排程時點 | `task-config:timing` | A | | T | | | |
| 自動化 · 檢視 | `scheduler-config:view` | A | C | T | | | |
| 自動化 · 管理（自租戶）| `scheduler-config:manage-tenant` | A | | T | | | |
| 稽核記錄 | `audit:view` | A | C | T | | | |
| 員工綁定 · 檢視 | `binding:view` | | | T | | | |

### 3.3 通知設定（助理的地盤）

| 功能 | 權限碼 | A | C | T | G | S | E |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| 通知設定 · 檢視 | `notify-config:view` | A | C | | | S | |
| 通知設定 · 管理 | `notify-config:manage` | A | C | | | S | |

> ⚠️ **assistant 的全部權限就這兩顆** —— 它是為「只管通知」設的窄角色。T 目前**沒有** notify-config（可議，見 §6）。

### 3.4 資料 · 知識 · AI 分析（多為平台側）

| 功能 | 權限碼 | A | C | T | G | S | E |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| 資料來源 | `master-data:manage` | A | C | ✅T | | | |
| 智慧檢索 / 知識庫 / 客戶地圖 | `rag:view` `km:view` `map:view` | A | C | | | | |
| 分類 · 檢視 | `categories:view` | A | C | | | | |
| 分類 · 管理 | `categories:manage` | A | | | | | |
| 對話分析 · 檢視 | `convo:view` | A | C | | | | |
| 對話分析 · 上傳 / 標註 | `convo:upload` `convo:label` | A | | | | | |
| 抽取健康度 / 分析歷程 / 完成追蹤 / 成本 | `extraction-health:view` 等 | A | C | | | | |

### 3.5 AIPROOT 平台管理（幾乎全 A）

| 功能 | 權限碼 | A | C | 其他 |
|---|---|:-:|:-:|---|
| 租戶 · 檢視 / 開通 / 管理 | `tenants:view` / `:onboard` / `:manage` | A | C（僅 view）| |
| LINE 機器人 · 檢視 / 增刪改 | `line-bots:*` | A | C（僅 view）| |
| 語言模型設定 | `llm-config:view` / `:manage` | A | C（僅 view）| |
| 地圖里程設定 | `map-config:view` / `:manage` | A | C（僅 view）| |
| 權限管理 | `roles:view` / `:manage` | A | C（僅 view）| |
| 員工綁定稽核（跨租戶）| `binding:aiproot-view` / `:aiproot-manage` | A | C（僅 view）| |

---

## 4. 資料範圍（RLS）

權限碼決定「看得到哪個**功能**」，RLS 決定「看得到哪些**資料列**」。兩者是**兩道獨立的閘**。

| 角色 | 資料範圍 | 靠什麼 |
|---|---|---|
| A | 跨全部租戶 | policy 的 `aiproot_admin` 逃生門 |
| C | 跨全部租戶（多只讀）| `consultant` 逃生門（部分表）|
| T | 自己整個租戶 | `app.current_tenant` 比對 |
| G | **自己部門** | `app.current_department`（`tickets`/`personal_daily_report` 的部門子句）|
| E | 只有自己 | `app.current_user_id` |

### 4.1 ⭐ 自訂角色的資料範圍（2026-08-21 · custom-roles v0.3 方案 A）

租戶現在可以自己建角色（設定 → 權限管理 → ＋ 建立角色）。自訂角色**只宣告「能做什麼」**，
資料範圍沿用上表六個內建角色其中之一當「**基準**」：

```
users.role     = 基準（employee / group_owner / tenant_admin）→ 餵上表的 RLS
users.role_id  = 自訂角色 → 餵權限碼
```

指派時兩欄**同一句 UPDATE 一起寫**。**35 條 RLS policy 一條都不用改** —— 這是這個設計的全部理由。

| 基準 | 租戶可選 | 為什麼 |
|---|:--:|---|
| `employee`（只看自己）| ✅ | |
| `group_owner`（只看自己部門）| ✅ | ⚠️ 指派前那個人**必須先有部門**，否則 `current_department` 是空的 → 他反而**看得到全租戶** |
| `tenant_admin`（看全公司）| ✅ | UI 明說「這個角色看得到全公司資料」|
| `assistant` / `consultant` / `aiproot_admin` | ❌ **絕不可** | 它們在 `app_is_platform_ops()` 白名單裡，而那個函式**沒有租戶條件** —— 拿來當基準等於讓租戶自製一個讀得到**所有租戶** Ragic API 金鑰的角色。DB CHECK（`0070`）＋ service 兩層擋 |

⚠️ **防提權**：建立與指派時都比對「呼叫者當下的有效權限」——
給不出自己沒有的東西（K8s RBAC 的 `escalate` / `bind` 紀律）。在 server 端擋，不靠前端隱藏。

⚠️ **權限碼擋不住跨租戶 IDOR** —— 端點若讓 client 傳 tenantId 就危險（[[pitfall-permission-code-is-not-tenant-boundary]]）。一律用 `currentTx()` 繼承上下文。

---

## 5. ⭐ MDA 改了什麼（✅ 2026-07-30 已落地）

### 5.1 現況的缺口

| 事實 | 出處 |
|---|---|
| 改成員部門的端點 `PATCH /users/:id` 要 `users:manage` | user.controller.ts:61 |
| `users:manage` **只給 A**（prod 查證）| §3.2 |
| 所以 **T（總經理）現在完全不能分配成員部門** | — |
| 但前端 `canEdit` 吃 `users:create-group-owner`（T 有）→ **T 看得到編輯/刪除按鈕、點下去 403** | Members.tsx:119 |
| v1 這份 doc 卻寫「員工部門調整：只有 tenant_admin 可改」 | ← **一直是「應該」，從沒實作** |

### 5.2 MDA 後的目標（全採建議）

| 動作 | 現在 | MDA 後 | 為什麼可以下放 |
|---|---|---|---|
| 改成員的**部門** | A only | ✅ **T 可**（新 `users:assign-department`）| 部門是**資料範圍屬性**，不是權限 → 不構成提權 |
| 改成員的**角色** | A only | **維持 A only** | 角色是**授予能力** → 提權邊界，不下放 |
| 刪除成員 / 重設密碼 | A only | **維持 A only** | 破壞性 / 敏感 |

**核心原則（站在巨人肩膀上 · K8s + custom-roles）**：
> **屬性可下放、權限不可。** 改「他的資料落在哪個部門」不改變「他能做什麼」，所以安全。
> 這是拆出 `users:assign-department`、而不是整包開放 `users:manage` 的理由。

### 5.4 ⭐ 0055：改角色 / 刪除也下放給 T（✅ 2026-07-31）

延續 5.2 的「屬性可下放、權限不可」，把兩件事再下放給 tenant_admin，但用**伺服器護欄**把範圍鎖死在「不構成提權」：

| 動作 | 權限碼 | 護欄（全在 server，不信前端）|
|---|---|---|
| 改角色 | `users:assign-role` · `PATCH /users/:id/role` | 只能 **員工↔部門主管**（DTO enum 鎖）· 目標現角色須 ∈ 員工/部門主管（碰不到 總經理室/助理/A）· 不能改自己 · 限自租戶（RLS+明驗）|
| 刪除成員 | `users:delete-member` · `DELETE /users/:id`（非 A 走護欄版）| 只能刪 員工/部門主管 · 不能刪自己 · 限自租戶 |

> 守住 v2「租戶不能自建/自升同級」：T **永遠碰不到「總經理室」這一級**。改高階角色、改 email、重設密碼仍是 `users:manage`（A only）。10 支 P0 測試（`test/tenant-admin-manage-members.test.ts`）釘住每一條護欄。

### 5.3 自動 + 手動並存（Okta / Azure 的做法）

員工部門有兩個來源，加 `department_source{auto,manual}` 讓它們不打架：
- **auto**：LIFF 綁定時系統依「最活躍的群 → 該群部門」自動推導（員工端零摩擦）
- **manual**：T 手動指派 → 標 manual → **自動推導永不覆寫它**

---

## 6. 待你裁定 / 可議

| 項 | 問題 | 我的傾向 |
|---|---|---|
| notify-config 給 T？ | 🔴 **不能直接開** —— `notify_rule` 無 tenant_id/RLS，開了會跨租戶洩漏 · 另開 M0（notify 租戶化）見 `modules/notify-tenant-scoping.md` |
| master-data 給 T？ | ✅ **已開放**（migration 0053）· resolveTenantId 鎖自租戶無 IDOR | — |
| UI label「群組負責人」→「部門主管」 | ✅ **已改**（`d06ea9a` 前端 label · `0069` DB `roles.role_name` · role key group_owner 不變）| — |

> ⚠️ **這一列曾經是錯的，值得留著當教訓。** `d06ea9a`（2026-07-30）只改前端硬編 label，
> commit message 明寫「DB 不動」—— 當時正確，因為沒有畫面在讀 `roles.role_name`。
> 但這一列只寫「✅ 已改」，於是 22 天後沒有人記得它其實只改了一半。
> `0067` 權限管理頁一讀 DB，舊名就回到畫面上，客戶當場問「權限管理不同步」。
>
> **判準**：改顯示名時要問的不是「現在誰在讀」，而是「這個值會不會變成 user-visible」。
> 現在三處（DB / `server/src/auth/role-label.ts` / `web/src/shared/roleLabel.ts`）
> 由 `server/test/role-label-consistency.test.ts` 釘住，再漂移會直接紅。

---

## 附錄 · 常見情境

| 情境 | 誰做 | 步驟 |
|---|---|---|
| 開通新客戶 | A | 開租戶 → 建該公司第一個 T（總經理）|
| 加部門主管 | T | 部門/成員 → 成員 → 新增（角色=群組負責人 + 所屬部門）|
| 加副總（也要看全公司）| **A**（T 不能建 T）| aiproot 建一個 T 級帳號 |
| 員工歸錯部門要改 | ✅ **T**（總經理成員頁改所屬部門下拉）| 成員頁改所屬部門 |
| 員工自綁 | E 自己 | LIFF 綁定 → 系統自動歸部門 |

---

## 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-21 | v2.3 | 角色顯示名三處統一（migration `0069`：DB `roles.role_name` 對齊「部門主管／員工」）· `assistant` 移出租戶可管角色清單（它的權限全是 platform scope、`app_is_platform_ops()` 無租戶條件）· ⭐ **§4.1 新增：租戶自建角色的資料範圍**（custom-roles v0.3 方案 A —— 自訂角色只宣告能力、範圍沿用內建角色當基準、0 條 RLS 要改；`assistant` 絕不可當基準）| ahern + Claude Code |
| 2026-07-31 | v2.2 | 0055：改角色 `users:assign-role`（限員工↔部門主管）+ 刪除 `users:delete-member`（限員工/部門主管）下放 T · 伺服器三道護欄 + 10 P0 測試 · §3/§5.4 標 ✅ · 順修 UserRole 補 employee（「員工」不再顯示英文）| ahern + Claude Code |
| 2026-07-30 | v2.1 | MDA 落地：`users:assign-department`（A/T）、master-data 開放 T（0053）、label 群組負責人→部門主管 —— §3/§5/§6 標為 ✅ 已實作 · notify-config 開放 T 判定為不可直接開（需 notify 租戶化 M0）| ahern + Claude Code |
| 2026-07-30 | v2 | **重寫成 6 角色 + prod 實查 61 條權限**（v1 只有 4 角色、且與實作不符）· ⭐ 標出 MDA 目標：新增 `users:assign-department` 讓 T 能分配成員部門（現況 aiproot-only + 403 誤導按鈕）· 記錄核心原則「屬性可下放、權限不可」· 揭露 v1「員工部門 tenant_admin 可改」一直是未實作的意圖 · 附可議項（notify-config / master-data 是否開放 T）| ahern + Claude Code |
| 2026-07-24 | v1 | 首版（4 角色）· depts/members 交還 tenant_admin | ahern + Claude |
