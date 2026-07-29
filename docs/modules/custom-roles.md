# custom-roles · 讓自訂角色真的能指派給人

> 📋 **M0 v0.2 · 待裁定 OQ-CR-1..6**（2026-07-29）· 依 CLAUDE.md R6，這是資料模型 ＋ 安全模型變更。
>
> 觸發：用戶在「新增成員」看到角色下拉只有「總經理室 / 群組負責人」，
> 問「沒有出現設定好的角色模板，是還沒接入嗎？」
>
> ⚠️ **v0.2 推翻了 v0.1 的核心提案**（見 §3）。用戶要求「站在巨人的肩膀上設計」後
> 去查了 Kubernetes RBAC 與六家一線 SaaS 的實際做法，結論是
> **v0.1 的 `roles.data_scope` 是已知的錯誤形狀，而且這個功能本身現在不該做。**
>
> 相關：[`permission-engine.md`](permission-engine.md)、
> [`roles-permissions-matrix.md`](../roles-permissions-matrix.md)

---

## 0. 三句話結論

1. **不是「還沒接入」** —— 自訂角色可指派這件事從沒被設計進去，四層各自寫死內建角色（§1）。
2. **⭐ 但現在不該做這個功能**（§4）。一線產品幾乎都不做，做的都在 8～10 年後的 Enterprise 檔次；
   業界的四條動手判準我們**命中 0 條**。客戶真正要的是「一個助理角色」，不是「一個角色工廠」。
3. **⭐⭐ 不過查這件事時挖出一個必須現在修的既有安全缺口**（§2.3）：
   `tickets` 的 RLS 讓 **8 個 `employee` 帳號在 DB 層看得到全租戶任務**。
   那跟自訂角色無關，是縱深防禦少了一層。

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

「助理」是真的、權限也存進去了，但 **用它的帳號永遠是 0** —— 不是還沒有人用，是**不可能有人用**。

> ⚠️ 這是「UI 讓你完成一個到不了任何地方的動作」。
> 同一類問題今天已經修過一個（完成回報的「更正」文案承諾但零實作）。

---

## 2. `role` 現在同時扛兩件事

### 2.1 兩條軸被壓在同一個欄位裡

| 軸 | 決定什麼 | 現在靠什麼實現 |
|---|---|---|
| **範圍（scope）** | 這個人**看得到哪些資料列** | **RLS 裡的角色字串比對**（`app.actor_role`）|
| **能力（capability）** | 這個人**能做哪些動作** | 權限碼 · **已有 102 個端點在用** |

能力那一軸其實**已經現代化了**（102 個端點吃權限碼，只剩 16 個用 `@Roles`）。
問題全部集中在範圍那一軸。

### 2.2 直接放寬四層會造成越權（P0）

`tickets` 的 RLS policy（prod 現況）：

```sql
tenant_id = current_tenant
AND ( current_setting('app.actor_role') IS DISTINCT FROM 'group_owner'
      OR department_id = current_setting('app.current_department')::uuid )
```

**部門隔離只對字面字串 `'group_owner'` 生效。** 而 `app.actor_role` 是把 JWT 的
`user.role` 原封不動塞進去的（`tenant.interceptor.ts:18` → `db/client.ts:41`）。

所以若現在就讓自訂角色可指派：建一個「助理」只勾 2 個權限（**看起來非常受限**）→
指派給某人 → 他的 `app.actor_role = 'assistant'` **不等於 `'group_owner'`** →
RLS 讓他看見**全租戶所有部門的任務**。

> 這條 policy 是「**列舉誰要被限制**」的寫法。每多一個角色，
> 它就自動落在「不被限制」那一側 —— **預設開放，不是預設關閉。**

### 2.3 ⭐⭐ 這個寫法現在就已經在漏（與自訂角色無關）

同一條 policy 代表 **`employee` 現在就看得到全租戶的任務** —— prod 有 **8 個** 這種帳號。
目前擋住他們的只有 API 層的權限碼（`employee` 只有 2 個權限），**RLS 這一層是敞開的**。

**這是既有缺口，不是新功能帶來的。** 它是本份 doc 唯一該立刻處理的東西（§5）。

---

## 3. ⭐ 巨人的肩膀：v0.1 的提案是錯的

v0.1 提議在 `roles` 表加一欄 `data_scope`（`platform` / `tenant` / `department`）。
查了 Kubernetes RBAC 之後確認 **那是一個已知的錯誤形狀**。

### 3.1 Kubernetes：scope 在「綁定」上，不在「角色」上

K8s 的 `Role` / `ClusterRole` **只宣告「對什麼資源做什麼動作」，完全不宣告作用範圍**。
範圍由 `RoleBinding` 決定 —— 同一份 `secret-reader` ClusterRole，
綁到哪個 namespace 就只在那裡生效，角色定義一個字都不用改。

**它避開的正是 v0.1 會踩的三個坑：**

| 坑 | v0.1 的後果 |
|---|---|
| 角色要在 N 個範圍用就得複製 N 份 | 「部門主管」用在 12 個部門 → 12 份角色定義，改權限要改 12 次，必然 drift |
| 同一人無法在不同範圍有不同角色 | 「在 D2 是主管、在 D5 是員工」表達不了（`users.role` 單欄也表達不了）|
| 角色定義與組織結構耦合 | 部門改組要改角色表 |

### 3.2 K8s 的另外兩條可直接搬

- **純加法，沒有 deny 規則。** 官方理由（sig-auth maintainer 在 issue #85963）：
  deny 讓 API 無法安全演進 —— 「`*` 減去某物」預設你已知道 `*` 包含什麼，
  但未來新增的資源可能和被排除的一樣強大，於是每次升級都要稽核所有新資源 × 所有 deny 規則。
  **換來**：判定可交換、無優先序衝突、找到任一條 allow 即可短路。
- **防提權在「寫入時」擋，比對請求者當下的有效權限。**
  建/改 Role 時你必須已擁有該 Role 內含的**所有**權限（否則需 `escalate` verb）；
  建/改 Binding 時你必須已擁有即將授出的所有權限（否則需 `bind` verb）。

### 3.3 修正後的形狀（**若將來要做**）

```sql
roles(role_id, tenant_id NULL, role_key, role_name, is_system)   -- 只宣告「能做什麼」
role_permissions(role_id, permission_id)
user_role_assignment(user_id, role_id, scope_type, scope_id)     -- 宣告「在哪裡」
```

平台管理員 ＝ `(admin, platform, NULL)`；租戶管理員 ＝ `(admin, tenant, X)` ——
**同一個 role**，差別只在 assignment。自訂角色天然就有資料範圍了，
**因為範圍根本不是它的屬性。**

RLS 對應改成：session variable 不再放角色字串，改放
`app.scope_level` ＋ `app.allowed_dept_ids`（該 user 本次 request 所有 assignment 的聯集）。
**RLS 比對 ID 集合，從此新增角色不動 policy。**

> ⚠️ **`scope_type` / `scope_id` 絕不可由 client 傳入**，必須 server 端從 JWT 推導。
> 否則就是 memory `pitfall_permission_code_is_not_tenant_boundary` 那個坑的原形重演。

---

## 4. ⭐ 建議：這個功能現在不要做

### 4.1 一線產品的實際做法

| 產品 | 自訂角色 |
|---|---|
| **Linear** | **至今沒有**（只有 5 個固定角色）|
| **Notion** | **沒有**（Enterprise 只多群組層的資源授權，不是角色）|
| **Figma** | **沒有** |
| **Vercel** | **沒有真正的自訂角色**（Enterprise 只給 extended permissions ＋ 專案層指派）|
| **Slack** | Enterprise Grid 才有 · 公司成立 **8 年後**（2021）· 蓋成獨立 Go 服務 ＋ gRPC ＋ 相容雙寫 |
| **GitHub** | repo 層 2021、**組織層 2023 才 GA** · 限 Enterprise Cloud · 上限 20 個 |
| **GitLab** | 自訂管理員角色 **2025-08 才 GA** |

**一線產品是「固定角色撐 8～10 年」，自訂角色是 Enterprise 檔次的變現功能，
不是產品早期的基礎建設。**

它們在沒有自訂角色時怎麼滿足「我要一個只能做 X 的人」？
**加「範圍」維度，而不是讓客戶自組權限包** —— Guest 角色、資源層分享、per-project 權限。

### 4.2 動手判準（滿足任一才做）

| # | 判準 | 我們現況 |
|---|---|---|
| 1 | ≥3 家租戶提出**互不相同**的角色切法（一家 ＝ 加內建角色就好）| ❌ 1 家 |
| 2 | 出現在**採購／資安稽核清單**（SOC 2、ISO 27001、招標規格）| ❌ 無 |
| 3 | 內建角色數量**超過 8** 或出現「XX 部門專用」這種租戶特化角色 | ❌ 5 個 |
| 4 | 客戶因為角色問題**擋住付款或續約** | ❌ 無 |

**命中 0 / 4。** 客戶總共 19 個帳號。

### 4.3 為什麼「先做起來放著」在這裡特別貴

§2.2 已經證明：這個功能的每一個 P0 都出自「開放任意建角色」這個前提。
不開，那四個 P0 就不存在。而現在做的話，我們是**在猜**客戶想要的切法 ——
等第 3 家客戶提出需求時，才會知道真正的形狀，那時再做反而更準。

---

## 5. ⭐ 現在該做的三件事

### 5.1 安全修正（**與自訂角色無關，建議立刻做**）

把 `tickets` 的 RLS 從「列舉誰要被限制」改成**正向、fail-closed**：

```sql
-- 現在（預設開放）
AND (current_setting('app.actor_role', true) IS DISTINCT FROM 'group_owner'
     OR department_id = ...)

-- 改成（有設部門就限縮 · 預設關閉）
AND (nullif(current_setting('app.current_department', true), '') IS NULL
     OR department_id = nullif(current_setting('app.current_department', true), '')::uuid)
```

`app.current_department` **本來就已經在設了**（`db/client.ts:42`），這不是新機制。

**prod 驗算（改完誰會變）：**

| 角色 | 帳號數 | 有掛部門 | 改後 |
|---|---|---|---|
| `tenant_admin` | 7 | **0** | 不變（看全租戶）|
| `aiproot_admin` | 1 | **0** | 不變 |
| `group_owner` | 3 | **3** | 不變（只看自己部門）|
| `employee` | 8 | 3 | **3 個從「看全租戶」收斂成「只看自己部門」** ＝ 修正 |

> ⚠️ 另外 5 個沒掛部門的 `employee` 仍看得到全租戶 —— 見 OQ-CR-3。

### 5.2 「助理」升格為第 6 個內建角色

客戶要的是**一個具體角色**，不是一個角色工廠。把 `assistant` 轉成
`is_system = true`、沿用它現有那 2 個權限碼，加進 `users_role_check`、DTO enum 與前端下拉。

**一個 migration ＋ enum 加值 ＋ 下拉多一項**，客戶需求 100% 滿足，**不引入任何 P0**。
這正是 Linear / Figma 的做法。客戶建的東西**變成真的能用**，而不是被刪掉。

### 5.3 把「新增角色」入口收起來

`RolesManagement` 的「＋ 新增自訂角色」目前讓人完成一個到不了任何地方的動作。
改成 aiproot-only ＋ 註明「新增角色請聯繫 AIPROOT」，
**保留「調整既有角色的權限碼」** —— 那部分是可用的，也是最常見的真實需求。

---

## 6. 失效場景反思（FMEA · R17）

**§5 那三件事的：**

| # | 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|---|
| **R-1** | RLS | 改完 policy 後某個角色意外被收斂 | 主管看不到任務，以為資料掉了 | **P0** | §5.1 已用 prod 資料逐角色驗算 · 上線後三個角色各登入一次確認 |
| **R-2** | RLS | 其他表也有同樣的負向寫法但沒一起改 | 漏一張表 ＝ 漏一個洞 | P1 | 已掃過 `pg_policies`：`IS DISTINCT FROM` 只有 `tickets` 一處 |
| **R-3** | 相容 | `assistant` 升格後，舊的 `is_system = false` 資料列殘留 | 下拉出現兩個「助理」 | P2 | migration 用 UPDATE 就地升格，不新建列 |
| **R-4** | 觀測 | 角色權限被改動時沒有紀錄 | 事後查不出誰改的 | P1 | `RolesManagement` 的改動要寫 `audit_log`（R5）· **現況待查** |

**若將來真的要做完整版，額外會有的（v0.1 已盤點，保留備查）：**

| # | 失效模式 | 嚴重度 | 緩解 |
|---|---|---|---|
| **R-5** | 先放寬 `users.role` CHECK、後改 RLS → 自訂角色看得到全租戶 | **P0** | 順序不可顛倒（RLS 先） |
| **R-6** | 忘了拿掉 `is_system = true` → 自訂角色 0 權限、**畫面全白且不報錯** | **P0** | 要有測試：建角色 → 指派 → 斷言拿得到權限 |
| **R-7** | tenant_admin 建一個帶自己沒有的權限碼的角色 ＝ 自我提權 | **P0** | K8s 的做法：**寫入時**比對請求者當下的有效權限（§3.2）|
| **R-8** | 自訂角色 `tenant_id` 為 NULL（現況 `assistant` 就是）→ 跨租戶可見 | **P0** | 租戶自建的角色必須帶 `tenant_id` |

---

## 7. 開放問題（OQ-CR-N）

| # | 問題 | 建議 |
|---|---|---|
| **OQ-CR-1** | 這個功能現在做還是凍結？ | **凍結** · 改做 §5 三件事 · 觸發條件見 §4.2 四條判準 |
| **OQ-CR-2** | `tickets` 的 RLS 安全修正要不要現在做？ | **要** · 這是既有缺口，與功能決策無關（§2.3）|
| **OQ-CR-3** | 5 個沒掛部門的 `employee` 怎麼辦？ | **需要你的業務判斷** —— 他們該看全租戶，還是該補部門？這題直接決定 §5.1 改完的實際效果 |
| **OQ-CR-4** | 「助理」升格為內建角色，還是刪掉？ | **升格**（§5.2）· 客戶建的東西變成真的能用 |
| **OQ-CR-5** | 「新增自訂角色」入口怎麼處理？ | 改 aiproot-only ＋ 註明聯繫方式 · 保留「調整既有角色權限」 |
| **OQ-CR-6** | 16 個還在用 `@Roles` 的端點要不要改成權限碼？ | **本輪不改**（fail-closed 是安全的）· 另開一輪，避免範圍爆炸 |

---

## 8. 里程碑

| # | 內容 | 依賴 |
|---|---|---|
| **M0** 📋 | 本 doc · 待裁定 OQ-CR-1..6 | — |
| **M1** | ⭐ `tickets` RLS 改正向 fail-closed（**單獨 commit、單獨上、單獨驗**）| OQ-CR-2/3 |
| **M2** | `assistant` 升格內建角色（migration ＋ DTO enum ＋ 前端下拉）| OQ-CR-4 |
| **M3** | 「新增自訂角色」入口收成 aiproot-only ＋ 文案說清楚 | OQ-CR-5 |
| **M4** | docs 收尾 ＋ `roles-permissions-matrix.md` 更新 | — |
| **~~M5+~~** | ~~完整自訂角色~~ **凍結** · 解凍條件：§4.2 四條判準命中任一 · 解凍時照 §3.3 的形狀做，**不要照 v0.1** | — |

---

## 9. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-29 | v0.1 | M0 首版 · 查出四層各自寫死內建角色，prod 的自訂角色「助理」有 2 個權限但 0 個帳號在用且不可能有人用 · ⭐ 主張真正的裁定點是 `users.role` 同時扛「範圍」與「能力」，範圍那半靠 `tickets` RLS 的角色字串比對，而該 policy 寫成「列舉誰要被限制」→ 每多一個角色就自動落在不被限制那側 · 提案 `roles.data_scope` ＋ RLS 改正向 | ahern + Claude Code |
| 2026-07-29 | **v0.2** | **用戶要求「站在巨人的肩膀上設計」後大幅推翻自己** · ⭐⭐ 查 Kubernetes RBAC 確認 **v0.1 的 `roles.data_scope` 是已知的錯誤形狀** —— K8s 把 scope 放在 RoleBinding 而非 Role 上，正是為了避開「角色要在 N 個範圍用就得複製 N 份」「同一人無法在不同範圍有不同角色」「角色定義與組織結構耦合」三個坑；正確形狀是 `user_role_assignment(user_id, role_id, scope_type, scope_id)`，範圍是**指派**的屬性不是**角色**的屬性（§3.3）· 另收下 K8s 兩條紀律：純加法無 deny（deny 會讓 API 無法安全演進）、防提權在**寫入時**比對請求者當下的有效權限 · ⭐⭐ 查六家一線 SaaS 後主張**這個功能現在不該做**：Linear／Notion／Figma／Vercel **至今沒有**，Slack 成立 8 年後才做且限 Enterprise Grid，GitHub 組織層 2023 才 GA，GitLab 2025-08 才 GA；業界四條動手判準（≥3 家不同切法／採購稽核清單／內建角色 >8／擋住付款）**我們命中 0 條**，客戶共 19 個帳號 · 改為建議三件小事：`tickets` RLS 安全修正（**這是既有缺口，8 個 employee 現在就在 DB 層看得到全租戶任務**）、「助理」升格為第 6 個內建角色（客戶要的是一個角色不是一個角色工廠）、新增角色入口收成 aiproot-only | ahern + Claude Code |
