# 設計文件 · 權限管理開放給租戶自己調（M0）

> 狀態：📋 **M0 DRAFT v0.1**（2026-08-21）· **待裁定 OQ-TRP-1..10**
> 對象：`roles`、`role_permissions`、`permission.service.ts`、`RolesManagement.tsx`、`users.role_id`
> 相關：[`permission-engine.md`](permission-engine.md)、[`custom-roles.md`](custom-roles.md)（🧊 凍結 · **界線見 §2**）、
> [`member-department-assignment.md`](member-department-assignment.md)、[`../roles-permissions-matrix.md`](../roles-permissions-matrix.md)
>
> **一句話**：把現在 aiproot-only 的「權限管理」頁開放給總經理，但**不能照原樣開** ——
> 角色是全租戶共用的（改一家等於改所有家）、清單裡有 34 項平台權限（含跨租戶查詢）、
> 而且總經理可以編輯自己的角色（自我提權）。
> 解法是**編輯時分岔**：租戶一改就複製一份自己的角色，且只看得到 `tenant`／`department` 級的權限。

---

## 1. 觸發事件（2026-08-21）

用戶截圖「平台 → 權限管理」頁並說：**「我只是要開放『權限管理』給租戶自己管理。」**

> 這是用戶**第四次**提租戶自治（前三次：部門/成員管理、LINE 綁定稽核、通知設定範圍，
> 見 [[feedback_tenant_self_governance]]）。前三次都是「逐項開放單一功能」，
> 這次不同 —— 開放的是一個**能改變其他功能授權的頁面**，風險高一級。

---

## 2. ⚠️ 與 `custom-roles.md` 的界線（先劃清楚）

| | [`custom-roles.md`](custom-roles.md) 🧊 凍結 | **本文** |
|---|---|---|
| 客戶能做什麼 | **建立新角色** | **調整既有角色的權限** |
| 角色數量 | 無上限、由客戶定義 | 固定 6 個內建 |
| 我方能預期形狀嗎 | ❌ 在猜客戶想怎麼切 | ✅ 形狀已知 |
| 狀態 | 凍結（解凍判準 §4.2，目前 0/4）| 本文提案 |

**本文不解凍 custom-roles。** 兩者共用同一批 P0 的來源（開放權限寫入），
但「調整固定角色」的風險面小得多 —— 角色集合有限、每個角色的用途已知。

> 之後若有人看到本文上線就以為 custom-roles 解凍了，請回頭讀這一節。

---

## 3. 現況走查（2026-08-21 查 code）

### 3.1 P0-A · 角色是**全租戶共用**的

```sql
-- 0010_permission_engine.sql:23
roles.tenant_id uuid REFERENCES tenants(tenant_id)   -- NULL = built-in
```

畫面上那 6 個角色（`aiproot_admin` / `employee` / `assistant` / `tenant_admin` /
`group_owner` / `consultant`）**`tenant_id` 全是 NULL**，而 `role_permissions`
**根本沒有 `tenant_id` 欄位**（PK 是 `(role_id, permission_id)`）。

⭐ **台灣福祉的總經理改「一般員工」的權限，鮮湧的一般員工也會跟著變。**
這不是設定衝突，是一家客戶寫到另一家客戶。**照原樣開＝送出一個跨租戶寫入權。**

### 3.2 P0-B · 清單裡有 34 項平台權限

| scope | 項數 |
|---|--:|
| `platform` | **34** |
| `tenant` | 25 |
| `department` | 1 |

畫面顯示「已勾 55 / 64 項」—— 也就是說**超過一半是我們自己的維運權限**，包括：

- `binding:aiproot-view` —— **跨租戶檢視 LINE 綁定稽核**
- `binding:aiproot-manage`、`batch-history:run`、`categories:manage`、`tenants:onboard`…

租戶只要勾一個 `binding:aiproot-view`，就看得到**別家客戶**的資料。

### 3.3 P0-C · 自我提權

總經理可以編輯「總經理室（`tenant_admin`）」這個角色本身 ——
把 `users:manage` / `tenants:onboard` 勾給自己，或勾給「一般員工」讓全公司都變成平台管理員。

### 3.4 權限怎麼解析（決定分岔怎麼做）

```sql
-- permission.service.ts:36
LEFT JOIN role_permissions rp ON rp.role_id = COALESCE(
  u.role_id,
  (SELECT r.role_id FROM roles r WHERE r.role_key = u.role AND r.is_system = true LIMIT 1)
)
```

**`users.role_id` 優先，沒有才用 `users.role` 字串對到內建角色。**
`role_id` 這個欄位（0010 加的）**正是為了這件事而存在的** —— 分岔之後把該租戶的使用者指到副本即可。

⚠️ 但這也是一個陷阱：`role_id` 若沒改到，那個人**靜默沿用內建角色**，
而畫面上看起來一切正常（見 F-2）。

### 3.5 快取

`permission.service.ts` 有 **5 分鐘 in-memory 快取**（`CACHE_TTL_MS`），
且已備 `invalidate(userId)` / `invalidateAll()`。改完不清快取的話，最久 5 分鐘後才生效。

---

## 4. 設計：編輯時分岔（fork on edit）

### 4.1 三個 P0 各自的解

| P0 | 解法 |
|---|---|
| **A 全域共用** | 租戶**第一次編輯**某角色時，複製一份 `tenant_id = <該租戶>` 的副本，並把該租戶用該角色的使用者 `role_id` 指過去。之後他改的是自己那份 |
| **B 平台權限** | 只回傳 `scope IN ('tenant','department')` 的權限 —— **不是灰掉，是不出現在 API 回應裡**。看不到就勾不了，前端也不必守 |
| **C 自我提權** | `tenant_admin` 這個角色**租戶不可編輯**（連唯讀都可以，但不給存檔）。要改仍然找我們 |

⭐ **B 的做法很重要**：不要靠前端隱藏。權限清單端點依呼叫者角色決定回什麼，
租戶拿到的就是 26 項（25 tenant + 1 department），platform 那 34 項在他的世界裡不存在。

### 4.2 為什麼是「編輯時」分岔，不是「開通時」複製

開通時就給每個租戶複製一套 —— 聽起來乾淨，但：

- 3 個租戶 × 6 角色 ＝ 18 筆 role，之後每加一個內建權限要**同步 18 份**（漂移的來源）
- 大多數租戶**從來不會改** —— 幫他們建一份只是製造維護負擔

**編輯時才分岔** ＝ 沒改過的租戶永遠跟著內建角色走，我們調整內建權限時他們自動受惠；
改過的租戶自己負責（並在畫面上標示「已自訂，不再跟隨系統更新」）。

> 這是 Kubernetes 的 ClusterRole → Role 覆寫、以及 Okta 的 profile override 用的同一個模式。

### 4.3 資料模型（migration 0067）

`roles` / `role_permissions` **結構完全不用改** —— 0010 當初就留好了。

只需要一個新權限碼：

```sql
INSERT INTO permissions (permission_id, resource, action, description, scope) VALUES
  ('roles:manage-tenant', 'roles', 'manage-tenant', '調整本公司角色的權限', 'tenant')
ON CONFLICT DO NOTHING;

-- 給 tenant_admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, 'roles:manage-tenant' FROM roles r
WHERE r.role_key = 'tenant_admin' AND r.is_system = true
ON CONFLICT DO NOTHING;
```

⚠️ **`permission_id` 必須是 `resource:action` 字串，不可以用 `gen_random_uuid()`** ——
0051/0052/0055 都踩過，guard 與前端都是拿 `'resource:action'` 比對，用 uuid 會「勾了卻不生效」
（見 [[pitfall_permission_id_must_be_resource_action]]，修法 migration 0056）。

### 4.4 UI

沿用現有 `RolesManagement.tsx`（276 行），依角色分流：

| | aiproot 看到 | 租戶看到 |
|---|---|---|
| 角色清單 | 6 個 | **3 個**（一般員工／助理／群組負責人）· 總經理室與平台角色不出現 |
| 權限項數 | 64 | **26** |
| 頂部提示 | 現行那句 | 「這裡只調整本公司的角色。需要新的角色請聯繫 AIPROOT。」（現行文案沿用）|
| 已自訂的角色 | — | 標「已自訂 · 不再跟隨系統預設更新」＋「還原成系統預設」按鈕 |

---

## 5. 企業級 cross-cutting

### 5.1 安全模型
- 端點 `@RequirePermission('roles:manage-tenant')` **＋ service 層強制 `tenant_id` 來自 JWT**
  —— 權限碼不是租戶邊界（[[pitfall_permission_code_is_not_tenant_boundary]]）
- 可編輯的角色白名單寫在**後端**：`['employee','assistant','group_owner']`，前端只是呈現
- 可勾選的權限由後端依 scope 過濾，**不接受前端傳來的清單**做為授權依據

### 5.2 觀測與可回復
- 每次變更寫 `audit_log`：誰、哪個角色、加了什麼、拿掉什麼（R5）
- **「還原成系統預設」是必要功能**，不是加分 —— 見 F-3

### 5.3 快取
存檔後呼叫 `invalidateAll()`（現成的）。
⚠️ 不清快取的話最久 5 分鐘後才生效，而使用者會在那 5 分鐘裡以為「改了沒用」再改一次。

### 5.4 向後兼容
沒有租戶編輯過 ＝ 一筆 `roles` 都沒新增 ＝ 行為與現在完全相同。
`users.role_id` 現在多半是 NULL，走 fallback；分岔後才會被寫入。

---

## 6. 落地順序

| 里程碑 | 內容 |
|---|---|
| **M0** | 本文 · 待裁定 OQ-TRP-1..10 |
| **M1** | migration 0067 加 `roles:manage-tenant` ＋ 後端：scope 過濾、角色白名單、fork on edit、audit |
| **M2** | 前端 `RolesManagement` 依角色分流 ＋ 「已自訂」標示 ＋ 「還原成系統預設」 |
| **M3** | 側欄把「權限管理」從平台區移到設定區（對租戶可見）· 走 `PAGE_PERM` 那套既有閘門 |
| **M4** | FMEA 覆核（R17）＋ 更新 [`../roles-permissions-matrix.md`](../roles-permissions-matrix.md) ＋ MODULES.md |

> ⚠️ M1 與 M2 **必須同批上線**：後端開了權限、前端還沒分流，
> 租戶會看到 64 項全清單（含平台權限）—— 那正是 P0-B。

---

## 7. 開放問題（OQ-TRP-N）

| # | 問題 | 建議 |
|---:|---|---|
| **1** | 分岔時機：編輯時 vs 開通時 | **編輯時**（§4.2）· 沒改過的跟著系統更新走 |
| **2** | 租戶可編輯哪些角色？ | `employee` / `assistant` / `group_owner` 三個 · **`tenant_admin` 不可**（P0-C） |
| **3** | 租戶看得到 `platform` 權限嗎？ | **完全不回傳** · 不是灰掉（§4.1 B） |
| **4** | 「還原成系統預設」要做嗎？ | **要**，M2 一起做 · 改壞了要有出口（F-3） |
| **5** | 已自訂的角色，之後我們加新內建權限要不要同步？ | **不同步**，但畫面標示「不再跟隨系統更新」· 自動同步會覆寫客戶的決定 |
| **6** | 群組負責人可以編輯嗎？ | **不行** · 只有 `tenant_admin`（`roles:manage-tenant` 只給他）|
| **7** | 要不要限制「至少保留 N 項權限」？ | **不限制**，但存檔前對「會影響所有人」的移除跳確認（例：拿掉 `warroom:view`）（F-3）|
| **8** | 變更要不要通知該租戶其他管理員？ | v1 不做 · 有 audit 可查；等真的出現爭議再說 |
| **9** | aiproot 還看得到租戶自訂的角色嗎？ | **要**，且要能改回去 —— 客戶改壞了打電話來，我們得看得到他改了什麼 |
| **10** | 這算不算解凍 custom-roles？ | **不算**（§2）· 判準仍是 0/4 |

---

## 8. 失效場景反思（FMEA · R17 · M0 版）

| 路徑 | 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|:--:|---|
| 授權 | 照原樣開放，未分岔 | **一家客戶改到所有客戶** | **P0** | ✅ §4.1 A · fork on edit |
| 授權 | 平台權限出現在租戶清單 | 勾 `binding:aiproot-view` → **看得到別家租戶資料** | **P0** | ✅ §4.1 B · 後端 scope 過濾，不回傳 |
| 授權 | 租戶可編輯 `tenant_admin` | 自我提權成平台管理員 | **P0** | ✅ §4.1 C · 後端白名單排除 |
| 分岔 | 複製了角色但漏改部分使用者的 `role_id` | 那些人**靜默沿用內建角色** · 畫面看起來正常 | **P0** | ⚠️ 分岔與 `role_id` 更新必須同一交易；補一條測試驗「分岔後該租戶該角色的使用者 `role_id` 全部非 NULL」 |
| 使用 | 租戶把 `warroom:view` 從所有角色拿掉 | **整家公司看不到任何東西**，且他自己也救不回來 | **P1** | ⚠️ OQ-4 還原按鈕 ＋ OQ-7 移除前確認 |
| 部署 | 後端先上、前端未分流 | 租戶看到 64 項全清單 ＝ P0-B | **P1** | ✅ §6 M1/M2 同批上線 |
| 生效 | 存檔後沒清快取 | 最久 5 分鐘不生效 → 使用者以為沒用、再改一次 | P1 | ✅ §5.3 存檔即 `invalidateAll()` |
| 實作 | 新權限用 `gen_random_uuid()` 當 `permission_id` | **勾了永遠不生效**，且查不出原因 | P1 | ✅ §4.3 已標 · 已踩過三次（0051/0052/0055）|
| 認知 | 有人以為 custom-roles 解凍了 | 之後被要求做角色工廠 | P2 | ✅ §2 明確劃界 |

**M0 結論：三個 P0 全部出自「照原樣開放」這一個動作 —— 而三個都有結構解，不靠實作紀律。**
第四個 P0（漏改 `role_id`）才是實作期要盯的，因為它**失敗的樣子跟成功一模一樣**。

---

## 9. 變更紀錄

| 日期 | 版本 | 變更 |
|---|---|---|
| 2026-08-21 | v0.1 | M0 DRAFT · 起於用戶「我只是要開放權限管理給租戶自己管理」（第四次提租戶自治）· 查證三個 P0：角色全域共用、34/60 項是平台權限（含跨租戶查詢）、可自我提權 · 設計＝fork on edit ＋ scope 過濾 ＋ 白名單排除 `tenant_admin` · `roles.tenant_id` 與 `users.role_id` 早在 0010 就留好了，結構不用改 · 明確劃清與 custom-roles（仍凍結）的界線 |
