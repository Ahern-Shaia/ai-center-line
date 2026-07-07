// ============================================================
// Ragic Action Button · TB-P71 維修保養單-中部 → LINE 通知
// ============================================================
// Sheet：/service-tickets/10（aitode）
// 觸發：使用者按「發送 LINE 通知」按鈕（Action Button · JS Workflow）
// Backend：POST /notify/ragic/maintenance-report
// 對應：docs/modules/notify.md v0.2
//
// ⚠️ Ragic Action Button 的 JS 存在單行 <input type="text">，
//    多行會被壓成空白、// 註解會殺掉後面 code、上面這些註解貼進去也會被 flatten。
// 貼用步驟：
// 1. 進 sheet 修改設計 → 表單設定 → 動作按鈕 → 找「發送 LINE 通知」→ 編輯
// 2. 「動作」欄位清空
// 3. 貼下面 ↓↓↓ 「BEGIN ACTION BUTTON PAYLOAD」到 「END」之間那**整整一行**
// 4. 把 <REPLACE_WITH_NOTIFY_WEBHOOK_SECRET_FROM_ENV> 換成 .env 內實際值
// 5. 儲存按鈕 → 儲存表單設定
// ============================================================

/* ============ BEGIN ACTION BUTTON PAYLOAD (單行、無 // 註解) ============ */

var BACKEND_URL = "https://ai-center-line.onrender.com"; var GLOBAL_NOTIFY_SECRET = "<REPLACE_WITH_NOTIFY_WEBHOOK_SECRET_FROM_ENV>"; var SHEET_PATH = "/service-tickets/10"; var rid = __actionButtonExecuteNodeId; var query = db.getAPIQuery(SHEET_PATH); var entry = query.getAPIEntry(rid); var payload = { trigger: "button", sheetPath: SHEET_PATH, recordId: parseInt(rid, 10) || 0, record: { "單據編號": entry.getFieldValue(1031954), "單據日期": entry.getFieldValue(1031955), "來源別": entry.getFieldValue(1031984), "來源單據編號": entry.getFieldValue(1031985), "車型": entry.getFieldValue(1031980), "車牌號碼": entry.getFieldValue(1031978), "車身號碼": entry.getFieldValue(1031987), "產品序號": entry.getFieldValue(1031979), "出廠日期": entry.getFieldValue(1031981), "設備類型": entry.getFieldValue(1031988), "設備型號": entry.getFieldValue(1031989), "設備序號": entry.getFieldValue(1031990), "維修保養狀況": entry.getFieldValue(1031986), "維修人員編號": entry.getFieldValue(1031958), "維修人員姓名": entry.getFieldValue(1031959), "經辦人員簽名": entry.getFieldValue(1031991) } }; util.setHeader("Content-Type", "application/json"); util.setHeader("X-Notify-Secret", GLOBAL_NOTIFY_SECRET); try { var res = util.postURL(BACKEND_URL + "/notify/ragic/maintenance-report", JSON.stringify(payload)); log.info("[notify] " + res); } catch (e) { log.error("[notify] failed: " + e); }

/* ============ END ACTION BUTTON PAYLOAD ============ */
