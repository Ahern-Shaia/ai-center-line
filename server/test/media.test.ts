// 素材看板 · docs/modules/media-and-vision.md §2
//
// 這支測試盯兩件事：
//   1. SQL 真的跑得起來 —— 列表查詢有相關子查詢與 RLS session 變數，
//      型別檢查完全看不出寫壞（本專案已多次踩到「tsc 全綠、runtime 才炸」）。
//   2. 部門範圍是真的（FMEA F-3 · P0）—— 素材是照片，跨部門看得到等同資料外洩。
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant, txStore, type Db } from "../src/db/client.js";
import { MediaService } from "../src/media/media.service.js";
import { MediaStorageService } from "../src/line-ingest/media-storage.service.js";

const svc = new MediaService(new MediaStorageService());

// MediaService 走 currentTx()（正式路徑是 TenantTxInterceptor 塞的），測試要自己鋪上下文
const asRole = <T>(
  ctx: { tenantId: string | null; role: string; departmentId?: string | null },
  fn: () => Promise<T>,
): Promise<T> =>
  withTenant(
    { tenantId: ctx.tenantId, role: ctx.role as never, departmentId: ctx.departmentId ?? null, userId: null },
    (tx: Db) => txStore.run(tx, fn),
  );

async function anyTenant(): Promise<string | null> {
  return withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
    const r = await tx.execute<{ tenant_id: string }>(sql`SELECT tenant_id::text FROM tenants LIMIT 1`);
    return r.rows[0]?.tenant_id ?? null;
  });
}

test("列表 SQL 跑得起來 · 空資料也回完整結構（不是丟例外）", async () => {
  const tenantId = await anyTenant();
  if (!tenantId) return;                       // 本機還沒 seed 就跳過
  const res = await asRole({ tenantId, role: "tenant_admin" }, () => svc.list());
  assert.ok(Array.isArray(res.items));
  assert.equal(typeof res.total, "number");
  assert.equal(res.page, 1);
  // 計數四類都要在 · 前端拿 counts[k] 直接顯示，缺 key 會變 undefined
  for (const k of ["all", "image", "video", "audio", "file"]) {
    assert.equal(typeof res.counts[k as keyof typeof res.counts], "number", `counts.${k} 應為數字`);
  }
});

test("kind 篩選 · 只回該類型且 total 跟著換分母", async () => {
  const tenantId = await anyTenant();
  if (!tenantId) return;
  const res = await asRole({ tenantId, role: "tenant_admin" }, () => svc.list({ kind: "image" }));
  assert.ok(res.items.every((i) => i.kind === "image"));
  assert.equal(res.total, res.counts.image);
});

test("kind 亂填 → 當成不篩，不可丟 500", async () => {
  const tenantId = await anyTenant();
  if (!tenantId) return;
  const res = await asRole({ tenantId, role: "tenant_admin" }, () => svc.list({ kind: "'; DROP TABLE line_media--" }));
  assert.equal(res.total, res.counts.all);
});

test("⭐ group_owner 沒設部門 → 看不到任何檔案（deny by default · FMEA F-3）", async () => {
  const tenantId = await anyTenant();
  if (!tenantId) return;
  const res = await asRole({ tenantId, role: "group_owner", departmentId: null }, () => svc.list());
  assert.equal(res.items.length, 0, "部門未設定時不可退回「全部看得到」");
  assert.equal(res.counts.all, 0);
});

test("⭐ group_owner 帶不存在的部門 → 一樣看不到（不會撈到別部門的照片）", async () => {
  const tenantId = await anyTenant();
  if (!tenantId) return;
  const res = await asRole(
    { tenantId, role: "group_owner", departmentId: randomUUID() },
    () => svc.list(),
  );
  assert.equal(res.items.length, 0);
});

test("⭐ 取內容 · 查無此檔一律 404（不透露是不存在還是沒權限）", async () => {
  const tenantId = await anyTenant();
  if (!tenantId) return;
  await asRole({ tenantId, role: "tenant_admin" }, async () => {
    await assert.rejects(() => svc.content(randomUUID()), /找不到這個檔案/);
  });
});

test("⭐ 只列真的存下來的檔案 · 下載失敗的不出現在看板", async () => {
  const tenantId = await anyTenant();
  if (!tenantId) return;
  const listed = await asRole({ tenantId, role: "aiproot_admin" }, () => svc.list());
  if (listed.items.length === 0) return;
  const ids = listed.items.map((i) => i.mediaId);
  const bad = await withTenant(
    { tenantId: null, role: "aiproot_admin", departmentId: null, userId: null },
    (tx) => tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM line_media
       WHERE media_id::text = ANY(string_to_array(${ids.join(",")}, ','))
         AND storage_key IS NULL
    `),
  );
  assert.equal(bad.rows[0]?.n ?? 0, 0, "storage_key 為 null 的檔案點了只會拿到 404，不該出現在列表");
});
