# LINE Login OAuth 配置 SOP（aiproot 端）

> 開啟 aiproot 網頁的「以 LINE 登入」功能 · 讓員工用 LINE 帳號一鍵登入 · 免密碼
>
> 版本：v1.0（2026-07-23）｜對應：ai-center-line 加 employee role + LINE OAuth（migration 0020）

---

## 什麼時候用

- 首次啟用 LINE OAuth 功能（一次性 · aiproot 業助執行）
- 重新設定 callback URL（e.g. 換 domain）

---

## 前置條件

- ✅ LINE Login channel 已建（LIFF 綁定已用 · 同一個 channel 復用）
- ✅ aiproot backend 已跑 migration 0020（employee role + LINE OAuth service）
- ✅ Render backend + web static site 已 up

---

## 3 步配置

### Step 1 · LINE Login channel 加 callback URL

1. 進 [LINE Developers Console](https://developers.line.biz/console/)
2. 選 **aiproot Provider** → LINE Login channel (「aiproot 綁定」)
3. 切「**LINE Login**」分頁
4. 找「**Callback URL**」段
5. **新增一行**（保留原有 · 若有）：
   ```
   https://ai-center-line-demo.onrender.com/
   ```
   （這是 aiproot web 網頁 domain · 用戶 LINE 授權後 LINE 會 redirect 回這裡帶 `?code=xxx&state=xxx`）

   **注意 URL 尾巴要有 `/`** · 或依 aiproot web frontend deployed domain 調整

6. Save

### Step 2 · Render backend 加 env

在 Render dashboard → backend service (`ai-center-line`) → **Environment**：

```
LINE_LOGIN_CHANNEL_ID=<從 LINE Login channel Basic settings 拿>
LINE_LOGIN_CHANNEL_SECRET=<從 LINE Login channel Basic settings 拿>
LINE_LOGIN_CALLBACK_URL=https://ai-center-line-demo.onrender.com/
```

**Client ID / Secret 拿法**：
- LINE Login channel → 「Basic settings」分頁
- Channel ID (即 client_id) 顯在最上方
- Channel secret 顯在中間 · 點「Show」看

儲存 · Render 自動 redeploy backend。

### Step 3 · 驗證

1. 打開 aiproot web 登入頁（`https://ai-center-line-demo.onrender.com/`）
2. 應看到底部多一個綠色按鈕「**以 LINE 登入（員工用）**」
3. 拿一個**已完成 LIFF 綁定**的 LINE 帳號測試：
   - 點「以 LINE 登入」→ 跳到 LINE 授權頁
   - 授權 → 自動 redirect 回 aiproot · 直接登入
   - Sidebar 應只有「戰情室 → 我的日報」（因是 employee role）

---

## Troubleshooting

### 「無法產生 LINE 登入連結 · 請確認 aiproot 端已配置」

- Backend `LINE_LOGIN_CHANNEL_ID` env 沒設
- 或 `LINE_LOGIN_CALLBACK_URL` 沒設
- 檢查 Render env

### LINE 授權後回來 · 「LINE 授權失敗 · 請重試」

- backend 的 `LINE_LOGIN_CHANNEL_SECRET` 錯 or 過期
- 或 `LINE_LOGIN_CALLBACK_URL` 跟 LINE Console 的 callback URL 不完全一致
- LINE Console 的 callback URL **要跟 env 一模一樣** · 含結尾 `/`

### 「此 LINE 帳號尚未綁定 aiproot · 請先加 bot 好友完成綁定」

- 該 LINE 帳號沒走過 LIFF 綁定 flow
- 請該員工先加 bot 好友 → 完成 LIFF 綁定 → 再試 LINE 登入

### 主管 LINE 登入後 · sidebar 只有「我的日報」

- 主管的綁定 role 是 employee（因走 LIFF 自服務）
- 主管級 role 需 aiproot 手動改（進「部門/成員」把該 user role 改 `tenant_admin` or `group_owner`）
- 或直接用 email 登入（主管本來就有 email 帳號）

---

## 附錄 · Env 一覽

| Env | 用途 | 範例 |
|---|---|---|
| `LINE_LOGIN_CHANNEL_ID` | LINE Login OAuth client_id | `2010801742` |
| `LINE_LOGIN_CHANNEL_SECRET` | LINE Login OAuth client_secret | 32 字元 hex |
| `LINE_LOGIN_CALLBACK_URL` | LINE 授權後 redirect 目的 | `https://ai-center-line-demo.onrender.com/` |
| `LIFF_URL` | LIFF 綁定用 · 已設 | `https://liff.line.me/2010801742-WBQkAv5t` |

---

## 附錄 · 版本記錄

| 日期 | 版本 | 變更 |
|---|---|---|
| 2026-07-23 | v1.0 | 首版 · 對應 employee role + LINE OAuth |
