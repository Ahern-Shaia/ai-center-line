# 追未綁員工 SOP（Aiproot 業助）

> Aiproot 業助日常「追未綁 LINE 員工」的操作 SOP。目的：pilot 客戶員工綁定率 > 80%。
>
> 版本：v1.0（2026-07-23）｜對應：ai-center-line employee-line-binding v1.1

---

## 為什麼要追

員工不綁定 = 無法用個人日報功能 = 客戶價值減半。

**目標**：新客戶上線 2 週內 · 綁定率 > 80%。

**未綁定成因**（依實際 pilot 觀察會補）：
- 員工沒收到通知（HR / 主管沒推廣）
- 員工加了 Bot 但沒點綁定按鈕（覺得多此一舉）
- 員工 LINE 帳號有問題（Bot 好友加不成 · e.g. 業務用 LINE 被封）

---

## 每日 / 每週節奏

| 頻率 | 動作 | 用時 |
|---|---|---|
| 每日 09:00 | 看 Cron 自動掃描結果（log）· 有 alert 才處理 | 2 分鐘 |
| 每週一 10:00 | 進 dashboard 檢視未綁 top 10 · 決定追人 | 15 分鐘 |
| 每週五 16:00 | 追前一週未回應的員工（升級主管）| 15 分鐘 |

---

## 追人 flow · 5 步

### 步驟 1 · 進 Aiproot 「LINE 綁定稽核」

登入 aiproot 後台 → 側欄「AIPROOT 管理 → LINE 綁定稽核」。

頁面上方會顯示 **⚠ 未綁定活躍者 · N 位** 的 alert（若有）：

```
⚠ 未綁定活躍者 · 8 位

這些 LINE 用戶近 7 天在群組發訊 · 但未完成綁定：
- 陳○○（15 則 · 品保部群）
- 李○○（12 則 · 業務部群）
- 王○○（8 則 · 生管部群）
+ 5 位
```

### 步驟 2 · 判定「值得追」的名單

**優先追**：
- ✅ 發言 > 10 則 / 週的員工（活躍 · 有 log 動機）
- ✅ 部門主管（帶頭綁 · 部下跟進）
- ✅ 業務團隊（日常對客戶提工作內容多）

**先跳過**：
- ⏸ 發言 < 3 則 / 週（可能非核心工作用戶 · 觀察 2 週再說）
- ⏸ 上週已聯繫過 · 24h 內綁的另計

### 步驟 3 · 聯繫該員工

**優先透過該員工的部門主管** · 主管出面比 aiproot 陌生訊息有效：

**訊息模板 · 給部門主管**：

```
您好 · 我是 aiproot 業助 [你的名字]。

發現貴部門有以下員工尚未完成 LINE 綁定 · 想請您協助推廣：

- 陳○○
- 王○○

未綁定會讓他們無法用「個人日報」功能。綁定步驟很簡單 · 3 步 · 60 秒：
1. 加公司 Bot 好友（Bot ID 附上）
2. 點 Bot 推的「開始綁定」按鈕
3. 送出

完整教學：[附 employee-binding-onboarding.md link 或截圖]

若有問題我可以直接跟員工說明。感謝！
```

若 24 小時內主管沒動 · 再直接聯繫該員工。

### 步驟 4 · 記錄聯繫日誌

（v1 沒後台工具 · 用個人 Notes / Notion / Excel）

範本欄位：
- 日期
- 員工姓名
- 部門
- 聯繫方式（主管 / 直接 / 電話）
- 回應（已綁 / 承諾綁 / 拒絕 / 未回）
- 下次追蹤日期

### 步驟 5 · 若拒絕綁定

**尊重員工意願** · 不強推。記錄拒絕理由 · 通報客戶方（tenant_admin / HR）。

若客戶方要求全員綁定（強制政策）· 由客戶方主管內部處理 · aiproot 不介入。

---

## Aiproot 手動觸發 nudge（不常用）

**Cron 自動觸發**：每日 09:00 台北 · 自動掃全 tenant · 結果寫 log。

**手動觸發**：若你剛完成推廣 · 想立即看是否有效：

```bash
# Render psql 連 backend · 或用內部 API test tool
curl -X POST https://ai-center-line.onrender.com/personal-daily-report/aiproot/run-scheduler \
  -H "Authorization: Bearer <你的 aiproot token>"
```

（v1 沒 UI · v2 加「立即掃描」button）

---

## 常見情境 · 3 個 quick decision

### 情境 A · 新客戶 · 上線 3 天 · 綁定率 20%

- **正常** · 頭 1 週綁定率通常 < 50%
- 動作：週五推廣一波（透過 tenant_admin 發部門群）· 週一看是否升到 50%
- 若一週後還 < 50% · 建議跟客戶方 HR 談「新員工 onboarding 加此步驟」

### 情境 B · 老客戶 · 綁定率長期 60-70% · 一直不動

- **可能到達自然上限**（20-40% 員工不需 / 不想用個人日報）
- 動作：分析未綁者 profile
  - 是不是都是特定部門？（那部門主管沒推）
  - 是不是都是年長員工？（LINE 操作不熟）
- 對策：不同 profile 不同話術

### 情境 C · 某員工綁定後又被撤銷 · 立即又想綁

- 可能是換手機 or 資料誤刪
- 動作：Aiproot 後台 → LINE 綁定稽核 → 找該員工 revoked 紀錄 → 若確認合理 · 讓員工重走綁定 flow
- 記錄反覆綁定案例 · 若頻繁發生 · 檢查 bug（e.g. LIFF WebView 環境問題）

---

## 何時 escalate 給我方 CTO

- 綁定率 < 30% 且已推廣 2 週
- 大量員工反映「加好友沒收到訊息」（可能 webhook 壞）
- 大量員工反映「綁定成功但用不了」（可能 backend service bug）
- 客戶方主管明確拒絕推廣此功能（產品定位問題 · 需重談）

---

## 附錄 · 相關文件

- [`docs/sop/employee-binding-onboarding.md`](./employee-binding-onboarding.md) · 給員工看的 3 步教學
- [`docs/sop/liff-setup.md`](./liff-setup.md) · Aiproot 建 LIFF SOP · debug 綁定問題查此
- [`docs/modules/employee-line-binding.md`](../modules/employee-line-binding.md) v1.1 · 設計文件 · §7-quinque.13 nudge 邏輯根源

---

## 附錄 · 版本記錄

| 日期 | 版本 | 變更 |
|---|---|---|
| 2026-07-23 | v1.0 | 首版 · 面向 aiproot 業助 · 5 步 flow + 3 情境判斷 |
