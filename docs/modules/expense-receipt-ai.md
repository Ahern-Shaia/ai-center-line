# 設計文件 · 費用支出拍照 → AI 抽取 → Ragic（M0）

> 狀態：**M0 · 開放問題待用戶裁定**（CLAUDE.md R6）
> 對象：新模組 `server/src/expense/*` + LIFF 費用視圖（`web/src/liff/`）+ Claude vision 抽取 + Ragic 費用支出表。
> 日期：2026-07-24 · 作者：ahern + Claude（含 4 份平行研究）

---

## 1. 需求
外勤員工報公費：**拍照發票/收據/停車證明** → **AI 分析費用** → **調用 Ragic API** → **填寫費用支出表單**。

## 2. 建在什麼之上（既有可複用）
- **Claude 抽取 pipeline**（`src/classify.ts`）：`claude-opus-4-7` + `zodOutputFormat` + adaptive thinking + prompt caching。**目前只吃文字、尚未用 image input** → 本模組新增 vision 路徑（同一結構化輸出 pattern）。
- **媒體即收即存**（`media-download.service.ts` + `line_media` 表）：拍照上傳可複用 S3 存圖 pattern（對齊 R13）。
- **Ragic 寫入 pattern**（`scripts/ragic-api-import.ts:78`）：`POST {BASE}/{ACCOUNT}{sheetPath}?api`、URLEncoded、Basic Auth。
- **LIFF React app**：加 `?page=expense` route，複用 `liff-verify`（access token → 可信 userId）。
- **personal-daily-report**：draft→confirm→sent 的「AI 生成 + 人工確認 + 落庫」CRUD 是本模組直接範本。
- **schemas.ts** 已有分類框架與 `source_ids`/`confidence` 慣例（R11）。

## 3. 技術關鍵（研究結論）
### 3.1 Claude 視覺抽取
- 支援 **JPEG/PNG/WebP**（單張 ≤5MB、單請求 ≤20 張）；**縮到長邊 ≤1568px**（Opus 4.7 視覺 token 上限）；PDF 走 Files API（≤32MB/100 頁）。
- **image 放在指令之前、`temperature=0`**；用 **tool use / output schema（zod）鎖 JSON**，消除解析錯誤（沿用現有 pattern）。
- 結構化文件抽取準確度高 90% 區間；**每欄回 `confidence`、缺漏填 `null`**（R11），低信心走人工確認。

### 3.2 台灣票據特殊性（該抽的欄位 + 陷阱）
- **統一發票**：發票號碼(2字軌+8碼)、日期、賣方統編、**買方統編**、品名、未稅額、**稅額(5%)**、含稅總額；**電子發票證明聯**另有隨機碼/載具。
- **二聯式發票 / 一般收據 無買方統編 → 報帳扣抵受限**（需在 UI 標示）。
- **停車/計程車/加油**：多為收銀機/電子發票，抽車號、時段、油品/公升。
- **🔴 陷阱**：**民國 vs 西元日期**（114→2025，一律正規化為西元、原字串保留）、熱感紙褪色、皺摺反光、**多張混拍需分票**、**金額 vs 稅額混淆**。

### 3.3 法遵 / 去重
- 可扣抵須**統一發票（含買方統編或電子發票）**；純收據多不可扣抵。
- **財政部電子發票 API**（einvoice.nat.gov.tw，需申請 AppID/APIKey）：適合做**發票號碼有效性 + 重複核銷偵測**，**非**任意真偽全自動核驗（查個人明細需使用者授權）。真偽仍靠人工確認迴圈。
- **去重鍵**：`發票號碼 + 賣方統編 + 金額`。

## 4. 資料流（建議）
```
LIFF 費用頁(?page=expense)
  ├─ 拍照（1..N 張）→ 即上傳 → 後端 liff-verify(userId) → 存 S3 + line_media（R13）
  ├─ Claude vision 抽取 → { type, vendor, seller_tax_id, buyer_tax_id, invoice_no,
  │                         date(西元正規化+原字串), amount, tax, category, 每欄 confidence }
  ├─ 去重檢查（invoice_no+統編+amount）→ 命中 → 擋並提示
  ├─ 前端顯示可編輯表單（低信心/缺統編/金額≠未稅+稅 → 標黃要確認）
  └─ 員工確認 → 落 expense_claim（status=confirmed）
主管簽核（選配）→ 寫 Ragic 費用支出表（POST URLEncoded）→ ragic_sync_status
```

## 5. 資料模型（新增，待 OQ 定案）
- **`expense_claim`**：claim_id, tenant_id, user_id, media_ids(jsonb, 對應 line_media), doc_type(`uniform_invoice`/`receipt`/`parking`/`taxi`/`fuel`/…), category(交通/停車/油料/餐費/住宿/雜支), vendor, seller_tax_id, buyer_tax_id, invoice_no, expense_date, amount_untaxed, tax, amount_total, ai_extracted jsonb(含 per-field confidence + source_ids), final jsonb(人工確認後), status(`draft`/`confirmed`/`synced`/`rejected`/`duplicate`), ragic_record_id, created_at。
- RLS 比照 tickets；寫入走 R5 audit log；影像不可變（R11/R13）。

## 6. 失效場景反思（FMEA · 上線前補全 R17）
- 民國日期未正規化 → 費用日期全錯。**P1**（強制正規化 + 顯原字串校對）
- 二聯式/收據無統編當可扣抵送出 → 報帳退件。**P2**（UI 標示、可設「僅收單不扣抵」）
- 多張混拍抽成一筆 → 金額錯。**P1**（引導一票一拍、或 vision 分票 + 人工確認）
- 重複核銷（同張拍兩次）→ 溢領。**P1**（去重鍵 + 可選 einvoice 驗號）
- 金額≠未稅+稅 → 抽取錯。**P2**（一致性校驗標黃）
- Claude 抽取失敗/逾時 → loading/error 三態 + 重試（R8/A6）。**P2**

## 7. 開放問題（OQ · 待裁定才進 M1）
- **OQ-EXP-1 Ragic 目標表**：寫到哪張 Ragic「費用支出」表？**欄位對應**（doc_type/category/金額/統編/發票號/日期/員工/案場）？要不要附**發票照片**到 Ragic（Ragic 支援附檔）？
- **OQ-EXP-2 費用分類 taxonomy**：交通/停車/油料/餐費/住宿/雜支 這組夠嗎？跟 Ragic 既有選項對齊。
- **OQ-EXP-3 憑證政策**：是否**要求統一發票（含統編）**才收？收據/二聯式怎麼處理（收但標「不可扣抵」）？
- **OQ-EXP-4 einvoice API**：現在就串**財政部電子發票查驗**（號碼有效 + 去重），還是先只做內部去重、之後再串？（需申請 AppID/APIKey）
- **OQ-EXP-5 多張處理**：一次拍多張分別成多筆，還是一票一拍？vision 自動分票要不要做？
- **OQ-EXP-6 簽核流程**：員工確認後**自動寫 Ragic**，還是要**主管簽核**才寫？
- ~~OQ-EXP-7 與里程整合（政策衝突）~~ → **已消解**：里程模組（另一份 doc）已裁定為**純距離記錄、不算報銷金額**，故不與油料/停車費用打架。停車/油料照實報即可。（若未來要合「出差報支單」再議）
- **OQ-EXP-8 影像儲存**：沿用 S3（media-download）還是 Ragic 附檔為主？保存年限（報帳憑證法定保存）？

## 附錄 · 來源
- [Claude Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision) · [Claude 檔案/影像限制](https://www.datastudios.org/post/claude-file-upload-limits-and-supported-formats-explained) · [Reliable invoice extraction prompts](https://thomas-wiegold.com/blog/building-reliable-invoice-extraction-prompts/)
- [財政部—統一發票種類](https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/business-tax/invoice/Mm8298) · [二聯式/三聯式發票](https://macrocpa.com.tw/%E4%BA%8C%E8%81%AF%E5%BC%8F%E7%99%BC%E7%A5%A8/)
- [電子發票應用 API 規格 v1.9](https://www.einvoice.nat.gov.tw/static/ptl/ein_upload/attachments/1693297176294_0.pdf) · [API 使用規範 GL010122](https://law-out.mof.gov.tw/LawContent.aspx?id=GL010122)
- [哪些憑證可報帳](https://www.yourator.co/company_blogs/459)
