# notify-tenant-scoping · 通知設定開放給總經理

> 狀態：🧊 **預留 / 不建（DEFERRED）**（2026-07-30 用戶裁定）· M0 設計完整、隨時可開工
>
> 相關：[`../roles-permissions-matrix.md`](../roles-permissions-matrix.md) §6、
> [`member-department-assignment.md`](member-department-assignment.md)（同一波「客戶自治」下放）
>
> ⚠️ 動 RLS policy（誰看得到哪些通知規則與**金鑰**），依 R6 先 design 再實作。

---

## 0. ⭐ 裁定：預留不建（2026-07-30）

用戶決定**功能預留就好、現在不做**。理由不是「工作量」，是更根本的**需求存疑**：

> 「客戶也不一定會用到 Ragic 去設定通知。」

也就是說 —— 這個 self-service 的**上游前提**（客戶會自己用 Ragic 觸發通知）本身還沒被驗證。
在那個前提被證實之前，把它做成租戶自助是**投資在一個可能沒人走的路**。
現況「aiproot 代設」對低用量完全夠用。

**解凍條件**（出現任一再開工，M1–M3 已設計好、半天可收）：
- 有客戶**主動要求**自己設通知規則，或代設變成 aiproot 的瓶頸（件數多到做不完）
- 或「Ragic 表單異動 → LINE 通知」被驗證為某垂直市場的核心價值路徑

⚠️ 這個訊號比本模組更大：它其實在問「**Ragic-based 通知**這條路對客戶到底重不重要」——
若答案長期是「不重要」，那不只本模組，連既有的 notify 功能都該重新定位（別再往這方向加碼）。

> 以下 §1–§8 是完整 M0 設計，留著給解凍時直接用。

---

## 1. 目標

讓**總經理（tenant_admin）自己**管自家的通知規則（Ragic 異動 → LINE），
不用每次找 aiproot。這是 [[feedback-tenant-self-governance]] 的又一個實例
（延續 depts/members、master-data、成員部門分配）。

---

## 2. ⚠️ 先更正一個我自己的誤判

我 2026-07-30 一度說「`notify_rule` 沒有 tenant_id/RLS，開給 T 會**跨租戶洩漏**」——
**那是錯的**：我查了一個不存在的表名（`notify_rule`），空結果被誤讀成「沒有欄位」。

實際查證（prod）：

| 表 | tenant_id | RLS | policy |
|---|---|---|---|
| `notification_rule` | ✅ | ✅ | `app_is_platform_ops()` |
| `notify_config`（含 Ragic 金鑰）| ✅ | ✅ | `app_is_platform_ops()` |
| `notification_log` | ✅ | ❌ **無 RLS** | — |

真相是：**RLS 是「平台專屬」不是「租戶隔離」**。`app_is_platform_ops()` 只放行
aiproot/consultant/system。→ 把權限開給 tenant_admin **不會洩漏**（他被 RLS 擋成看到 **0 列**，
[[rule-rls-silent-zero]] 的形狀），但也**不能用**。要能用，得讓 RLS 多認自己的租戶。

**這是「好的起點」** —— 資料模型早就租戶化了（三張表都有 tenant_id），
不用加欄、不用回填，比 [[member-department-assignment]] 還小。難的不是加功能，是**確認沒有漏網的存取路徑**。

---

## 3. ⭐ 巨人的肩膀

「把一個**平台側建的功能**安全地改成**租戶自助**」是多租戶 SaaS 的經典題。四條可直接搬。

### 3.1 隔離要在**最底層**，且每條存取路徑都要過它（AWS SaaS Tenant Isolation）

AWS 的多租戶指南反覆講一句：**tenant isolation 不能只靠應用層**，要在**資料層**（RLS / 分區）
落一道，因為應用層總有人會寫出繞過的查詢。應用層 scope 是「第一道」，RLS 是「擋得住 bug 的那道」。

→ 落地：我們的 controller 已經用 `currentTx()`（繼承租戶上下文）＝第一道；
   但**真正的保證要靠 RLS 加租戶分支**。所以核心改動是 policy，不是 controller。

### 3.2 被遺忘的 log 表 —— 隔離最常漏的地方（Salesforce / AWS 事件資料）

多租戶系統最常見的洩漏不是主表，是**旁邊那張 log / event / audit 表**：主表記得加隔離，
log 表忘了，於是它變成側通道，把「誰在什麼時候收到什麼」全洩出去。

→ **這正是我們的 `notification_log`（無 RLS）**。§4.2 的稽核證實：它就是那張被遺忘的表。
   ⚠️ 開放 logs 端點給 T **之前**必須先補它的 RLS，否則總經理看得到**全平台**的送信紀錄。

### 3.3 自助整合設定：只看自己、無租戶選擇、密鑰只顯示一次（GitHub / Stripe / Slack Webhooks）

一線的自助 webhook / 整合設定有一套穩定慣例：

- **每個帳號只看得到自己的** —— 沒有「選擇帳號」下拉（那是後台/管理員視角）。
- **簽章密鑰只在建立時顯示一次**、加密存、之後不再回顯，要就重新產生。
- **設定是租戶擁有的資料；投遞系統跨租戶讀**（投遞是 system 路徑，與使用者視角分開）。

→ 落地：① tenant_admin 進通知設定要**自動鎖自己租戶、不顯示 tenant 選擇器**（現在是 aiproot 跨租戶視角）。
   ② Ragic API 金鑰**我們已經是「只顯示一次 + 加密存」**（`notify_config` + pgp_sym_encrypt）——
      符合慣例，只要 RLS 租戶分支涵蓋它，金鑰就自動租戶隔離。
   ③ 投遞路徑（webhook 觸發 → 找規則 → 送 LINE）是 system 跑的，**維持跨租戶讀**，不受本次影響。

### 3.4 純加法、不移除既有平台能力（K8s RBAC 的加法原則 · 本專案 custom-roles 已採）

RLS 從 `app_is_platform_ops()` 改成 `app_is_platform_ops() OR tenant_id = current_tenant` ——
**只加不減**：aiproot/consultant 的既有跨租戶能力完全不變，只是多讓租戶看自己的。
這跟 [[custom-roles]] 收下的「純加法無 deny」同一條紀律：不改既有授權面，只擴。

### 3.5 一句話

| 借來的 | 落地 |
|---|---|
| 隔離在最底層 + 每路徑都過（AWS）| 核心是 RLS 加租戶分支，不是改 controller |
| 別忘了 log 表（Salesforce）| `notification_log` 無 RLS → 開 logs 前必補 |
| 自助整合：只看自己、無選擇器、密鑰顯示一次（GitHub/Stripe）| UI 鎖自租戶；Ragic 金鑰已符合，RLS 涵蓋即可 |
| 純加法（K8s/custom-roles）| policy 用 `OR`，平台能力不減 |

---

## 4. 端點稽核（把「站在巨人肩膀上」實際做一遍）

巨人第一條就是「稽核每條存取路徑」。所以我把 `notify-config.controller.ts` 逐端點看過。

### 4.1 結論：規則/帳號路徑乾淨，log 路徑是洞

`notify-config.service.ts` **全部用 `currentTx()`**（繼承租戶上下文），
**沒有任何 `withSystemTx` 繞過**。所以：

| 端點群 | scope 手法 | 開放 T 後安全嗎 |
|---|---|---|
| `GET/POST /accounts`、`/accounts/:id/key`、`/accounts/:id/fields` | currentTx（＋部分 resolveTenantId）| ✅ RLS 加租戶分支後，`:id` 存取自動被租戶過濾 |
| `GET /`、`GET/PATCH/DELETE /:id`（規則）| currentTx | ✅ 同上 |
| `GET /notifiable-users`、`/line-groups` | resolveTenantId / currentTx | ✅ |
| **`GET /logs`** | currentTx，但 **`notification_log` 無 RLS** | 🔴 **不安全** —— 無 RLS ＝ 設了 current_tenant 也不過濾 → 看到全平台紀錄 |

### 4.2 ⭐ 唯一的洞：`notification_log`

`:id` 型端點（改/刪某條規則）不明查擁有權、靠 RLS —— 只要 RLS 有租戶分支就安全（AWS §3.1 的道理）。
**但 `notification_log` 沒有 RLS**，所以 `GET /logs` 是唯一會洩漏的路徑（Salesforce §3.2 的「被遺忘的 log 表」）。

`src/notify/notify.repository.ts:8` 自己也留了註解：「Phase 1 不掛 RLS；Phase 2 多租戶時改走 withTenant」——
**現在就是那個 Phase 2。**

---

## 5. 要改什麼（三步，依風險排序）

1. **補 `notification_log` 的 RLS**（P0 前置）· policy 同其他兩張表：`app_is_platform_ops() OR tenant_id = current_tenant`
2. **三張表的 RLS 加租戶分支** · `notification_rule` / `notify_config` / `notification_log`
3. **授權 + UI** · `notify-config:view/manage` 加給 `tenant_admin`；通知設定頁對 tenant_admin **鎖自租戶、隱藏 tenant 選擇器**

無需：加欄、回填、改 service tx（已是 currentTx）、動投遞路徑。

---

## 6. FMEA（P0 先列）

| 失效模式 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|
| `notification_log` 沒補 RLS 就開 logs 給 T | 總經理看到**全平台**送信紀錄（誰發給誰）| **P0** | 🔒 §5 步驟 1 先補 · 測試：T 只看得到自己租戶的 log |
| RLS 分支寫錯（漏 `tenant_id = current_tenant` 的括號/型別）| 看到別家規則與**金鑰** | **P0** | 🔒 policy 測試：T@A 看不到 B 的規則/帳號 · 對照 [[rule-rls-silent-zero]] 的 AND/OR 陷阱 |
| 日後有人加一個 `withSystemTx` 的 notify 端點 | 繞過 RLS ＝ 跨租戶洞 | P1 | 🔒 §4 稽核結論寫進測試：斷言 notify service 不出現 withSystemTx（原始碼斷言，如 route-guard）|
| UI 沒鎖租戶、tenant_admin 看到選擇器 | 體驗混亂（點了也被 RLS 擋成空）| P1 | 🔒 §5 步驟 3：非平台角色隱藏 tenant 選擇 |

**任一 P0 未緩解不得上 prod（R17）。**

---

## 7. 里程碑

| # | 內容 |
|---|---|
| **M0** 📋 | 本文件（含端點稽核）· 待裁定 OQ-NTS-1..5 ← 在這 |
| **M1** | migration：三張表 RLS 加租戶分支（含 `notification_log` 補 RLS）+ 授權 tenant_admin |
| **M2** | UI 鎖自租戶（隱藏 tenant 選擇器）+ 原始碼斷言測試（notify 不得用 withSystemTx）|
| **M3** | policy 隔離測試（T@A 看不到 B 的規則/金鑰/log）+ FMEA 覆核 + 上線 |

---

## 8. 開放問題（OQ-NTS-N）

| # | 問題 | 建議 |
|---|---|---|
| **OQ-NTS-1** | 現在做，還是先擱著（aiproot 代設也行）？ | **可緩** —— MDA 已解客戶最痛的「分配成員」；notify 客戶目前用量低，代設可接受。但**工作量小**（純 RLS + 授權 + UI 鎖），有半天就能收 |
| **OQ-NTS-2** | assistant（notify 專屬窄角色）怎麼辦？ | 保留 —— 開放 T 後 assistant 仍可存在（給只管通知、無總經理權限的人）|
| **OQ-NTS-3** | Ragic 金鑰讓 T 自己填？ | 可以（是他公司的 Ragic）· 金鑰已「加密存 + 只顯示一次」，RLS 租戶分支涵蓋即安全 |
| **OQ-NTS-4** | logs 開給 T？ | 開，但**先補 RLS**（P0）· 客戶看自己的送信成敗合理 |
| **OQ-NTS-5** | 投遞路徑要不要一起租戶化？ | **不要動** —— 它是 system 跑的、本來就該跨租戶讀規則來投遞。本模組只碰使用者視角 |

---

## 9. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-30 | v0.2 | **站在巨人肩膀上 + 端點稽核** · ⭐ 實際稽核 `notify-config.controller/service`：規則/帳號路徑**全用 currentTx、無 withSystemTx 繞過**（RLS 加租戶分支即安全）· ⭐ 唯一的洞是 `notification_log`（無 RLS + logs 端點不帶租戶上下文）＝巨人講的「被遺忘的 log 表」（Salesforce/AWS）· 借四條：隔離在最底層+每路徑都過（AWS）、別忘 log 表、自助整合只看自己/無選擇器/密鑰顯示一次（GitHub/Stripe，我們 Ragic 金鑰已符合）、純加法 policy 用 OR（K8s/custom-roles）· 收斂成三步（補 log RLS → 三表加租戶分支 → 授權+UI 鎖租戶）· FMEA 兩個 P0 · OQ-NTS-1 仍建議可緩但工作量小 | ahern + Claude Code |
| 2026-07-30 | v0.1 | M0 首版 · 更正「notify 無 tenant_id/RLS 會洩漏」的誤判（查錯表名）| ahern + Claude Code |
