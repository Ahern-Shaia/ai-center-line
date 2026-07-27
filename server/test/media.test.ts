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

// ── 刪除／還原／徹底清除 ─────────────────────────────────────────────
// 最怕的兩件事：
//   ① 以為刪了其實沒刪（畫面消失但檔案還在儲存空間）——誤傳的個資照片就白刪了
//   ② 權限沒守住（群組負責人刪掉別部門的東西 / 客戶方誤觸不可逆的徹底清除）

/** deleted_by 有 FK 指向 users，必須用真實使用者，不能隨手 randomUUID */
async function anyUser(tenantId: string): Promise<string | null> {
  return withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
    const r = await tx.execute<{ user_id: string }>(sql`
      SELECT user_id::text FROM users WHERE tenant_id = ${tenantId}::uuid LIMIT 1
    `);
    return r.rows[0]?.user_id ?? null;
  });
}

async function seedOne(): Promise<{ mediaId: string; tenantId: string } | null> {
  const tenantId = await anyTenant();
  if (!tenantId) return null;
  return withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
    const g = await tx.execute<{ group_id: string; bot_id: string; tenant_id: string }>(sql`
      SELECT g.group_id, g.bot_id::text, b.tenant_id::text
        FROM line_group g JOIN line_bot b ON b.bot_id = g.bot_id LIMIT 1
    `);
    const row = g.rows[0];
    if (!row) return null;
    const mid = `mediatest-${randomUUID()}`;
    await tx.execute(sql`
      INSERT INTO line_message (message_id, tenant_id, bot_id, group_id, sender_line_id,
                                message_type, sent_at, raw_event)
      VALUES (${mid}, ${row.tenant_id}::uuid, ${row.bot_id}::uuid, ${row.group_id}, 'Utest',
              'image', now(), '{}'::jsonb)
    `);
    const m = await tx.execute<{ media_id: string }>(sql`
      INSERT INTO line_media (tenant_id, message_id, media_type, storage_backend, storage_key, content_type)
      VALUES (${row.tenant_id}::uuid, ${mid}, 'image', 's3', ${`test/${mid}`}, 'image/jpeg')
      RETURNING media_id::text
    `);
    return { mediaId: m.rows[0].media_id, tenantId: row.tenant_id };
  });
}

async function cleanup(mediaId: string): Promise<void> {
  await withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null }, (tx) =>
    tx.execute(sql`DELETE FROM line_message WHERE message_id IN (
      SELECT message_id FROM line_media WHERE media_id = ${mediaId}::uuid)`));
}

async function stateOf(mediaId: string) {
  return withTenant({ tenantId: null, role: "aiproot_admin", departmentId: null, userId: null }, async (tx) => {
    const r = await tx.execute<{ deleted_at: string | null; purged_at: string | null; storage_key: string | null }>(sql`
      SELECT deleted_at, purged_at, storage_key FROM line_media WHERE media_id = ${mediaId}::uuid
    `);
    return r.rows[0];
  });
}

test("⭐ 刪除 → 從看板消失，但檔案還在（30 天內救得回來）", async () => {
  const seeded = await seedOne();
  if (!seeded) return;
  const actor = await anyUser(seeded.tenantId);
  if (!actor) return;
  try {
    await asRole({ tenantId: seeded.tenantId, role: "tenant_admin" }, async () => {
      const before = (await svc.list()).items.some((i) => i.mediaId === seeded.mediaId);
      assert.equal(before, true, "剛塞的檔案應該列得出來");

      const r = await svc.softDelete(seeded.mediaId, actor, "誤傳");
      assert.equal(r.daysLeft, 30);

      const after = (await svc.list()).items.some((i) => i.mediaId === seeded.mediaId);
      assert.equal(after, false, "刪除後不該出現在看板");

      const inTrash = (await svc.list({ deleted: true })).items.find((i) => i.mediaId === seeded.mediaId);
      assert.ok(inTrash, "應該出現在已刪除清單");
      assert.equal(inTrash?.daysLeft, 30);
    });
    const s = await stateOf(seeded.mediaId);
    assert.ok(s?.deleted_at, "deleted_at 應有值");
    assert.equal(s?.purged_at, null, "只是隱藏，還沒清除");
    assert.ok(s?.storage_key, "檔案還在，storage_key 不該被抹掉");
  } finally { await cleanup(seeded.mediaId); }
});

test("⭐ 還原 → 回到看板", async () => {
  const seeded = await seedOne();
  if (!seeded) return;
  const actor = await anyUser(seeded.tenantId);
  if (!actor) return;
  try {
    await asRole({ tenantId: seeded.tenantId, role: "tenant_admin" }, async () => {
      await svc.softDelete(seeded.mediaId, actor, null);
      await svc.restore(seeded.mediaId);
      assert.ok((await svc.list()).items.some((i) => i.mediaId === seeded.mediaId), "還原後應回到看板");
    });
  } finally { await cleanup(seeded.mediaId); }
});

test("⭐ 重複刪除 → 404，不會把還原期限偷偷延後", async () => {
  const seeded = await seedOne();
  if (!seeded) return;
  const actor = await anyUser(seeded.tenantId);
  if (!actor) return;
  try {
    await asRole({ tenantId: seeded.tenantId, role: "tenant_admin" }, async () => {
      await svc.softDelete(seeded.mediaId, actor, null);
      const first = await stateOf(seeded.mediaId);
      await assert.rejects(() => svc.softDelete(seeded.mediaId, actor, null), /已經被刪除/);
      const second = await stateOf(seeded.mediaId);
      assert.equal(String(second?.deleted_at), String(first?.deleted_at), "deleted_at 不該被覆寫");
    });
  } finally { await cleanup(seeded.mediaId); }
});

test("⭐ 已刪除的檔案 · 別的租戶看不到（刪除清單也要守租戶界線）", async () => {
  const seeded = await seedOne();
  if (!seeded) return;
  const actor = await anyUser(seeded.tenantId);
  if (!actor) return;
  try {
    await asRole({ tenantId: seeded.tenantId, role: "tenant_admin" }, () =>
      svc.softDelete(seeded.mediaId, actor!, null));
    const other = await asRole(
      { tenantId: "00000000-0000-0000-0000-0000000000ee", role: "tenant_admin" },
      () => svc.list({ deleted: true }),
    );
    assert.equal(other.items.length, 0);
  } finally { await cleanup(seeded.mediaId); }
});

test("⭐ 徹底清除失敗時不可標記為已清除（以為刪了其實沒刪 = 最糟結局）", async () => {
  const seeded = await seedOne();
  if (!seeded) return;
  try {
    // 本機沒設定儲存空間 → purge 應該丟錯，而且 DB 不可被改成 purged
    await asRole({ tenantId: seeded.tenantId, role: "aiproot_admin" }, async () => {
      await assert.rejects(() => svc.purge(seeded.mediaId), /儲存空間未設定/);
    });
    const s = await stateOf(seeded.mediaId);
    assert.equal(s?.purged_at, null, "抹檔失敗就不能標記成已清除");
    assert.ok(s?.storage_key, "storage_key 不可在抹檔失敗時被清掉，否則沒人知道要清哪個檔");
  } finally { await cleanup(seeded.mediaId); }
});
