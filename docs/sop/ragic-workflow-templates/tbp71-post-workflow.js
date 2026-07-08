// ============================================================
// Ragic Post Workflow · TB-P71 維修保養單-中部 → LINE 通知
// ============================================================
// Sheet：/service-tickets/10（aitode）
// 觸發：記錄儲存後（Sheet 專屬的 Post-workflow · textarea 多行編輯器）
// Backend：POST /notify/ragic/maintenance-report
// 對應：docs/modules/notify.md v0.2
//
// ⚠️ 一定要放在「該 sheet 的 Post-workflow」，不是 Global Workflow
//    Global Workflow 是共用函數庫、不會自動觸發
//
// 貼用步驟：
// 1. 進 sheet 修改設計 → JavaScript Workflow → 上方切「Post-workflow」（不是 Global Workflow）
// 2. Cmd+A 清空編輯區
// 3. 貼此整份
// 4. 把第 22 行 GLOBAL_NOTIFY_SECRET 換成 .env 內實際值
// 5. 儲存 workflow → 儲存修改設計
// ============================================================

var BACKEND_URL = "https://ai-center-line.onrender.com";
var GLOBAL_NOTIFY_SECRET = "<REPLACE_WITH_NOTIFY_WEBHOOK_SECRET_FROM_ENV>";
var RAGIC_ACCOUNT_URL = "https://ap16.ragic.com/aitode"; // 你 Ragic 帳號 base URL
var SHEET_PATH = "/service-tickets/10";
var SHEET_NAME = "TB-P71維修保養單-中部";

// Post workflow 從 param 拿當前記錄（不是 record — Ragic Cloud 2026-07 版本無 record 全域）
var entry = param.getUpdatedEntry();
var recordId = param.getRootNodeId();

var payload = {
  trigger: "save",
  sheetPath: SHEET_PATH,
  sheetName: SHEET_NAME,
  recordUrl: RAGIC_ACCOUNT_URL + SHEET_PATH + "/" + recordId,
  timestamp: new Date().getTime(),
  recordId: parseInt(recordId, 10) || 0,
  record: {
    // 單據 header
    "單據編號":       entry.getFieldValue(1031954),
    "單據日期":       entry.getFieldValue(1031955),
    "來源別":         entry.getFieldValue(1031984),
    "來源單據編號":   entry.getFieldValue(1031985),
    // 車輛
    "車型":           entry.getFieldValue(1031980),
    "車牌號碼":       entry.getFieldValue(1031978),
    "車身號碼":       entry.getFieldValue(1031987),
    "產品序號":       entry.getFieldValue(1031979),
    "出廠日期":       entry.getFieldValue(1031981),
    // 設備
    "設備類型":       entry.getFieldValue(1031988),
    "設備型號":       entry.getFieldValue(1031989),
    "設備序號":       entry.getFieldValue(1031990),
    // 狀況
    "維修保養狀況":   entry.getFieldValue(1031986),
    // 人員
    "維修人員編號":   entry.getFieldValue(1031958),
    "維修人員姓名":   entry.getFieldValue(1031959),
    "經辦人員簽名":   entry.getFieldValue(1031991)
  }
};

util.setHeader("Content-Type", "application/json");
util.setHeader("X-Notify-Secret", GLOBAL_NOTIFY_SECRET);

try {
  var res = util.postURL(
    BACKEND_URL + "/notify/ragic/maintenance-report",
    JSON.stringify(payload)
  );
  log.info("[notify] " + res);
} catch (e) {
  log.error("[notify] failed: " + e);
  // 刻意不 setStatus("ERROR")：LINE 失敗不擋使用者存檔（見 notify.md §7-bis.3）
}
