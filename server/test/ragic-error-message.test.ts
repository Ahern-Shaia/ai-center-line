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

// ── 重複建立 Ragic 帳號（2026-08-14）────────────────────────────────
// (server, apname) 有唯一索引。想換金鑰的人第一直覺就是「重新建一次帳號」，
// 所以這條路一定會被走到；原本會把 pg 的 23505 原樣丟到畫面上。
import { ConflictException } from "@nestjs/common";
import { RagicAccountService } from "../src/ragic/ragic-account.service.js";
import { txStore } from "../src/db/client.js";

// currentTx() 讀 AsyncLocalStorage；這裡只是要讓它有東西可拿，repo 全是 stub 不會真的查
const inTx = <T>(fn: () => Promise<T>): Promise<T> => txStore.run({} as never, fn);

test("⭐⭐ 帳號重複 → 中文說明＋指出該做什麼，不可以吐 pg 原始錯誤", async () => {
  const dup = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
  const svc = new RagicAccountService(
    {
      create: async () => { throw dup; },
      list: async () => [
        { accountId: "a1", tenantId: null, server: "ap16", apname: "2026carhouse", displayName: "福祉 2026carhouse", hasKey: true },
      ],
    } as never,
    {} as never,
  );

  await assert.rejects(
    () => inTx(() => svc.createAccount({ user_id: "u1" } as never, {
      server: "ap16", apname: "2026carhouse", displayName: "台灣福祉", apiKey: "k",
    })),
    (e: unknown) => {
      assert.ok(e instanceof ConflictException);
      const msg = (e as ConflictException).message;
      assert.match(msg, /已經建過了/);
      assert.match(msg, /2026carhouse/, "要指名是哪一個帳號");
      assert.match(msg, /福祉 2026carhouse/, "要講出目前的名稱，使用者才知道去下拉找哪一個");
      assert.match(msg, /更新金鑰/, "要講出真正該做的動作");
      assert.doesNotMatch(msg, /duplicate key|23505|constraint/i, "不可以把 pg 原始錯誤丟給使用者");
      return true;
    },
  );
});

test("⭐ 非 23505 的錯誤照原樣往外丟（不可以被誤判成重複）", async () => {
  const boom = Object.assign(new Error("connection terminated"), { code: "57P01" });
  const svc = new RagicAccountService(
    { create: async () => { throw boom; }, list: async () => [] } as never,
    {} as never,
  );
  await assert.rejects(
    () => inTx(() => svc.createAccount({ user_id: "u1" } as never, {
      server: "ap16", apname: "x", displayName: "x",
    })),
    (e: unknown) => e === boom,
  );
});
