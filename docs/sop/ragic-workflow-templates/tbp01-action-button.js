// ============================================================
// Ragic Action Button · TB-P01 分析表 → LINE 通知
// ============================================================
// Sheet：/order-operation/11（aitode）
// 觸發：使用者按「發送 LINE 通知」按鈕（Action Button · JS Workflow）
// Backend：POST /notify/ragic/analysis-sheet
// 對應：docs/modules/notify.md v1.0
//
// ⚠️ 貼用注意（Ragic Action Button 單行 input 限制）：
//    多行會被壓成空白、// 註解會殺後面 code。BEGIN...END 之間貼那整整一行
//
// 貼用步驟：
// 1. 進 sheet 修改設計 → 表單設定 → 動作按鈕 → 新增「發送 LINE 通知」
// 2. 動作類型：JS Workflow
// 3. 「動作」欄位貼 BEGIN...END 之間那一行
// 4. 把 <REPLACE_WITH_...> 換成 .env 內 secret
// 5. 儲存按鈕 → 儲存表單設定
// ============================================================

/* ============ BEGIN ACTION BUTTON PAYLOAD (單行、無 // 註解) ============ */

var BACKEND_URL = "https://ai-center-line.onrender.com"; var GLOBAL_NOTIFY_SECRET = "<REPLACE_WITH_NOTIFY_WEBHOOK_SECRET_FROM_ENV>"; var RAGIC_ACCOUNT_URL = "https://ap16.ragic.com/aitode"; var SHEET_PATH = "/order-operation/11"; var SHEET_NAME = "TB-P01 分析表"; var rid = __actionButtonExecuteNodeId; var query = db.getAPIQuery(SHEET_PATH); var entry = query.getAPIEntry(rid); var payload = { trigger: "button", sheetPath: SHEET_PATH, sheetName: SHEET_NAME, recordUrl: RAGIC_ACCOUNT_URL + SHEET_PATH + "/" + rid, timestamp: new Date().getTime(), recordId: parseInt(rid, 10) || 0, record: { "分析表編號": entry.getFieldValue(1034502), "狀態": entry.getFieldValue(1031542), "客戶全稱": entry.getFieldValue(1030345), "聯絡地址": entry.getFieldValue(1030346), "訂購單編號": entry.getFieldValue(1030342), "訂購單日期": entry.getFieldValue(1030343), "預交日期": entry.getFieldValue(1032182), "剩餘天數": entry.getFieldValue(1032185), "所屬部門": entry.getFieldValue(1034840), "課稅類別": entry.getFieldValue(1034843), "未稅合計": entry.getFieldValue(1034845), "數量合計": entry.getFieldValue(1034844) } }; util.setHeader("Content-Type", "application/json"); util.setHeader("X-Notify-Secret", GLOBAL_NOTIFY_SECRET); try { var res = util.postURL(BACKEND_URL + "/notify/ragic/analysis-sheet", JSON.stringify(payload)); log.info("[notify] " + res); } catch (e) { log.error("[notify] failed: " + e); }

/* ============ END ACTION BUTTON PAYLOAD ============ */
