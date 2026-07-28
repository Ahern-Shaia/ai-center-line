// 分析詳情的存取範圍 · 用戶 2026-07-28 裁定「不開放給客戶端」
//
// 這支測試守的不是「有沒有擋」，而是「**擋的地方跟以為的一樣**」。
//
// 2026-07-28 之前的狀況：前端 nav.ts 只給 aiproot / consultant 看到入口，
// 但後端 @Roles 列了 tenant_admin / group_owner —— 介面藏起來、API 開著。
// RLS 還在所以不會跨租戶，但那個門是假的：我們以為擋住了，實際沒有。
//
// 這種不一致沒有任何檢查會紅：tsc 綠、測試綠、畫面上也看不出來，
// 要有人手打網址才會發現。所以直接讀 decorator metadata 釘住。
import { test } from "node:test";
import assert from "node:assert/strict";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../src/auth/roles.decorator.js";
import { ConversationAnalysisController } from "../src/conversation-analysis/conversation-analysis.controller.js";

const reflector = new Reflector();
const proto = ConversationAnalysisController.prototype as unknown as Record<string, () => unknown>;
const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor");

const CLIENT_SIDE_ROLES = ["tenant_admin", "group_owner", "employee"];

test("⭐ 分析詳情的所有端點都不對客戶端開放", () => {
  assert.ok(handlers.length >= 5, `應該掃到多個 handler，實際 ${handlers.length}`);
  for (const name of handlers) {
    const roles = reflector.get<string[]>(ROLES_KEY, proto[name]) ?? [];
    assert.ok(roles.length > 0, `${name} 沒有 @Roles —— 未受保護的端點比開錯還糟`);
    for (const r of CLIENT_SIDE_ROLES) {
      assert.ok(
        !roles.includes(r),
        `${name} 允許了 ${r}。分析詳情是我方維運視角（token 用量／標註工具），` +
        `客戶要對照原文請走任務卡的「查來源」。真要開放請走權限引擎的租戶專屬角色，不要改這裡。`,
      );
    }
  }
});

test("每個端點都只留我方角色", () => {
  for (const name of handlers) {
    const roles = reflector.get<string[]>(ROLES_KEY, proto[name]) ?? [];
    assert.deepEqual([...roles].sort(), ["aiproot_admin", "consultant"], `${name} 的角色清單`);
  }
});
