// ============================================================
// Ragic Post Workflow · 鮮勇 原料驗貨單（上游-4a） → LINE 通知
// ============================================================
// Sheet：/erp/64（原料驗貨單 · 上游-4a）
// Ragic 帳號：freshfruits（ap16.ragic.com/freshfruits）
// 觸發：記錄儲存後、且「檢驗完成？」欄位為非空 → 才 push（OQ-NMT-9：不每次 save 都發）
// Backend：POST /notify/ragic/material-inspection
// 對應：docs/modules/notify-multi-tenant.md v0.1
//
// ⚠️ 一定要放在「該 sheet 的 Post-workflow」，不是 Global Workflow
//
// 貼用步驟：
// 1. 進 Ragic freshfruits 帳號 → 原料驗貨單 sheet → 修改設計 → JavaScript Workflow → 上方切「Post-workflow」
// 2. Cmd+A 清空編輯區
// 3. 貼此整份
// 4. 把 GLOBAL_NOTIFY_SECRET 換成 backend .env 內 NOTIFY_WEBHOOK_SECRET_XIANYONG 實際值
// 5. 儲存 workflow → 儲存修改設計
// ============================================================

var BACKEND_URL = "https://ai-center-line.onrender.com";
var GLOBAL_NOTIFY_SECRET = "<REPLACE_WITH_NOTIFY_WEBHOOK_SECRET_XIANYONG_FROM_ENV>";
var RAGIC_ACCOUNT_URL = "https://ap16.ragic.com/freshfruits";
var SHEET_PATH = "/erp/64";
var SHEET_NAME = "鮮勇原料驗貨單";

var entry = param.getUpdatedEntry();
var recordId = param.getRootNodeId();

// 條件式 push：僅在「檢驗完成？」欄位有值時才發（OQ-NMT-9 b3）
// 若儲存時該欄位仍為空（未勾選、驗貨中），不打擾業助群
// 已完成的 record 重複儲存 → backend dedup 30 秒窗兜底
var inspectionResult = entry.getFieldValue(1023030);
if (!inspectionResult || String(inspectionResult).length === 0) {
  log.info("[notify] skipped: 檢驗完成 欄位為空、不 push");
} else {
  var payload = {
    trigger: "save",
    sheetPath: SHEET_PATH,
    sheetName: SHEET_NAME,
    recordUrl: RAGIC_ACCOUNT_URL + SHEET_PATH + "/" + recordId,
    timestamp: new Date().getTime(),
    recordId: parseInt(recordId, 10) || 0,
    record: {
      品項名稱: entry.getFieldValue(1018491),
      品編: entry.getFieldValue(1018574),
      批號: entry.getFieldValue(1018604),
      收貨數量: entry.getFieldValue(1018494),
      數量: entry.getFieldValue(1018572),
      單位: entry.getFieldValue(1018495),
      製造有效日期: entry.getFieldValue(1018597),
      檢驗完成: inspectionResult,
    },
  };
  util.setHeader("Content-Type", "application/json");
  util.setHeader("X-Notify-Secret", GLOBAL_NOTIFY_SECRET);
  try {
    // ⚠ 一行寫完 · Ragic Rhino ES5 引擎不支援函數呼叫參數列的尾逗號
    var res = util.postURL(BACKEND_URL + "/notify/ragic/material-inspection", JSON.stringify(payload));
    log.info("[notify] " + res);
  } catch (e) {
    log.error("[notify] failed: " + e);
    // 刻意不 setStatus("ERROR")：LINE 失敗不擋使用者存檔（見 notify.md §7-bis.3）
  }
}
