// Ragic 錯誤訊息 · 不可以用「錯誤代碼」猜原因（2026-08-14）
//
// 起因：403 被一律翻成「訂閱已到期」，但實測同一個代碼至少兩種原因：
//   aitode        → "This Ragic account has expired..."  真的到期
//   2026carhouse  → "no right"                            金鑰不是帳號管理者
// 使用者拿著「請續訂」的訊息去查一個其實是權限的問題，方向整個錯掉。
//
// 這支測試守的是：**分辨靠 Ragic 原文，認不出來就不要猜**。

import { test } from "node:test";
import assert from "node:assert/strict";
import { ragicErrorMessage } from "../src/ragic/ragic-api.client.js";

test("⭐⭐ 403 + expired → 講訂閱到期", () => {
  const m = ragicErrorMessage(403, "This Ragic account has expired. Please log in with SYSadmin user account to renew");
  assert.match(m, /訂閱已到期/);
  assert.doesNotMatch(m, /權限不足/);
});

test("⭐⭐ 403 + no right → 講金鑰權限，不可以說到期", () => {
  const m = ragicErrorMessage(403, "no right");
  assert.match(m, /權限不足/);
  assert.match(m, /帳號管理者|SYSAdmin/);
  assert.doesNotMatch(m, /到期/, "權限問題不可以被講成訂閱到期");
});

test("⭐⭐ 403 + 沒見過的原文 → 不猜原因，把原文丟出來", () => {
  const m = ragicErrorMessage(403, "something we have never seen");
  assert.doesNotMatch(m, /到期|權限不足/);
  assert.match(m, /something we have never seen/, "認不出來時原文一定要留著");
});

test("⭐ 106 + access right protected → 講「這張表有存取權保護」而不是「欄位定義」", () => {
  const m = ragicErrorMessage(
    106,
    "This sheet is access right protected. You will need to provide an API key of a user who has access right to this sheet. You are currently accessing as: guest account",
  );
  assert.match(m, /存取權限保護|存取權/);
  assert.doesNotMatch(m, /讀取欄位定義需要/, "這是讀資料時的權限，不是讀欄位定義");
});

test("⭐ 106 + 其他原文 → 維持原本的欄位定義說法", () => {
  const m = ragicErrorMessage(106, "insufficient privilege");
  assert.match(m, /欄位定義/);
});

test("原文一律附在訊息尾巴（排查時要看得到 Ragic 講了什麼）", () => {
  for (const code of [101, 102, 103, 105, 204, 301, 303, 304, 404, 999]) {
    assert.match(ragicErrorMessage(code, "RAW_MSG"), /RAW_MSG/, `code ${code} 沒帶原文`);
  }
});
