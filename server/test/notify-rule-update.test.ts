// 通知規則編輯 · 原本只能新增／停用／刪除
//
// 沒有編輯功能時，要調整欄位（prod 有一條規則勾了 61 個欄位）只能整條刪掉重建，
// 而重建會換 webhook 網址 —— 客戶還得回 Ragic 重貼一次。
//
// 這支測試守的是「哪些可以改、哪些絕對不能改」：
// sheetPath 與 webhookToken 一旦改掉，客戶那側貼的網址就對不上了，
// 通知會悄悄停掉，而沒有任何人會收到錯誤。
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withSystemTx } from "../src/db/client.js";
import { RuleRepository } from "../src/notification-hub/rule.repository.js";

const repo = new RuleRepository();

async function seedRule(): Promise<string> {
  return withSystemTx(async (tx) => {
    const { ruleId } = await repo.create(tx, {
      tenantId: null,
      name: "測試規則",
      sourceType: "ragic_form",
      sourceConfig: {
        ragicAccountId: randomUUID(),
        sheetPath: "/erp/15",
        sheetName: "收貨單",
        events: { create: true, update: true, delete: false },
      },
      webhookToken: `tok-${randomUUID().slice(0, 12)}`,
      template: { title: "原標題", items: [{ path: "1", label: "A", order: 0 }] },
      channelType: "line_group",
      channelTarget: "Cold",
      createdBy: null,
    });
    return ruleId;
  });
}

const drop = (id: string) =>
  withSystemTx((tx) => tx.execute(sql`DELETE FROM notification_rule WHERE rule_id = ${id}::uuid`));

test("⭐ 可以改欄位、標題與通知對象", async () => {
  const id = await seedRule();
  try {
    await withSystemTx(async (tx) => {
      const ok = await repo.update(tx, id, {
        name: "改過的名字",
        events: { create: false, update: true, delete: false },
        template: { title: "新標題", items: [{ path: "9", label: "B", order: 0 }] },
        channelType: "line_group",
        channelTarget: "Cnew",
      });
      assert.equal(ok, true);
      const after = (await repo.getById(tx, id))!;
      assert.equal(after.name, "改過的名字");
      assert.equal(after.channelTarget, "Cnew");
      assert.equal((after.template as { title: string }).title, "新標題");
      assert.equal((after.template as { items: unknown[] }).items.length, 1);
    });
  } finally { await drop(id); }
});

test("⭐ 改不到 sheetPath 與 webhook 網址（客戶那側貼好的網址不可被動）", async () => {
  const id = await seedRule();
  try {
    const before = await withSystemTx((tx) => repo.getById(tx, id));
    await withSystemTx((tx) => repo.update(tx, id, {
      name: "隨便改",
      events: { create: true, update: true, delete: true },
      template: { title: "t", items: [{ path: "1", label: "A", order: 0 }] },
      channelType: "line_group",
      channelTarget: "Cx",
    }));
    const after = await withSystemTx((tx) => repo.getById(tx, id));
    assert.equal(after!.webhookToken, before!.webhookToken, "webhook 網址不可被動");
    assert.deepEqual(
      (after!.sourceConfig as { sheetPath: string }).sheetPath,
      (before!.sourceConfig as { sheetPath: string }).sheetPath,
      "表單路徑不可被動",
    );
  } finally { await drop(id); }
});

test("⭐ 觸發事件改得動（events 是 source_config 裡的一部分，不可把整包蓋掉）", async () => {
  const id = await seedRule();
  try {
    await withSystemTx(async (tx) => {
      await repo.update(tx, id, {
        name: "x", events: { create: false, update: false, delete: true },
        template: { title: "t", items: [{ path: "1", label: "A", order: 0 }] },
        channelType: "line_group", channelTarget: "Cx",
      });
      const cfg = (await repo.getById(tx, id))!.sourceConfig as {
        events: { create: boolean; delete: boolean }; sheetName: string;
      };
      assert.equal(cfg.events.delete, true);
      assert.equal(cfg.events.create, false);
      assert.equal(cfg.sheetName, "收貨單", "改 events 不可把 source_config 其他欄位弄丟");
    });
  } finally { await drop(id); }
});

test("不存在的規則 → 回 false，不要靜默當成功", async () => {
  const ok = await withSystemTx((tx) => repo.update(tx, randomUUID(), {
    name: "x", events: null,
    template: { title: "t", items: [] },
    channelType: "line_group", channelTarget: "Cx",
  }));
  assert.equal(ok, false);
});

// ── 換 Ragic 帳號（2026-08-14）─────────────────────────────────────────
// 精靈裡的「Ragic 帳號」下拉在編輯模式下一直是裝飾品：ragicAccountId 從前端 payload、
// controller body、service、到 repository 全鏈都沒有這個欄位。使用者選了新帳號、
// 按儲存、畫面回「已更新」，實際上完全沒換 —— 沒有任何錯誤，只有「怎麼沒生效」。
//
// 這條路在 Ragic 帳號到期／搬庫時是唯一不用刪掉重建的做法（重建會換 webhook 網址）。

test("⭐⭐ 換得動 Ragic 帳號 · 且 sheetPath / webhook / events 不受影響", async () => {
  const id = await seedRule();
  const newAccount = randomUUID();
  try {
    const before = await withSystemTx((tx) => repo.getById(tx, id));
    await withSystemTx((tx) => repo.update(tx, id, {
      name: "x",
      events: { create: true, update: true, delete: false },
      template: { title: "t", items: [{ path: "1", label: "A", order: 0 }] },
      channelType: "line_group", channelTarget: "Cx",
      ragicAccountId: newAccount,
    }));
    const after = await withSystemTx((tx) => repo.getById(tx, id));
    const cfg = after!.sourceConfig as {
      ragicAccountId: string; sheetPath: string; sheetName: string;
      events: { create: boolean; delete: boolean };
    };
    assert.equal(cfg.ragicAccountId, newAccount, "帳號要真的換掉");
    assert.equal(cfg.sheetPath, "/erp/15", "換帳號不可動到表單路徑");
    assert.equal(cfg.sheetName, "收貨單", "換帳號不可把 source_config 其他欄位弄丟");
    assert.equal(cfg.events.create, true, "events 與帳號兩個 patch 要能同時生效");
    assert.equal(after!.webhookToken, before!.webhookToken, "webhook 網址不可被動");
  } finally { await drop(id); }
});

test("⭐ 沒傳 ragicAccountId → 維持原帳號（不可被清成 null）", async () => {
  const id = await seedRule();
  try {
    const before = await withSystemTx((tx) => repo.getById(tx, id));
    await withSystemTx((tx) => repo.update(tx, id, {
      name: "x", events: null,
      template: { title: "t", items: [{ path: "1", label: "A", order: 0 }] },
      channelType: "line_group", channelTarget: "Cx",
    }));
    const after = await withSystemTx((tx) => repo.getById(tx, id));
    assert.equal(
      (after!.sourceConfig as { ragicAccountId: string }).ragicAccountId,
      (before!.sourceConfig as { ragicAccountId: string }).ragicAccountId,
    );
  } finally { await drop(id); }
});
