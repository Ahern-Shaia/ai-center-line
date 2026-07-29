# custom-roles · 讓自訂角色真的能指派給人

> 📋 **M0 · 待裁定 OQ-CR-1..8**（2026-07-29）· 依 CLAUDE.md R6，這是資料模型 ＋ 安全模型變更，
> 由人 review 後才實作。
>
> 觸發：用戶在「新增成員」看到角色下拉只有「總經理室 / 群組負責人」，
> 問「沒有出現設定好的角色模板，是還沒接入嗎？」
>
> 相關：[`permission-engine.md`](permission-engine.md)、
> [`roles-permissions-matrix.md`](../roles-permissions-matrix.md)

---

## 0. 一句話結論

**不是「還沒接入」——「自訂角色可以指派給人」這件事從來沒有被設計進去，而且
四個地方各自寫死了內建角色。**

**但真正的問題不是那四個地方。** `users.role` 現在同時扛了兩件事 ——
**「看得到哪些資料」（範圍）** 與 **「能做哪些動作」（能力）** ——
而範圍那一半是靠 **RLS 裡的角色字串比對** 實現的。
**先不把這兩件事拆開就放寬那四層，等於開一個越權後門**（見 §2.2）。

---

## 1. 現況查驗（2026-07-29 · prod）

### 1.1 四層都擋著

| 層 | 位置 | 擋法 |
|---|---|---|
| 前端 | `web/src/settings/depts-members/Members.tsx:27` | `assignableRolesFor()` 寫死回傳 `["tenant_admin","group_owner"]`，從不讀 `roles` 表 |
| 後端 DTO | `server/src/tenant-admin/dto/user.dto.ts:5` | `z.enum([...4 個內建])` —— 連內建的 `employee` 都不收 |
| 資料庫 | `users_role_check` | CHECK 只允許 5 個內建值 → 自訂角色**寫不進 `users.role`** |
| 權限解析 | `server/src/permission/permission.service.ts:38` | `WHERE r.role_key = u.role AND r.is_system = true` → 自訂角色查不到權限，**登入後畫面全空** |

### 1.2 prod 的證據

```
role_key       role_name       is_system  權限數  用這個角色的帳號數
aiproot_admin  AIPROOT 管理員  t          53      1
consultant     顧問            t          25      0
employee       一般員工        t           2      8
group_owner    群組負責人      t          10      3
tenant_admin   總經理室        t          24      7
assistant      助理            f           2      0     ← 自訂角色
```

「助理」是真的、權限也存進去了，但 **用它的帳號永遠是 0** ——
不是還沒有人用，是**不可能有人用**。

> ⚠️ 這是「UI 讓你完成一個到不了任何地方的動作」。
> 同一類問題今天已經修過一個（完成回報的「更正」文案承諾但零實作）。

---

## 2. ⭐ 核心裁定點：`role` 現在同時扛兩件事

### 2.1 兩條軸被壓在同一個欄位裡

| 軸 | 決定什麼 | 現在靠什麼實現 |
|---|---|---|
| **範圍（scope）** | 這個人**看得到哪些資料列** | **RLS 裡的角色字串比對**（`app.actor_role`）|
| **能力（capability）** | 這個人**能做哪些動作** | 權限碼（`@RequirePermission`）· **已有 102 個端點在用** |

能力那一軸其實**已經現代化了** —— 102 個端點吃權限碼，只有 16 個還在用 `@Roles`。
問題全部集中在範圍那一軸。

### 2.2 ⚠️⚠️ 直接放寬四層會造成越權（P0）

`tickets` 的 RLS policy（prod 現況）：

```sql
tenant_id = current_tenant
AND ( current_setting('app.actor_role') IS DISTINCT FROM 'group_owner'
      OR department_id = current_setting('app.current_department')::uuid )
```

**部門隔離只對字面字串 `'group_owner'` 生效。** 而 `app.actor_role` 是把
JWT 的 `user.role` 原封不動塞進去的（`tenant.interceptor.ts:18` → `db/client.ts:41`）。

所以如果現在就讓自訂角色可指派：

1. 建一個「助理」，只勾 2 個權限 —— **看起來非常受限**
2. 指派給某人
3. 他的 `app.actor_role = 'assistant'`，**不等於 `'group_owner'`**
4. → RLS 讓他看見**全租戶所有部門的任務**

**一個看起來只有 2 個權限的角色，資料可見範圍比群組負責人還大。**
而且 UI 上完全看不出來 —— 權限清單只勾了兩項。

> 這條 policy 的寫法是「**列舉誰要被限制**」。每多一個角色，
> 它就自動落在「不被限制」那一側 —— 預設開放，不是預設關閉。

### 2.3 順帶查到的既有問題

同一條 policy 也代表 **`employee` 現在看得到全租戶的任務**
（8 個帳號，其中 3 個有掛部門）。目前擋住他們的只有 API 層的權限碼
（`employee` 只有 2 個權限），**RLS 這一層是敞開的**。
縱深防禦少了一層，不是現在就會出事，但它是同一個根因。

---

## 3. 提案的模型

**把兩條軸拆開，各自用對的機制。**

```
users.role  ──→ roles.role_key        （能力：決定有哪些權限碼）
users.role  ──→ roles.data_scope      （範圍：決定 RLS 怎麼收斂）  ← 新增
```

### 3.1 `roles` 加一欄 `data_scope`

```sql
ALTER TABLE roles ADD COLUMN data_scope text NOT NULL DEFAULT 'tenant'
  CHECK (data_scope IN ('platform', 'tenant', 'department'));
```

| `data_scope` | 意思 | 對應現有角色 |
|---|---|---|
| `platform` | 跨租戶（後台維運） | `aiproot_admin`、`consultant` |
| `tenant` | 整個租戶 | `tenant_admin` |
| `department` | 只有自己部門 | `group_owner`、`employee` |

**建自訂角色時必選一個。** 這是「這個角色看得到什麼」的唯一宣告來源。

### 3.2 ⭐ RLS 改成正向、fail-closed

```sql
-- 現在（列舉誰被限制 · 預設開放）
AND (current_setting('app.actor_role', true) IS DISTINCT FROM 'group_owner'
     OR department_id = ...)

-- 提案（有設部門就限縮 · 預設關閉）
AND (nullif(current_setting('app.current_department', true), '') IS NULL
     OR department_id = nullif(current_setting('app.current_department', true), '')::uuid)
```

**SQL 不再猜角色**，改由後端依 `data_scope` 決定要不要設 `app.current_department`：

- `data_scope = 'department'` → 設成他的 `users.department_id`
- 其他 → 不設（空字串）

`app.current_department` **本來就已經在設了**（`db/client.ts:42`），所以這不是新機制。

#### prod 驗算（改完誰會變）

| 角色 | 帳號數 | 有掛部門 | 改後 |
|---|---|---|---|
| `tenant_admin` | 7 | **0** | 不變（沒部門 → 看全租戶）|
| `aiproot_admin` | 1 | **0** | 不變 |
| `group_owner` | 3 | **3** | 不變（有部門 → 只看自己部門）|
| `employee` | 8 | 3 | **3 個會從「看全租戶」變成「只看自己部門」** |

最後一列是 §2.3 那個既有問題被順手修掉 —— **是修正，不是回歸**。
（另外 5 個沒掛部門的 employee 仍看得到全租戶，那要靠 §7 的 OQ-CR-6 決定。）

### 3.3 `users.role` 的約束

現在是 `CHECK (role IN (5 個字面值))`，與 `roles.role_key` 靠約定同步。
改成 **FK 指向 `roles(role_key)`**（需 `role_key` 上有 UNIQUE）：
自訂角色自動可用，且刪角色時 DB 會擋住還有人在用的情況。

---

## 4. 前端要收斂的 12 處

```
Shell.tsx:162,165        role === "aiproot_admin" / "consultant"   → 平台軸，保留
nav.ts:29                isPlatformRole()                          → 平台軸，保留（已是函式，正確示範）
TenantPicker.tsx:19      平台軸，保留
depts-members/Page.tsx:37 平台軸，保留
line-bots/Page.tsx:29,30 平台軸，保留
kb/MediaLibrary.tsx:87   role === "tenant_admin" || ...            → ⚠️ 能力軸，改權限碼
kb/MediaLibrary.tsx:88   canPurge = aiproot_admin                  → 平台軸，保留
Members.tsx:27,29,241    assignableRolesFor + 說明文案             → ⚠️ 要改成讀 roles 表
```

**多數其實是「平台 vs 租戶」的範圍判斷，不是能力判斷** —— 那些可以保留
（自訂角色永遠不會是 `platform` scope，除非 OQ-CR-3 裁定要允許）。
**真正要改的只有 3 處**：`MediaLibrary.tsx:87` 與 `Members.tsx` 那組。

比預期小很多。

---

## 5. 遷移計畫（R1）

| 步 | 動作 | 可逆 | 風險 |
|---|---|---|---|
| 1 | `roles` 加 `data_scope`，回填 5 個內建角色 | ✅ | 無（純新增欄位）|
| 2 | 改 `tickets` 的 RLS 為正向寫法 | ✅ 換回舊 policy | ⚠️ **這步單獨上、單獨驗**，見 §6 R-1 |
| 3 | 後端依 `data_scope` 決定要不要設 `app.current_department` | ✅ | 中 |
| 4 | 拿掉 `permission.service.ts:38` 的 `AND r.is_system = true` | ✅ | 低 |
| 5 | `users.role` CHECK → FK；DTO 的 `z.enum` → 查 `roles` | ✅ | 中 |
| 6 | 前端 3 處改權限碼；`Members.tsx` 下拉改讀 API | ✅ | 低 |
| 7 | `RolesManagement` 建角色時要求選 `data_scope` | ✅ | 低 |

> **步 2 是整件事的重心，也是唯一會動到既有使用者可見範圍的一步。**
> 建議單獨一個 commit、單獨上 prod、上完立刻用三個角色各登入一次確認。

---

## 6. 失效場景反思（FMEA · R17）

| # | 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|---|
| **R-1** | 順序 | 先放寬 `users.role` CHECK、後改 RLS | **自訂角色看得到全租戶任務**，而 UI 顯示他只有 2 個權限 | **P0** | 遷移必須 §5 的順序（RLS 先於 CHECK）· 步驟顛倒就是開後門 |
| **R-2** | 權限 | 忘了拿掉 `is_system = true` | 自訂角色 0 權限 → 登入後**整個畫面空白**，而且不報錯 | **P0** | 步 4 · 要有測試：建自訂角色 → 指派 → 斷言拿得到權限 |
| **R-3** | 提權 | tenant_admin 建一個帶 `platform` scope 或帶自己沒有的權限碼的角色 | **自己把自己升級** | **P0** | 建角色時只能勾**建立者本身擁有**的權限碼；`platform` scope 只有 aiproot 能給（OQ-CR-3）|
| **R-4** | 多租戶 | 自訂角色 `tenant_id` 為 NULL（現況 `assistant` 就是）| 一家客戶建的角色**出現在其他客戶的下拉裡** | **P0** | 租戶自建的角色必須帶 `tenant_id`；下拉只列 `tenant_id IS NULL AND is_system` ＋ 自己租戶的 |
| **R-5** | 相容 | 16 個 `@Roles(...)` 端點 | 自訂角色被擋 → 功能缺一塊，但**是 fail-closed** | P1 | 可接受 · 逐步改成 `@RequirePermission`；本輪先盤點哪 16 個 |
| **R-6** | 前端 | 漏改 `MediaLibrary.tsx:87` 那類能力判斷 | 自訂角色持有者按鈕消失，但**不會越權** | P1 | fail-closed · §4 已盤點完 |
| **R-7** | 刪除 | 刪掉還有人在用的角色 | 那些人的 `users.role` 變孤兒 → 權限查不到 → 畫面空白 | P1 | FK 擋（步 5）· 或刪除前檢查並明說「還有 N 人使用」|
| **R-8** | 觀測 | 越權發生時沒人看得出來 | 靜默 | P1 | 建角色 / 指派角色 / 改權限都要寫 `audit_log`（R5）· 現況待查 |

> **P0 有四條，其中 R-1 是順序問題** —— 這也是為什麼本模組必須走 design doc 而不是直接改。

---

## 7. 開放問題（OQ-CR-N）

| # | 問題 | 建議 |
|---|---|---|
| **OQ-CR-1** | 自訂角色要不要宣告 `data_scope`？ | **要**（§3.1）· 不宣告就無法安全地決定 RLS 收斂 |
| **OQ-CR-2** | 誰可以建自訂角色？ | **aiproot ＋ tenant_admin（限自己租戶）** · 沿用既有分權（memory `feedback_only_aiproot_creates_tenant_accounts`）|
| **OQ-CR-3** | 租戶自建的角色可以是 `platform` scope 嗎？ | **不行** · 那等於自己給自己跨租戶權限（R-3）|
| **OQ-CR-4** | 建角色時可勾的權限碼範圍？ | **只能勾建立者自己有的** · 否則是提權 |
| **OQ-CR-5** | 自訂角色可以指派給誰？ | 同租戶成員 · 且**指派者本身要有那個角色的全部權限**（同 OQ-CR-4 的理由）|
| **OQ-CR-6** | 5 個沒掛部門的 `employee` 怎麼辦？ | 需要你的業務判斷：他們該看全租戶還是該補部門？**這題會影響 §3.2 改完的實際結果** |
| **OQ-CR-7** | 16 個 `@Roles` 端點本輪改不改？ | **不改**（fail-closed 是安全的）· 另開一輪盤點，避免這輪範圍爆炸 |
| **OQ-CR-8** | `users.role` 改成 FK 還是留 CHECK？ | **FK** · 順便解決 R-7 的孤兒問題 |

---

## 8. 里程碑

| # | 內容 | 依賴 |
|---|---|---|
| **M0** 📋 | 本 doc · 待裁定 OQ-CR-1..8 | — |
| **M1** | `roles.data_scope` ＋ 回填 ＋ `RolesManagement` 建角色要選 scope | OQ 裁定 |
| **M2** | ⭐ `tickets` RLS 改正向寫法 ＋ 後端依 scope 設 `current_department`（**單獨上、單獨驗**）| M1 |
| **M3** | 拿掉 `is_system = true` ＋ `users.role` 改 FK ＋ DTO 改查 `roles` | M2 |
| **M4** | 前端：`Members.tsx` 下拉改讀 API、3 處能力判斷改權限碼 | M3 |
| **M5** | 提權防線：建角色 / 指派時的權限子集檢查（R-3、OQ-CR-4/5）＋ audit_log | M3 |
| **M6** | docs 收尾 ＋ FMEA 覆核 ＋ `roles-permissions-matrix.md` 更新 | — |

> **止血選項**：若 OQ 一時難裁定，可先做 30 分鐘的暫時處置 ——
> `RolesManagement` 頁面明說「自訂角色目前只能調整權限，**尚不能指派給成員**」。
> 現在那頁讓人以為建完就能用。

---

## 9. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-29 | v0.1 | M0 首版 · 起於用戶在「新增成員」看不到自訂角色 · ⭐ 查出**四層各自寫死**（前端下拉／後端 DTO／`users_role_check`／權限解析的 `is_system = true`），自訂角色「助理」在 prod 有 2 個權限但 0 個帳號在用，且**不可能有人用** · ⭐⭐ 但主張真正要裁定的不是放寬那四層，而是 `users.role` 同時扛了「範圍」與「能力」兩條軸，範圍那半靠 **RLS 的角色字串比對**實現 —— `tickets` 的 policy 寫成「列舉誰要被限制」，**每多一個角色就自動落在不被限制那側**；直接放寬四層 ＝ 一個只有 2 個權限的角色看得到全租戶任務（R-1 · P0）· ⭐ 順帶查到 `employee` 現在也因為同一條 policy 看得到全租戶，只靠 API 層權限碼擋著 · ⭐ 提案把 RLS 改成正向 fail-closed（有設 `app.current_department` 就限縮），並用 prod 資料驗算改完誰會變（tenant_admin 7 個都沒部門 → 不變；group_owner 3 個都有 → 不變；3 個 employee 從看全租戶變成看自己部門 ＝ 修正非回歸）· ⭐ 前端 12 處角色硬比對盤點後**真正要改的只有 3 處**，其餘是平台／租戶的範圍判斷可保留 · FMEA 8 條含 4 個 P0（順序、空白畫面、提權、跨租戶外洩）| ahern + Claude Code |
