# tenant-provisioning.md — [P1] 租戶開通與帳號安全政策設計文件

> ✅ **狀態：APPROVED — OQ-TP-1..14 全採建議（2026-07-21）· 進 M1**
>
> 把「新客戶上線」與「帳號安全 lifecycle」從 dev-grade 手 SQL 升級到 SaaS 商用級。
> 目前狀態：手 SQL 建 tenant / user · 密碼最短 6 字 · 無過期 / 無鎖定 / 無首次改 · JWT 8h · 無 MFA · 客戶密碼 rotate 走不安全管道。
>
> 這是 aiproot 平台方賣 SaaS 給實客戶（首客台灣福祉）前**必補**的 hardening · 對應 CLAUDE.md R2（安全敏感模組必有測試 + 覆蓋率 > 80%）與 R17（P0 失效不得上 prod）。
>
> 作者：Claude Code（草擬）｜版本：v0.1（2026-07-21）

---

## 1. 目標與範圍

### 1.1 目標

1. **一鍵開通新租戶**：aiproot_admin 在 UI 精靈填客戶公司資訊 → 產出 tenant + 首個 tenant_admin + 預塞 default departments → 產強隨機密碼給客戶（客戶首次登入強制改）
2. **密碼安全政策落地**：min 12 字元 + 複雜度 · 90 天過期 · 首次登入強制改 · 5 次失敗鎖 10 分鐘 · 阻擋近 5 次舊密碼
3. **密碼 rotation flow**：aiproot 可 rotate 任何租戶帳號密碼 · tenant_admin 可 rotate 自家 group_owner · 使用者可自服務改自己密碼（現況缺）
4. **完整 audit trail**：所有帳號 lifecycle 事件（create/update/lock/password_change/failed_login）進 audit_log
5. **不擋現有 M3**：可與 M3 台灣福祉上線並行 · M3 用 Level 1（SQL 手建）· 本模組完成後客戶方 rotate 到 Level 2

### 1.2 對應 stakeholder 訴求

| 子題 | 訴求 | 對應點 |
|---|---|---|
| SaaS 商用 baseline | 委員 / 補助方：不可能只用 demo123 打天下 | §3 資料模型 §7 安全模型 |
| 客戶 onboarding 效率 | aiproot：手 SQL 開一家客戶要 20 分鐘 + 出錯風險 · 精靈 5 分鐘搞定 | §6 UI |
| 客戶信心 | 台灣福祉 IT 委員可能問「密碼幾天到期」「幾次錯誤鎖定」 | §7 policy |
| 合規預備 | 未來政府 / 醫療客戶要求密碼 policy · 現在不做以後大改動 | §7 · §8 Level 3 |

### 1.3 不做的事（Level 2 邊界防 scope creep）

- ❌ **MFA / 2FA / TOTP** — Level 3 · 等大客戶要求或每月 revenue > $10k 再上
- ❌ **SSO / SAML / OIDC** — Level 3 · 企業客戶要求時
- ❌ **Refresh token** — Level 2 保留 JWT 8h · Level 3 補 refresh 讓 session 更長
- ❌ **Password reset via email link** — 需要 email 服務（SendGrid / SES）· Level 2 走 aiproot 手動 rotate · Level 2.5 補 email
- ❌ **完整 session management UI**（列 active sessions · force logout 他方） — Level 3
- ❌ **Compliance mode**（HIPAA / GDPR 等）— Level 3 · 客戶要求時
- ❌ **完整帳號生命週期**（deactivate / archive / delete） — Level 2 有 delete 但無 soft-delete history

---

## 2. 上游 / 既有現況走查

| 元件 | 現況 | Gap |
|---|---|---|
| `users` table | ✅ 有 · 但沒 password 相關欄位 · 沒 lockout counter | 加 4-5 個 column |
| `tenants` table | ✅ 有 · onboard_status 有 4 狀態 | OK |
| `departments` table | ✅ 有 · 已有 tenant-admin CRUD（本輪 M3-8b 落成） | 開通時預塞 default 部門 |
| `audit_log` | ✅ 有 pattern · notify 有用 | 帳號 lifecycle 事件要新增 action type |
| `auth.service` | ✅ bcrypt(10) · JWT 8h | 需擴：密碼複雜度驗證 · failed count · lock check |
| `tenant-admin/user.controller` | ✅ CRUD 完（本輪 M3-8b） | 加「rotate password」action · 加「force change」flag |
| 前端 Login | ✅ 有 · 過期跳 login | 加「首次登入必改密碼」flow |
| 前端「改密碼」自服務 | ❌ 沒 | 全新頁 |
| 前端「開通新租戶」精靈 | ❌ 沒 | 全新頁 · 3-4 步向導 |
| 密碼 policy engine | ❌ 沒 | 新 module（可放 auth/ 內） |
| 失敗鎖定 counter | ❌ 沒 | users 表加欄位 · auth service 檢查 |

---

## 3. 資料模型變更

### 3.1 `users` 表擴充

```sql
-- Migration 0009_password_policy.sql（Level 2）
ALTER TABLE users ADD COLUMN password_updated_at timestamptz;
ALTER TABLE users ADD COLUMN password_expires_at timestamptz;
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until timestamptz;
ALTER TABLE users ADD COLUMN last_login_at timestamptz;
```

### 3.2 `password_history` 新表（阻擋 reuse）

```sql
CREATE TABLE password_history (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  password_hash     text NOT NULL,
  set_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_history_user ON password_history (user_id, set_at DESC);
-- 只保留最近 N 筆（cron 定期 GC · 或每次改密碼時清舊）
```

### 3.3 audit_log 新 action types

- `user_created` · `user_updated` · `user_deleted`
- `password_changed` · `password_reset_by_admin`
- `login_success` · `login_failed`
- `account_locked` · `account_unlocked`
- `tenant_created` · `tenant_activated` · `tenant_suspended`

### 3.4 down migration

```sql
DROP TABLE password_history;
ALTER TABLE users DROP COLUMN password_updated_at;
-- ... 其他 columns
```

---

## 4. API endpoints

### 4.1 租戶開通（aiproot 精靈 · aiproot_admin only）

| Method | Path | 用途 |
|---|---|---|
| POST | `/tenant-provisioning/onboard` | 一鍵開通：建 tenant + tenant_admin + default departments · return admin 初始密碼 |
| GET  | `/tenant-provisioning/preview` | 預覽將建立哪些 defaults（部門 / 設定） |

### 4.2 密碼管理

| Method | Path | 權限 | 用途 |
|---|---|---|---|
| POST | `/auth/change-password` | 已登入使用者 | 自服務改密碼（舊 + 新 + 確認） |
| POST | `/tenant-admin/users/:id/reset-password` | aiproot_admin（跨 tenant） · tenant_admin（own tenant · 限 group_owner） | 管理者 rotate 他人密碼 · 產強隨機或指定 |
| POST | `/tenant-admin/users/:id/unlock` | aiproot_admin | 解鎖被鎖定帳號 |

### 4.3 Response 語意

- `POST /onboard` → return `{ tenantId, adminEmail, initialPassword, mustChangeAtFirstLogin: true }` · **initialPassword 只在 response 出現這一次 · 不入 audit body**
- `POST /reset-password` → 同上結構

---

## 5. 前端 UI

### 5.1 「開通新租戶」精靈 wizard（aiproot 側 · 4 步）

**位置**：新 route `/aiproot/onboarding/new` · 側欄「AIPROOT 管理」群組

**Step 1 · 客戶資訊**：公司名 · 產業別 · 首個 tenant_admin email · 顯示名（王總）
**Step 2 · 預設部門**：勾選 template（工廠標準：報工生產 · 售後服務 · 業務 · 研發 · 品保 · 人資）· 或全空白手動加
**Step 3 · 政策確認**：密碼複雜度 / 過期天數（預設值可微調）· 顯示什麼會被 audit
**Step 4 · 執行 + 展示密碼**：後端 provision · UI 顯示 `admin@客戶.com` + `初始密碼:XxYyZz2026$` + 大字警告「這是唯一顯示這一次的機會」+ [複製] 按鈕 + [完成] 按鈕

### 5.2 自服務「改密碼」

**位置**：Topbar 使用者頭像 dropdown → 「改密碼」

**Modal**：舊密碼 · 新密碼 · 確認 · 強度 meter · 提示複雜度規則 · 存後強制重登入

### 5.3 「首次登入必改密碼」flow

- Login 後端 return 除了 JWT · 額外 `mustChangePassword: true`
- Frontend 遇到 → 立刻導向 `/first-login/change-password` · 強制頁 · 沒改前不能進其他頁
- 改完 → 正常路由

### 5.4 aiproot 「管理密碼」功能

- 進「部門/成員」→ 該成員的編輯 drawer 已有 rotate password（本輪 M3-8b 有）· 補「解鎖帳號」按鈕
- 顯示 last_login_at / failed_login_count / locked_until

### 5.5 設計方向

3 方向 M2 給用戶選 · 這裡先草列：
- 方向 A · **精靈向導風** · 每步一頁 · progress bar · 對標 Stripe onboarding
- 方向 B · **單頁長表單** · 所有欄位攤開 · 折疊分區 · 對標 Linear settings
- 方向 C · **modal 步驟** · 疊層彈窗一步步走

**建議 A** — 資料多 · 步驟解耦（跳過某步 default）· 商用感

---

## 6. 資料流

### 6.1 開通新租戶

```
aiproot_admin 進 /aiproot/onboarding/new
  ↓ 4 步填完 → 按 [完成]
POST /tenant-provisioning/onboard
  ↓
Backend transaction:
  1. INSERT tenants
  2. 產強隨機密碼（20 字 · openssl rand -base64 15 · trim symbols）
  3. bcrypt hash · INSERT users (role=tenant_admin, must_change_password=true, password_expires_at=90d)
  4. Loop INSERT default departments
  5. INSERT audit_log × N
  6. commit
  ↓
Return { tenantId, adminEmail, initialPassword, tenant_admin_userId }
  ↓
UI 顯示密碼一次 · 大字警告 · [複製] · [完成]
```

### 6.2 使用者首次登入改密碼

```
初次 login → Backend 見 must_change_password=true
  ↓ Return { access_token, mustChangePassword: true }
Frontend 見 flag → route 強制到 /first-login/change-password
  ↓ 填新密碼 · 過複雜度驗證
POST /auth/change-password { old, new }
  ↓
Backend:
  1. bcrypt.compare(舊)
  2. 密碼複雜度 check
  3. 對比 password_history 最近 5 筆
  4. bcrypt hash 新 · UPDATE users password_hash · password_updated_at=now · must_change_password=false · password_expires_at=+90d
  5. INSERT password_history
  6. GC 舊 history（保留最近 5 筆）
  7. INSERT audit_log password_changed
  ↓
Return 200 · Frontend 導 /warroom
```

### 6.3 登入失敗鎖定

```
Login attempt
  ↓
if user.locked_until > now → 401 + "已鎖定 · 請 N 分鐘後重試"
elif password 錯:
  failed_login_count++
  if failed_login_count >= 5:
    locked_until = now + 10min
    audit: account_locked
  return 401
elif password 對:
  if user.password_expires_at < now → 401 + "密碼已過期 · 請聯絡 aiproot 重設"
  else:
    failed_login_count = 0
    last_login_at = now
    audit: login_success
    return { access_token }
```

---

## 7. 安全模型

### 7.1 密碼複雜度規則（Level 2 default）

| 規則 | 值 |
|---|---|
| 最短長度 | 12 字元 |
| 需含 | 大寫 + 小寫 + 數字 + 符號（4 選 3 or 4）· 見 OQ-TP-2 |
| 禁 | email prefix · display_name · 常見弱密碼 top 100 |
| 過期 | 90 天（OQ-TP-3） |
| 歷史 | 阻擋最近 5 筆（OQ-TP-4） |
| 失敗鎖定 | 5 次錯 → 鎖 10 min（OQ-TP-5） |

### 7.2 帳號建立權限（feedback_only_aiproot_creates_tenant_accounts）

- 只 aiproot_admin 可透過 `/tenant-provisioning/onboard` 建 tenant + admin
- 只 aiproot_admin 可透過 `/tenant-admin/users` 建 tenant_admin
- tenant_admin 可透過 `/tenant-admin/users` 建 group_owner（限 own tenant）
- **UI ASSIGNABLE_ROLES** enforce 這個規則 · Backend Zod schema 也擋

### 7.3 初始密碼傳遞

- 產於 backend · UI 只顯示一次 · **不入 audit body**（audit 只記「password 已設 · 系統產」）
- aiproot 複製後 · 透過**帶外通道**（電話 / Signal / 當面）給客戶
- **禁忌**：email 明文傳（因為我們沒 email 服務 · Level 2.5 才補 email flow）
- Client 首次登入強制改 · 那時新密碼由 client 選 · aiproot 不知

### 7.4 Audit log 不含敏感

- `password_hash` 絕不入 audit
- `initialPassword` API response 一次 · 不 log
- `failed_login` audit 只記 `{userId, email, ip, timestamp}` · **不記密碼嘗試值**

### 7.5 Rate limit（Level 3）

- `/auth/login` per-IP · 20 次/分鐘（Cloudflare / Render 邊層做 · 不需 code）
- `/tenant-provisioning/onboard` per-user · 5 次/日（防 aiproot admin 賬號被盜刷開一堆 tenant）

---

## 8. 容量估算

### 8.1 現階段（1-3 客戶）

- Tenants < 5 · Users < 30 · password_history < 150 · 忽略不計

### 8.2 未來 100 tenants

- Tenants 100 · Users ~500 · password_history ~2500 · 忽略不計
- DB 完全在 Render Postgres tier 內

---

## 9. 失效場景反思（FMEA）

| # | 場景 | 影響 | 嚴重度 | 緩解 |
|---|---|---|---|---|
| 1 | 開通新 tenant 中間某步失敗 · tenant 建了但 admin 沒建 | 半初始化 tenant · UI 混亂 | **P0** | ✅ 全流程 transaction · 全成或全 rollback |
| 2 | 初始密碼 UI 沒複製就關掉 · 客戶拿不到 | 需 rotate · 走 aiproot 手 rotate 補送 · 客戶等待 | P1 | ⚠️ UI 加二次確認「你確定已複製嗎」 |
| 3 | 密碼複雜度 backend 沒擋 · frontend 漏擋 | 弱密碼進 prod | **P0** | ✅ Backend Zod + password policy service 強制擋 · 前端只是 UX 提示 |
| 4 | 密碼過期後使用者被鎖在門外無法自解 | 客戶無法登入 · 業務中斷 | **P0** | ✅ 過期 7 天前 UI 提醒 · aiproot 有 unlock 能力 |
| 5 | password_history 一直長不清 | DB 慢 | P2 | ✅ 每次寫時 GC 舊筆（保留最近 5） |
| 6 | 失敗鎖定 counter 沒 reset · 一次正確登入後仍卡鎖 | 客戶無法登入 | P1 | ✅ 正確登入時 counter=0 · locked_until=null |
| 7 | JWT 過期沒 refresh · 使用者半途被踢 | UX 差 | P2 | ⚠️ 殘留 · Level 3 補 refresh token |
| 8 | Aiproot admin 帳號被盜 | 全平台淪陷 | **P0** | 🔒 外部 gate · aiproot 帳號應 Level 3 MFA · 現階段密碼 rotation 週期改 30 天 |
| 9 | Password bcrypt cost 太低（10）· 未來被暴力破 | Hash offline crackable | P1 | ⚠️ 殘留 · Level 3 提升 12 · 或改 argon2 |
| 10 | 密碼歷史對比洩漏 hash 對比方式 · timing attack | 攻擊者可推斷密碼特徵 | P2 | ✅ bcrypt.compare 本身 timing-safe |
| 11 | 開通時預塞 department 但客戶不用 · 髒資料 | UI 髒 | P2 | ✅ 客戶可在 UI 刪 |
| 12 | Email 唯一性沒擋 · 建兩個同 email | 登入 ambiguity | P1 | ✅ users email UNIQUE constraint · Zod 檢查 |
| 13 | 開通後客戶方 email 打錯 | 登入不了 · 客戶說「你們給我錯的」 | P1 | ✅ UI Step 1 加 email 確認欄位（打兩次） |
| 14 | 密碼 policy 太嚴客戶覺得麻煩流失 | Business risk | P2 | ⚠️ 殘留 · OQ-TP-2 討論嚴 vs 鬆 |

**P0 3 條**：#1 · #3 · #4 · **必緩解才 ship** · #8 aiproot MFA 是外部 gate · 不擋 Level 2 但 Level 3 必上。

---

## 10. 觀測

- **Log**：所有 auth 事件 struct log · `{userId, email, event, success, ip, ua}`
- **Metric**：per-day login_success · login_failed · account_locked · password_changed 計數
- **Alert**：
  - 同一 email 5 分鐘內 20+ failed login · 疑似暴力破解 · Slack notify aiproot
  - Aiproot admin 帳號 failed login 3+ · 立刻 Slack + email notify
- **Dashboard**（未來）：aiproot 側可看每 tenant 的 auth 健康度

---

## 11. 成本

- DB storage 增：微不足道（password_history GC 到最近 5 筆）
- CPU 增：bcrypt cost 10 每次 login 約 100ms · 影響可忽略
- Email 服務（Level 2.5）：SendGrid free tier 100/day 起 · < $10/月 for 10 tenants
- MFA（Level 3）：自建 TOTP 免費 · 用 Twilio SMS 每則 $0.01

---

## 12. 兼容 · 遷移

- **現有 users** 遷移：跑 migration 加欄位 · `password_updated_at = created_at` · `must_change_password = false`（不強迫既有客戶改）· 但**新登入時檢查 password_expires_at**（NULL 視為不過期，避免既有帳號突然掛）
- **既有 audit_log**：不動 · 新事件用新 action type 名稱
- **既有 auth service**：需擴 · 但保 backward compat（既有 users password_hash 還能用）
- **Notify 模組**：不動
- **LINE ingest**：不動

---

## 13. Open Questions（待用戶裁定）

### 帳號 lifecycle

| # | 題目 | 建議 |
|---|---|---|
| OQ-TP-1 | 初始密碼由 aiproot 產強隨機（客戶首次登入改）· 或 aiproot 讓客戶自訂 | **系統產強隨機** · 一致性 · 安全 |
| OQ-TP-2 | 密碼複雜度規則細節 | 12+ 字 · 大小寫 + 數字 + 符號**四選三**（避免太嚴反被用弱模式） |
| OQ-TP-3 | 密碼過期天數 | **90 天**（可配置 · 商用 baseline） |
| OQ-TP-4 | 密碼歷史阻擋筆數 | **5 筆**（商用 baseline） |
| OQ-TP-5 | 失敗鎖定 · 幾次鎖多久 | **5 次 → 鎖 10 min**（防暴力但不擋一般手誤） |
| OQ-TP-6 | 鎖定後誰能 unlock | aiproot_admin only · 客戶方 tenant_admin 不能 unlock 自家 group_owner（避免內部濫權） |
| OQ-TP-7 | 首次登入強制改密碼 · 用 boolean flag or 用 password_expires_at 設 now() | **flag** · 語意清楚 · 未來 refactor 容易 |
| OQ-TP-8 | 忘記密碼 flow | Level 2：走 aiproot 手 rotate · Level 2.5：email link · Level 3：SMS OTP |

### 開通新租戶精靈

| # | 題目 | 建議 |
|---|---|---|
| OQ-TP-9 | 預設部門模板從哪 | 工廠模板 hard-code 一組（報工生產 / 售後 / 業務 / 研發 / 品保 / 人資）· 未來加「醫療」「食品」等別 |
| OQ-TP-10 | 開通後預塞 LLM config or 讓 aiproot 手動配 | **預塞** · 節省再一步 · 用 aiproot default 家的 provider 帳號額度 |
| OQ-TP-11 | 開通後預塞 LINE bot 或不 | **不預塞** · LINE bot 需客戶提供 channel · 分開 flow |
| OQ-TP-12 | Tenant 名字唯一？ | **唯一** · 避免 UI 混淆 · Zod + DB constraint |

### 政策 / 執行

| # | 題目 | 建議 |
|---|---|---|
| OQ-TP-13 | Aiproot admin 帳號本身要不要更嚴（比 tenant_admin）| **要** · rotation 週期 30 天 · Level 3 強制 MFA |
| OQ-TP-14 | 台灣福祉現有 gm@... demo 帳號 · Level 2 上線後怎辦？ | **標 must_change_password=true** · 過渡期強制他改一次 · aiproot 手動觸發 |

---

## 14. M1–M4 拆解

| 里程 | 內容 | 估算 | 完成準則 |
|---|---|---|---|
| **M1 · Backend policy engine** | migration 0009 · password policy service · auth service 擴 login flow / lock check / expiry check · POST /auth/change-password · policy Zod schema | 1.5 天 | 單元測試 · 手 curl 走過 login 失敗鎖定 / 過期擋 / 改密碼流程 |
| **M2 · Backend onboard endpoint + admin actions** | POST /tenant-provisioning/onboard · POST /reset-password · POST /unlock · 完整 audit | 1 天 | curl onboard 建完整客戶 · rotate 密碼 · 解鎖 |
| **M3 · Frontend 精靈 + 改密碼 + 首次登入 flow** | 4-step wizard · change-password modal · first-login redirect · aiproot member edit drawer 補 unlock · 3 UI 方向先給用戶選 | 2 天 | 手動走一遍：aiproot 開新 tenant · 首次登入強制改 · 3 次錯鎖 · aiproot 解鎖 |
| **M4 · Docs + 台灣福祉遷移 + 上 prod** | tenant-provisioning.md 標 APPROVED · MODULES.md 標 ✅ · 台灣福祉現有 gm@ 帳號跑 migration 觸發 must_change · aiproot 通知客戶「下次登入需改密碼」· prod smoke | 0.5 天 | Prod 走完首個 tenant lifecycle |

**總估算**：**5 天**（與 [[project_phase1_progress]] 排程協商）

---

## 15. Cross-cutting checks（rule_cross_cutting_checks）

- ✅ **Security**：密碼 hash bcrypt 10 · policy engine · rate limit 邊層 · audit 全記 · initial password 不入 log · timing-safe compare
- ✅ **Observability**：per-tenant login metric · alert 暴力破解 · dashboard
- ✅ **Cost**：微不足道 · Level 2.5 email service < $10/月
- ✅ **Compat**：既有 users 遷移平滑 · 既有 audit 不動 · notify / line-ingest 不動

---

## 16. Pre-mortem（rule_pre_mortem_user_triggered_paths · 3 題）

**Path**：Aiproot admin 開通新租戶

1. **5× concurrent** — 5 個 aiproot admin 同時 onboard 同一 email 客戶
   - 影響：users email UNIQUE 擋掉重複 · 但 tenants 可能建 5 個空殼
   - 緩解：M1 · 整個 onboard flow 一 transaction · 檢查 email 是否已存在為第一步

2. **Abuse** — Aiproot admin 帳號被盜 · 攻擊者狂建 tenants
   - 影響：DB 髒 · 未來收費計費會亂
   - 緩解：M1 · per-user rate limit 5 次/日 onboard · 每次 audit + Slack 通知 · Level 3 MFA

3. **Race condition** — 開通時 tenant 建了 · admin 建到一半 backend crash
   - 影響：orphaned tenant · 客戶「說我付錢了怎沒帳號」
   - 緩解：M1 · 全流程 Postgres transaction · 中間任何 fail 都 rollback

**Path**：使用者登入 3 次錯後鎖定

1. **5× concurrent** — 5 個瀏覽器同時試登入
   - 影響：failed_login_count race condition · 可能只加 1 或加 5
   - 緩解：M1 · 用 `UPDATE ... SET count = count + 1 WHERE ...` 原子操作

2. **Abuse** — 攻擊者猜密碼 · 3 次錯鎖 10 min · 攻擊者不在乎繼續下個帳號
   - 影響：被鎖使用者無法登入 10 min · 但攻擊者也不成
   - 緩解：M1 · Rate limit per-IP 邊層擋 · 讓大量嘗試不同 email 也被擋

3. **Race condition** — 使用者剛好在 5 秒內連續按 login button 5 次（前端沒 disable）
   - 影響：正確密碼 · 但 5 次同 request · 有的成功 · 有的可能加 counter
   - 緩解：M1 · counter 只在 password compare fail 時加 · success 時清 · 對 concurrent success 天然無害

---

## 附錄 · 引用文件與 memory

- `docs/modules/notify-multi-tenant.md` — 現有多客戶 pattern
- `docs/modules/line-ingest.md` — aiproot 統包 pattern
- memory `feedback_only_aiproot_creates_tenant_accounts.md` — 帳號建立權限
- memory `rule_fmea_before_ship.md` — FMEA 落地
- memory `rule_pre_mortem_user_triggered_paths.md` — pre-mortem 落地
- memory `rule_cross_cutting_checks.md` — 四檢
- memory `rule_module_design_flow.md` — M0/M1-M4 流程
- CLAUDE.md R2（安全敏感 test 覆蓋 > 80%）· R17（P0 上 prod gate）
