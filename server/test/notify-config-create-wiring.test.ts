// controller 的建立端點必須把 body 的每個欄位都轉進 service
//
// 2026-08-12：使用者選好了機器人，後端仍回「請選擇要用哪支機器人發送」。
// 原因是 create 端點**逐欄位重組** body，而 botId 沒被列進去 —— 傳到 service 就是 undefined。
// update 端點把 body 整包丟給 service，所以編輯規則正常、只有新建壞掉。
//
// ⚠️ 逐欄位重組是這裡的結構性風險：每加一個欄位都要在兩個地方寫，
//    而 `botId?: string` 這種選填型別讓「漏掉」照樣編譯得過。
//    CreateRuleInput 的 botId 已改成必填但可為 undefined，漏掉即編譯錯誤。
//    本測試釘住的是「值真的有傳過去」，型別只保證「有寫這個 key」。

import { test } from "node:test";
import assert from "node:assert/strict";
import { NotifyConfigController } from "../src/notify-config/notify-config.controller.js";
import type { CreateRuleInput } from "../src/notify-config/notify-config.service.js";
import type { JwtUser } from "../src/auth/jwt-user.js";

const user = { user_id: "ff000000-0000-4000-8000-0000000000f1" } as JwtUser;

/** 攔下 service 收到的 input · 不碰 DB */
function makeController() {
  let seen: CreateRuleInput | null = null;
  const configs = {
    createRule: async (_u: JwtUser, input: CreateRuleInput) => {
      seen = input;
      return { ruleId: "r1", webhookToken: null };
    },
  };
  const ctrl = new NotifyConfigController(null as never, configs as never, null as never);
  return { ctrl, seen: () => seen };
}

const body = {
  name: "報價單（下游-1）",
  sourceType: "ragic_form" as const,
  ragicAccountId: "8e6c161f-1d64-49c0-9362-15579b094966",
  sheetPath: "/erp/1",
  sheetName: "報價單（下游-1）",
  notifyCreate: true,
  notifyUpdate: true,
  notifyDelete: false,
  title: "測試",
  fields: [{ path: "1035175", label: "客戶簽回", order: 0 }],
  channelType: "line_group" as const,
  channelTarget: "C0179efb56e6ea107ebe9169e047e3d3e",
  botId: "99142261-c99d-4aac-9256-67158382c700",
};

test("⭐ botId 要傳到 service（漏掉會讓使用者選了機器人仍被擋下）", async () => {
  const { ctrl, seen } = makeController();
  await ctrl.create(user, body);
  assert.equal(seen()?.botId, body.botId);
});

test("其餘欄位也沒有在重組時掉東西", async () => {
  const { ctrl, seen } = makeController();
  await ctrl.create(user, body);
  const got = seen();
  assert.ok(got);
  for (const k of ["name", "sourceType", "ragicAccountId", "sheetPath", "sheetName",
    "notifyCreate", "notifyUpdate", "notifyDelete", "title", "channelType", "channelTarget"] as const) {
    assert.deepEqual(got[k], body[k], `欄位 ${k} 在 controller → service 之間掉了`);
  }
  assert.equal(got.fields.length, 1);
});

test("沒帶 botId 時傳 undefined（而不是消失的 key）", async () => {
  const { ctrl, seen } = makeController();
  const { botId: _drop, ...noBot } = body;
  await ctrl.create(user, noBot);
  assert.ok(seen());
  assert.ok("botId" in seen()!, "key 必須存在 · service 才判斷得出「沒選」");
  assert.equal(seen()!.botId, undefined);
});
