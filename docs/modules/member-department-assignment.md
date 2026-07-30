# member-department-assignment · 總經理自主分配成員部門

> 狀態：🔨 **M1/M2 已落地 v0.2**（2026-07-30）· OQ-MDA-1..8 全採建議 · 待 M3 文件收尾
>
> 相關：[`custom-roles.md`](custom-roles.md)（本文直接站在它的結論上 —— 範圍是**指派的屬性**不是角色的屬性）、
> [`auth-gate-consolidation.md`](auth-gate-consolidation.md)（本文要收的 403 誤導按鈕屬同一類 A-class 錯開）、
> [`../roles-permissions-matrix.md`](../roles-permissions-matrix.md)（權限對照）
>
> ⚠️ 這動到權限邊界（誰能改誰的什麼），依 R6 先 design + 人 review 再實作。

---

## 1. 目標與範圍

### 1.1 目標

讓**總經理（tenant_admin）自己**把成員分配 / 調整到部門 —— 而不是每次都回頭找 aiproot。
同時**保留**現有的「員工綁定時自動歸部門」，兩者並存：自動當預設、手動當覆寫。

### 1.2 對應訴求

用戶 2026-07-30 描述的組織建立流程：
「我司 → 建租戶(總經理) → 建部門 → 綁部門主管 → **分配部門成員**」。
最後那步在系統裡目前是**半自動且 aiproot-only**，與用戶心智模型（總經理主動分配）不符。
這是用戶反覆要求的「[[feedback-tenant-self-governance]]（客戶方自己控制）」pattern 的下一個實例。

### 1.3 不做的事

| 不做 | 為什麼 |
|---|---|
| **讓 tenant_admin 改成員的「角色」** | 角色是**權限**不是屬性 —— 改角色＝提權，邊界不同（§3.4）。本模組只碰部門 |
| 拿掉自動推導 | 它是員工端零摩擦的來源，只是要讓手動能覆寫它 |
| 一個成員屬多個部門 | 現況 `users.department_id` 是單值（對齊 Google OU 模型 §3.2）· 多部門是另一個大題 |
| 建立員工帳號 | 員工一律 LIFF 自綁（既有設計）· 本模組只分配**已存在**的成員 |
| tenant_admin 刪除成員 | 刪除是破壞性、跨越權限邊界 · 維持 aiproot-only |

---

## 2. 上游 / 既有現況走查

### 2.1 員工部門現在怎麼來的

`employee-binding.service.ts:160`：員工 LIFF 綁定時，**server 自動推導**部門 ——
撈他過去 30 天在哪個 LINE 群發言最多 → 用**那個群所屬的部門**（`line_group.department_id`）。
推不出來（無活動 / 信心低）→ `department_id = null`，註解寫「需 tenant_admin 於部門/成員頁手動指派」。

⚠️ **但那句註解與現實不符** —— 見 §2.2。

### 2.2 ⭐ 手動指派現在是 aiproot-only（而且 UI 誤導）

| 事實 | 出處 |
|---|---|
| 改成員（含改部門）的端點 `PATCH /users/:id` 要 `users:manage` | `user.controller.ts:61` |
| `users:manage` **只給 `aiproot_admin`** | prod 查證 |
| 端點註解白紙黑字：「update / delete · **aiproot only** · 避免 tenant_admin 亂動」 | `user.controller.ts:14` |
| 但前端「編輯／刪除」按鈕的 `canEdit` 吃的是 `users:create-group-owner`（tenant_admin 有）| `Page.tsx` / `Members.tsx:119` |

**結論**：總經理在「部門/成員」頁**看得到每個成員的編輯/刪除按鈕，點下去 save 會 403** ——
這正是 [`auth-gate-consolidation.md`](auth-gate-consolidation.md) 講的「看得到但按不動」A-class 錯開。
所以現況是：**總經理完全不能分配成員部門**，員工被自動推導錯了也只能找 aiproot 改。

### 2.3 資料模型現況

`users.department_id`（單值、nullable、FK→departments）。**沒有**任何欄位記錄
「這個部門是自動推導的還是有人手動設的」——所以目前無法讓「手動覆寫」不被「自動推導」蓋掉。

---

## 3. ⭐ 巨人的肩膀

「讓次級管理員管成員歸屬、但不能提權」是**成熟 IdP 的標準題**。查了四家的做法，四條可直接搬。

### 3.1 屬性 vs 權限 —— 這是能不能下放的關鍵（K8s RBAC + 本專案 custom-roles）

[`custom-roles.md`](custom-roles.md) §3 查 K8s RBAC 已經確立：**範圍（scope）是「指派」的屬性，不是「角色」的屬性**。
本文把同一把尺用在這裡：

> **部門是一個「資料範圍屬性」，不是「權限」。** 改一個人的部門，改的是「他的資料落在哪個桶」，
> **不改變他能做什麼**。所以下放給 tenant_admin **不構成提權** —— 這跟「改角色」有本質差別。

K8s 的 no-escalation 原則（不能授予自己沒有的權限、寫入時比對）套過來：
- 改**部門**：安全，可下放（它不是權限）
- 改**角色**：受限，因為那是授予能力（§1.3 排除）

這條就是整個模組能安全下放的**理論依據**，不是憑感覺。

### 3.2 單一歸屬 + 顯式搬移（Google Workspace 組織單位 OU）

Google Workspace：一個 user 屬於**恰好一個** OU；換 OU 是**顯式的管理動作**；
委派管理員可被**限定在某個 OU** 內管理。
→ 我們的 `users.department_id` 單值模型**正好對上** OU 模型，不用改成多對多。
   「分配成員」＝一個顯式的「把某人搬到某部門」動作。

### 3.3 自動與手動並存，且**手動優先於自動**（Okta Group Rules / Azure AD 動態 vs 指派）

這是 A+B 並存的核心，也是兩家踩過坑後的共識：

- **Okta Group Rules**：規則自動加成員；**手動加的成員，規則不會動它**。
  （反之規則加的不能手動移除，得改規則）——兩套機制**互不覆寫**。
- **Azure AD**：群組成員分「**指派（Assigned，手動）**」與「**動態（Dynamic，規則）**」，
  明確標記每個成員的 membership type，讓管理員看得出「這人是規則進來的還是我加的」。

**搬過來**：給 `users.department_id` 加一個**來源標記** `department_source ∈ {auto, manual}`。
- 自動推導設的 → `auto`
- 總經理手動設的 → `manual`
- **自動推導永遠不覆寫 `manual`** —— 這樣「員工重新綁定 / 未來若加週期性重算」都不會洗掉總經理的決定。

⚠️ 現況自動推導只在綁定時跑**一次**，所以覆寫衝突暫時不會發生 ——
但這個標記**便宜**（一個 enum 欄位）且順手解決 UI 透明度（見 §3.4），值得現在就加，不要等踩到。

### 3.4 委派管理的「範圍化」與透明度（Azure AD Administrative Units）

Azure AD **Administrative Units**：把管理員的權力**限定在一個單位內** ——
他能管單位內的 user，但**碰不到單位外**，也**無法把自己變全域管理員**。
→ 對應：tenant_admin 只能改**自己租戶**的成員、只能指派到**自己租戶**的部門（RLS + 不可提權）。

透明度：Azure 在成員列表顯示 membership type。
→ 對應：UI 標「此部門為**系統自動判定**」vs「由 **王總** 於 7/30 手動指派」，
   讓總經理一眼看出哪些是系統猜的（可能要覆核）、哪些是人設的。

### 3.5 四條結論一句話

| 借來的 | 落地 |
|---|---|
| 屬性≠權限（K8s / custom-roles）| 改部門可下放、改角色不行 —— 這是安全依據 |
| 單一 OU + 顯式搬移（Google）| 沿用單值 `department_id`，加一個「搬移成員」動作 |
| 自動/手動並存、手動優先（Okta/Azure）| 加 `department_source`，自動永不覆寫 manual |
| 範圍化委派 + 透明度（Azure AU）| RLS 限自租戶、不可提權；UI 標來源 |

---

## 4. 資料模型變動

### 4.1 SQL Migration

```sql
-- department 的來源標記（Okta/Azure 的手動優先）
ALTER TABLE users
  ADD COLUMN department_source text NOT NULL DEFAULT 'auto'
    CHECK (department_source IN ('auto', 'manual'));
-- 誰在何時手動指派的（審計 + 透明度）
ALTER TABLE users ADD COLUMN department_assigned_by uuid REFERENCES users(user_id);
ALTER TABLE users ADD COLUMN department_assigned_at timestamptz;
```

⚠️ 依 R1，這是加欄位（非破壞）· 既有列 `department_source` 落 `auto`（＝現行行為，全是自動推導）。

### 4.2 自動推導改一行

`employee-binding.service.ts` 綁定時的推導，在 UPSERT department 前加條件：
**只在 `department_source = 'auto'`（或該列不存在）時才寫**，`manual` 的跳過。

---

## 5. 權限 / RLS

### 5.1 拆一個新權限碼（不擴 users:manage）

```
users:assign-department   -- 只能改「部門」這個屬性，不能改角色 / 不能刪
```

- 給 `tenant_admin`（＋ aiproot / consultant 沿用全能）
- `users:manage`（改角色 / 刪除）**維持 aiproot-only 不動**
- 新端點：`PATCH /users/:id/department`（body 只收 `departmentId`），gated by `users:assign-department`

拆開的理由（§3.1）：部門是屬性、角色是權限，**兩者的授權邊界本就不同**，
用同一個 `users:manage` 綁在一起，才會逼出「要嘛全給要嘛全不給」的 aiproot-only 現況。

### 5.2 RLS / IDOR 防護

- 端點內用 `currentTx()`（繼承 interceptor 的 tenantId），**不接受 client 傳 tenantId**
- 目標成員必須屬**同一租戶**（RLS `users` policy 已 tenant-scope）
- 目標部門必須屬**同一租戶**（寫入前驗 `departments.tenant_id = current_tenant`）
  —— 否則會踩 [[pitfall-permission-code-is-not-tenant-boundary]]：權限碼擋不住跨租戶 IDOR

---

## 6. UI

### 6.1 M1（先做）· 單筆指派 + 收掉 403 誤導

- 「部門/成員 → 成員」列表：每列的「所屬部門」做成**可直接改的下拉**（inline），
  或保留編輯抽屜但**只開放部門欄**給 tenant_admin
- **收掉 A-class 錯開**：tenant_admin 不該看到「改角色 / 刪除」的入口（那些仍 aiproot-only）
  —— 要嘛隱藏、要嘛 disabled 附說明，不可以看得到卻 403
- 每列標來源：`系統自動判定` / `王總 · 7/30 手動`（§3.4 透明度）

### 6.2 M2（後做 · 看需求）· 部門視角 + 批次

用戶心智模型是「把成員分配到部門」（由上而下）。進階體驗：
- **部門視角**：左邊部門清單、右邊成員，可把成員在部門間搬移（像 Google Admin 的 OU 搬移）
- **批次**：多選成員一次指派

先不做，等 M1 用一輪確認單筆夠不夠（OQ-MDA-3）。

---

## 7. 企業級 cross-cutting（Mode B）

- **安全模型**：核心就是 §3.1 屬性≠權限。新權限碼只能改部門、RLS 限自租戶、不可提權。審計記 `department_assigned_by/at`。
- **容量**：無新增查詢熱點（單筆 UPDATE）。三個新欄位對 `users` 表可忽略。
- **失效**：見 §8 FMEA。
- **觀測**：手動指派寫 audit_log（interceptor 既有）＋ `department_assigned_by/at` 落列。
- **資料生命週期**：成員刪除時欄位隨列走（FK cascade / set null 依現況）。
- **兼容 + Rollout**：純加欄位 + 新端點 + 新權限碼，migration 先於後端。既有行為（全 auto）不變。
- **成本**：近乎零。

---

## 8. 失效場景反思（FMEA）

| 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|
| 自動推導覆寫了總經理的手動指派 | 總經理的決定被系統默默改掉，且不知情 | **P0** | ✅ 已緩解：手動指派標 `department_source='manual'` + 記 assigned_by/at；測試釘住 source=manual。⚠️ 現況自動推導只在綁定時 INSERT 一次（無 re-derive 路徑），所以覆寫暫不會發生 —— 但若日後加週期重算，務必 `WHERE department_source='auto'` |
| 新端點沒驗目標部門的租戶 → 跨租戶 IDOR | 把自家成員指派到**別家**的部門 | **P0** | ✅ 已緩解：resolveTenantId 鎖自租戶 + service 明驗 `departmentBelongsToTenant`；測試「別家部門」「別家成員」兩條都擋 |
| tenant_admin 藉此端點改角色 / 提權 | 越權 | **P0** | ✅ 已緩解：`AssignDepartmentSchema` 只收 tenantId+departmentId（zod strip 掉 role/password）· service 沒有改 role 的碼 · 測試證明角色不變 |
| 403 誤導按鈕沒收乾淨 | 總經理仍點到打不動的功能 | P1 | ✅ 已緩解：編輯/刪除改吃 `canManageFull`（users:manage=aiproot），tenant_admin 不再看到 |
| RLS 漏設 → 改成員回 0 列靜默失敗 | 以為改了其實沒改 | P1 | 🔒 走 `currentTx()`·測試斷言 rowCount=1（[[rule-rls-silent-zero]] 已踩 12 次）|

**任一 P0 未緩解不得上 prod（R17）。**

---

## 9. 里程碑

| # | 內容 | 依賴 |
|---|---|---|
| **M0** 📋 | 本文件 · 待裁定 OQ-MDA-1..8 ← 在這 | — |
| **M1** ✅ | migration 0052（3 欄 + 新權限授 A/T）+ `PATCH /users/:id/department` + 兩道防 IDOR · `68a749f` | — |
| **M2** ✅ | 成員頁部門可改下拉 + 來源標記 + 收 403 誤導按鈕 · `05a5a5b` · label 群組負責人→部門主管 `d06ea9a` | — |
| **M3** 🔨 | 文件收尾（矩陣 v2 已標 shipped · MODULES）· 待 prod 執行 migration 0052/0053（R10）| M2 |
| **M4**（選）| 部門視角 + 批次指派 | OQ-MDA-3 · 看 M1 一輪需求 |

---

## 10. 開放問題（OQ-MDA-N）— 待裁定

| # | 問題 | 我的建議 |
|---|---|---|
| **OQ-MDA-1** | 拆新權限 `users:assign-department` vs 擴 `users:manage`？ | **拆** —— 屬性/權限邊界不同（§3.1），拆才不會又逼出 all-or-nothing |
| **OQ-MDA-2** | `department_source` 來源標記現在加還是之後？ | **現在加** —— 便宜（一欄），是 A+B 並存不打架的地基，且解 UI 透明度 |
| **OQ-MDA-3** | M1 先單筆就好，還是直接做部門視角 + 批次？ | **先單筆** —— 客戶共 ~19 帳號、部門數個，單筆夠；批次等真的嫌慢再做 |
| **OQ-MDA-4** | 總經理可以把成員部門設成「無」（清空）嗎？ | **可以** —— 部門是屬性，清空是合法狀態（回到未分派）|
| **OQ-MDA-5** | 手動指派後，未來若加「週期性重算」會覆寫嗎？ | **永不覆寫 manual**（§3.3）· 現況只綁定時算一次，但先把規則立死 |
| **OQ-MDA-6** | 403 誤導按鈕：隱藏，還是 disabled 附說明？ | **隱藏** role/delete 入口（tenant_admin 不該看到 aiproot-only 動作）· 部門改成第一級動作 |
| **OQ-MDA-7** | 要不要順便讓 tenant_admin 把員工**升成群組負責人**？ | **本模組不做** —— 那是改角色（提權），另一個邊界。tenant_admin 已能「建」群組負責人，「升級既有員工」單獨評估 |
| **OQ-MDA-8** | 這模組屬本專案還是 EEA？ | 本專案（緊貼既有 depts-members）· 但與 custom-roles / auth-gate 同一組織治理題，未來可能一起收進 EEA §5 |

---

## 11. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-30 | v0.2 | **M1/M2 落地**（`68a749f` 後端 · `05a5a5b` 前端 · `d06ea9a` label 改名）· FMEA 三個 P0 全緩解並用 6 條測試釘住（跨租戶 IDOR 兩形狀、藉端點提權、手動優先）· master-data 一併開放 tenant_admin（migration 0053）· ⚠️ 途中踩到自己：跑 `npm run migrate`（無追蹤、從 0001 重跑）在既有資料上把 0048 的 tickets 部門 policy 覆寫回舊版，重套 0048 修回 —— 教訓：dirty dev DB 勿跑全量 migrate · migration 0052/0053 待 prod 人工執行（R10）| ahern + Claude Code |
| 2026-07-30 | v0.1 | M0 首版 · 起於用戶指出正確流程「建租戶→建部門→綁主管→**分配成員**」而「分配成員」目前半自動且 **aiproot-only**（總經理改不了、還踩 403 誤導按鈕）· ⭐ 站在巨人肩膀上：K8s/custom-roles（屬性≠權限＝可安全下放的依據）、Google OU（單值歸屬+顯式搬移）、Okta Group Rules / Azure 動態vs指派（自動手動並存、**手動優先不被覆寫**）、Azure Administrative Units（範圍化委派+來源透明）· 核心設計＝加 `department_source` 來源標記讓 A(自動)+B(手動)並存不打架、拆 `users:assign-department` 新權限碼（只改屬性不碰角色）· FMEA 3 個 P0（自動覆寫手動 / 跨租戶 IDOR / 藉端點提權）· OQ-MDA-1..8 | ahern + Claude Code |
