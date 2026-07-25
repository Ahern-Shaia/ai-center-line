// LINE OAuth state · 無狀態簽章驗證（CSRF 防護）
// 背景：舊版把 state 存前端 sessionStorage 自驗 → 手機 LINE 內建瀏覽器把導回交給 Safari 時
//       儲存空間不同、state 讀不到 → 員工卡在「state 不符」登不進去。改由後端驗簽。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { LineOauthService } from "../src/auth/line-oauth.service.js";

// 只測純簽章邏輯 · 不碰 DB/JWT（傳 null 即可，這些方法不用到）
const svc = new LineOauthService(null as never, null as never);

function issue(): string {
  process.env.LINE_LOGIN_CHANNEL_ID ??= "test-channel";
  process.env.LINE_LOGIN_CALLBACK_URL ??= "https://example.test/cb";
  return svc.buildAuthUrl().state;
}

test("state · 自己簽發的 → 驗證通過", () => {
  assert.equal(svc.verifyState(issue()), true);
});

test("state · 缺少 → 拒絕", () => {
  assert.equal(svc.verifyState(undefined), false);
  assert.equal(svc.verifyState(""), false);
});

test("state · 格式不符（非三段）→ 拒絕", () => {
  assert.equal(svc.verifyState("abc"), false);
  assert.equal(svc.verifyState("a.b"), false);
});

test("state · 竄改簽章 → 拒絕", () => {
  const s = issue();
  const [nonce, exp] = s.split(".");
  assert.equal(svc.verifyState(`${nonce}.${exp}.forgedsignature`), false);
});

test("state · 竄改效期（想延長）→ 簽章不符被拒", () => {
  const s = issue();
  const [nonce, , sig] = s.split(".");
  assert.equal(svc.verifyState(`${nonce}.${Date.now() + 999_999_999}.${sig}`), false);
});

test("state · 已過期 → 拒絕", () => {
  // 用同一把 secret 自行組一個過期但簽章正確的 state
  const secret = process.env.JWT_SECRET ?? "dev-only-change-me";
  const payload = `deadbeef.${Date.now() - 1000}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  assert.equal(svc.verifyState(`${payload}.${sig}`), false);
});
