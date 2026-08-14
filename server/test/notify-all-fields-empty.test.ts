// 每一欄都取不到值時不送出（2026-08-14）
//
// 起因：台灣福祉的 aitode Ragic 帳號訂閱到期 → fetchRecord 回 403 →
// pipeline 降級用 webhook 帶的內容 → 13 個欄位全部渲染成「（未填）」→ 照樣推到客戶群。
// 那種訊息長得跟正常通知一樣但一個資訊都沒有，而且一次 Ragic 批次修改就洗滿整個群。
//
// 釘住兩件事：
//   1. 全部取不到 → 不呼叫 LINE、記成 invalid_body、原因寫進 line_message
//   2. **dot-path 不可以被誤判成取不到** —— 舊的診斷用 `path in payload`，
//      對 "trip.distanceKm" 一律回 false。若拿那個判斷來擋送出，會把正常的
//      internal_event 通知全部擋掉，比原本的問題更嚴重。

import { test } from "node:test";
import assert from "node:assert/strict";
import { NotificationPipeline } from "../src/notification-hub/notification.pipeline.js";
import { countFilledItems } from "../src/notification-hub/template.renderer.js";
import type { NotificationEvent, RuleRow } from "../src/notification-hub/types.js";

interface Written { status: string; lineMessage?: string; messageText?: string }

function build() {
  const written: Written[] = [];
  const pushes: Array<{ to: string; text: string }> = [];
  const line = {
    pushText: async (_token: string, to: string, text: string) => {
      pushes.push({ to, text });
      return { ok: true as const, requestId: "req_test" };
    },
  };
  const audit = { write: async (input: Written) => { written.push(input); } };
  const rules = {
    getLineTokenForBot: async () => "token-test",
    getLineTokenForTenant: async () => "token-test",
    resolveLineUserId: async () => null,
  };
  const pipeline = new NotificationPipeline(
    rules as never, line as never, audit as never,
  );
  return { pipeline, written, pushes };
}

const rule = (items: Array<{ path: string; label: string; order: number }>): RuleRow => ({
  ruleId: "aa000000-0000-4000-8000-00000000aa01",
  tenantId: "bb000000-0000-4000-8000-00000000bb01",
  enabled: true,
  sourceType: "ragic_form",
  sourceConfig: {},
  channelType: "line_group",
  channelTarget: "Ctestgroup00000000000000000000001",
  botId: "cc000000-0000-4000-8000-00000000cc01",
  template: { title: "TB-P01 分析表", items },
} as unknown as RuleRow);

const event = (payload: Record<string, unknown>, diagnostics?: Record<string, unknown>): NotificationEvent => ({
  sourceType: "ragic_form",
  tenantId: "bb000000-0000-4000-8000-00000000bb01",
  eventLabel: "已更新",
  dedupKey: `/order-operation/11:${Math.floor(Math.random() * 1e9)}`,
  payload,
  link: null,
  sourceRef: "/order-operation/11",
  recordId: 29,
  diagnostics,
} as unknown as NotificationEvent);

test("⭐⭐ 欄位全部取不到 → 不推 LINE · 記成 invalid_body", async () => {
  const { pipeline, written, pushes } = build();
  const items = [
    { path: "1031954", label: "分析表編號", order: 0 },
    { path: "1031955", label: "客戶編號", order: 1 },
    { path: "1031956", label: "客戶全稱", order: 2 },
  ];
  // webhook 只帶了記錄編號（fetchRecord 失敗時的降級內容）
  const res = await pipeline.deliver(rule(items), event({ _ragicId: 29 }));

  assert.equal(res.status, "invalid_body");
  assert.equal(pushes.length, 0, "不可以送出全是（未填）的訊息");
  assert.equal(written.length, 1);
  assert.equal(written[0]?.status, "invalid_body");
  assert.match(String(written[0]?.lineMessage), /一個都取不到/);
});

test("⭐ 取不到的原因是抓取失敗時 · 原因要寫進紀錄（不是只說對不上）", async () => {
  const { pipeline, written } = build();
  const items = [{ path: "1031954", label: "分析表編號", order: 0 }];
  const res = await pipeline.deliver(
    rule(items),
    event({ _ragicId: 29 }, { fetchError: "這個 Ragic 帳號的訂閱已到期 —— 需以 SYSadmin 登入 Ragic 續訂" }),
  );

  assert.equal(res.status, "invalid_body");
  assert.match(String(written[0]?.lineMessage), /訂閱已到期/);
});

test("⭐ 只要有一欄取得到值就照送（其餘（未填）是正常的）", async () => {
  const { pipeline, pushes } = build();
  const items = [
    { path: "1031954", label: "分析表編號", order: 0 },
    { path: "1031955", label: "客戶編號", order: 1 },
  ];
  const res = await pipeline.deliver(rule(items), event({ "1031954": "CP-20260801" }));

  assert.equal(res.status, "sent");
  assert.equal(pushes.length, 1);
  assert.match(pushes[0]!.text, /CP-20260801/);
});

test("⭐⭐ dot-path 取得到值 → 不可以被當成全空擋下（舊的 `in` 判斷會誤擋）", async () => {
  const { pipeline, pushes } = build();
  const items = [{ path: "trip.distanceKm", label: "里程", order: 0 }];
  const res = await pipeline.deliver(rule(items), event({ trip: { distanceKm: 12.5 } }));

  assert.equal(res.status, "sent", "巢狀路徑取得到值，必須照送");
  assert.equal(pushes.length, 1);
  assert.match(pushes[0]!.text, /12\.5/);
});

test("模板沒有任何欄位時不套用這個規則（只有標題的通知仍可送）", async () => {
  const { pipeline, pushes } = build();
  const res = await pipeline.deliver(rule([]), event({}));
  assert.equal(res.status, "sent");
  assert.equal(pushes.length, 1);
});

test("countFilledItems：空字串／null／只有空白都算取不到", () => {
  const t = {
    title: "x",
    items: [
      { path: "a", label: "A", order: 0 },
      { path: "b", label: "B", order: 1 },
      { path: "c", label: "C", order: 2 },
      { path: "d", label: "D", order: 3 },
    ],
  } as never;
  assert.equal(countFilledItems(t, { a: "", b: null, c: "   ", d: undefined }), 0);
  assert.equal(countFilledItems(t, { a: "值", b: null, c: "   ", d: undefined }), 1);
  assert.equal(countFilledItems(t, { a: 0, b: false, c: "x", d: "y" }), 4, "0 與 false 是有值");
});
