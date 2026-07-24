# 通知設定（自助）使用指南 SOP

> aiproot 員工在戰情室前端自助設定「Ragic 表單異動 → LINE 通知」：免找欄位編號、免寫/貼程式碼。
> 版本：v1.0（2026-07-25）｜對應：notify v2（notify-selfserve-platform）｜適用：具 `notify-config:manage` 權限的 aiproot 員工

---

## 0. 前置

- [ ] 你的帳號有「**通知設定**」權限（於 AIPROOT 管理 → 權限管理 分配 · aiproot_admin / consultant 預設有）。
- [ ] 該公司的 **Ragic API 金鑰**（需**帳號管理者**權限 · 系統要用它讀表單欄位）。到 Ragic 個人設定產生。
- [ ] 該公司已註冊 LINE Bot（LINE 群才出得來；於通訊接頭層 → LINE 機器人）。

---

## 1. 建立通知設定（前端）

戰情室 → **AIPROOT 管理 → 通知設定** → 右上「**＋ 新增通知設定**」。

1. **選 Ragic 帳號**：下拉選；沒有就按「＋ 新增帳號」填 伺服器（如 ap16）/ 帳號名（apname，如 aitode）/ 顯示名 / API 金鑰 → 儲存。金鑰**加密存、不回明碼**。
2. **選表單**：貼表單路徑（如 `/service-tickets/10`）→ 按「**抓取欄位**」。成功會顯示「✓ 已讀取〔表單名〕· N 個欄位」。
3. **勾要通知的欄位**：點欄位勾選（右邊數字＝訊息中的排列順序，依勾選先後）。可填「自訂標題」（留空用表單名）。
4. **觸發事件 + LINE 群**：開關「新增/更新/刪除」；選 LINE 目標群（該租戶登錄的群；無登錄可直接貼 group id）。
5. 按「**儲存設定**」→ 產生一個 **Webhook 網址**（深色框）→ 按「複製」。

## 2. 接到 Ragic（一次性）

到 **Ragic** → 該表單 → **工具 → Webhook** → 貼上剛複製的網址 → 儲存。

> 之後每次符合條件的異動，Ragic 就會自動打這個網址 → 系統組訊息 → 發到你選的 LINE 群。**不用再貼任何 workflow 程式碼**。

## 3. 驗證

改一筆該表單資料並儲存 → 該 LINE 群應收到通知（【標題｜已更新】逐行欄位:值 + Ragic 連結）。

---

## 常見問題

| 症狀 | 原因 / 解法 |
|---|---|
| 「抓取欄位」失敗 | 金鑰非帳號管理者 / 表單路徑錯 / 伺服器 (server) 填錯 |
| 存檔後沒產生 URL | 沒勾任何欄位、或沒選 LINE 群 |
| Ragic 改資料但沒通知 | Webhook 網址沒貼進該表單 / 該事件（新增/更新/刪除）沒開 / LINE token 失效或 bot 被踢出群 |
| 通知欄位是「（未填）」 | 該欄位在這筆資料本來就空；或金鑰讀不到完整 record（會降級用 webhook 帶的值）|
| 要改設定 | 目前無「編輯」：先**停用/刪除**該筆、再新增一筆（webhook URL 會變、需重貼 Ragic）|
| 看不到「通知設定」選單 | 你的帳號沒有 `notify-config` 權限 → 找 aiproot_admin 於權限管理分配 |

## 附錄

- 這是 v2 自助版；v1（工程師手貼 workflow JS）流程見 [`notify-ragic-line-操作流程.md`](notify-ragic-line-操作流程.md)。
- Ragic API 細節：[`../ragic-http-api-手冊.md`](../ragic-http-api-手冊.md)。
- 設計：[`../modules/notify-selfserve-platform.md`](../modules/notify-selfserve-platform.md)。
