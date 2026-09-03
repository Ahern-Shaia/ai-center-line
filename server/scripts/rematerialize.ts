/**
 * 重跑材料化 —— 把「當時對不上帳號、現在對得上」的卡片重新歸屬。
 *
 * 【為什麼需要這支】
 * `tickets.assign_status` 是**材料化當下算的快照**，不會因為某人後來建帳號／綁定而更新。
 * 2026-09-03 實證：某位技師的四張卡建立於 8/18，而他的帳號是 **8/19** 才建的 ——
 * resolver 當時回 unclaimed 是正確的，但那四張卡從此**沒有主人、不在任何人的日報裡**，
 * 也沒有任何提示。他等了兩週才自己發現。
 * 全租戶掃出 **256 張 / 19 人**（2026-07-23 ~ 08-31）是同一個成因。
 *
 * `materialize()` 本來就是**冪等**的（ON CONFLICT DO UPDATE），只是先前沒有任何地方可以重跑它。
 *
 * 【重跑會動什麼、不會動什麼】—— 這幾條寫死在 ticket-materializer 的 ON CONFLICT 裡
 *   ✅ 會更新：category / summary / confidence / status / assignee（僅在 assigned_by IS NULL 時）
 *   ✅ 會重算：confirm_status，**但只在待簽核／待確認／存查三區之間**
 *   ❌ 不會動：已簽核 / 已忽略 / 逾時警示（人的決定，重跑不可復活）
 *   ❌ 不會動：assigned_by 非 null 的（主管手動派過）
 *   ❌ 不會動：work_outcome 非 null 的（本人回報過完成）
 *
 * ⚠️⚠️ **預設是 dry-run。** 要真的寫入必須明確加 `--apply`。
 *    這支會寫 prod（R10：由人執行）。
 *
 * 用法：
 *   # 先看會影響什麼（不寫入）
 *   cd server && DATABASE_URL='<prod>' npx tsx --env-file=.env scripts/rematerialize.ts \
 *     --tenant 4d97eced-64c5-4a38-952b-dfce9588ab7c --from 2026-07-01 --to 2026-08-31
 *
 *   # 確認無誤後才加 --apply
 *   … 同上 --apply
 */
import { Pool } from "pg";
import { TicketMaterializerService } from "../src/warroom-task-board/ticket-materializer.service.js";
import { AssigneeResolverService } from "../src/warroom-task-board/assignee-resolver.service.js";

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes("--apply");
const tenantId = arg("tenant");
const from = arg("from");
const to = arg("to");

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUuid = (s?: string) =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const main = async () => {
  if (!process.env.DATABASE_URL) { console.error("❌ 缺 DATABASE_URL"); process.exit(1); }
  if (!isUuid(tenantId)) { console.error("❌ --tenant 要是 uuid（不要貼 placeholder）"); process.exit(1); }
  if (!isDate(from) || !isDate(to)) { console.error("❌ --from / --to 要是 YYYY-MM-DD"); process.exit(1); }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });

  // ── 影響範圍（dry-run 與 apply 都先印）─────────────────────
  // ⚠️ tickets 有 RLS 且沒有平台角色逃生門 —— 沒設 current_tenant 會靜默回 0 列。
  await pool.query(`SELECT set_config('app.actor_role', 'aiproot_admin', false)`);
  await pool.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

  const guard = await pool.query<{ n: string }>(`SELECT count(*)::text n FROM tickets`);
  if (guard.rows[0].n === "0") {
    console.error("❌ 這個租戶一張卡都看不到 —— 是 RLS 沒生效或 tenant 打錯，停止（不要把 0 當結論）");
    process.exit(2);
  }

  const scope = await pool.query<{
    id: string; batch_date: string; n_tickets: string; n_unclaimed: string; n_fixable: string;
  }>(`
    SELECT au.id::text, au.batch_date::text,
           count(t.ticket_id)::text AS n_tickets,
           count(*) FILTER (WHERE t.assign_status = 'unclaimed')::text AS n_unclaimed,
           count(*) FILTER (
             WHERE t.assign_status = 'unclaimed'
               AND t.assignee_display_name IS NOT NULL
               AND EXISTS (SELECT 1 FROM users u
                            WHERE u.tenant_id = t.tenant_id
                              AND lower(btrim(u.display_name)) = lower(btrim(t.assignee_display_name)))
           )::text AS n_fixable
      FROM analysis_upload au
      JOIN tickets t ON t.source_upload_id = au.id
     WHERE au.tenant_id = $1::uuid
       AND au.batch_date BETWEEN $2::date AND $3::date
     GROUP BY au.id, au.batch_date
    HAVING count(*) FILTER (
             WHERE t.assign_status = 'unclaimed'
               AND t.assignee_display_name IS NOT NULL
               AND EXISTS (SELECT 1 FROM users u
                            WHERE u.tenant_id = t.tenant_id
                              AND lower(btrim(u.display_name)) = lower(btrim(t.assignee_display_name)))
           ) > 0
     ORDER BY au.batch_date, au.id
  `, [tenantId, from, to]);

  if (scope.rows.length === 0) {
    console.log("沒有需要重跑的批次 —— 這個範圍內沒有「當時對不上、現在對得上」的卡。");
    await pool.end();
    return;
  }

  let totalFixable = 0;
  console.log(`${APPLY ? "🔴 APPLY（會寫入）" : "🟢 DRY-RUN（不寫入）"} · 租戶 ${tenantId} · ${from} ~ ${to}\n`);
  console.log("upload  日期        卡片  未認領  可救回");
  for (const r of scope.rows) {
    totalFixable += Number(r.n_fixable);
    console.log(
      `${r.id.padStart(6)}  ${r.batch_date}  ${r.n_tickets.padStart(4)}  ${r.n_unclaimed.padStart(6)}  ${r.n_fixable.padStart(6)}`,
    );
  }
  console.log(`\n共 ${scope.rows.length} 批 · 預期可救回 ${totalFixable} 張`);

  if (!APPLY) {
    console.log("\n⚠️ 這是 dry-run，什麼都沒寫。確認無誤後加 --apply 再跑一次。");
    console.log("⚠️ 重跑會重算 confirm_status（僅在待簽核／待確認／存查三區之間）；");
    console.log("   已簽核／已忽略／逾時、主管手動派過的、本人回報完成的，都不會被動到。");
    await pool.end();
    return;
  }

  // ── 真的重跑 ────────────────────────────────────────────
  await pool.end();   // materializer 走自己的連線池（db/client.ts）
  const svc = new TicketMaterializerService(new AssigneeResolverService());
  let ok = 0, failed = 0;
  for (const r of scope.rows) {
    try {
      const res = await svc.materialize(Number(r.id));
      console.log(`  upload=${r.id} · inserted=${res.inserted} updated=${res.updated} skipped=${res.skipped}`);
      ok++;
    } catch (e) {
      // ⚠️ 一批失敗不要中斷其餘的 —— 但一定要印出來，不可以靜默略過
      console.error(`  ❌ upload=${r.id} 失敗：${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }
  console.log(`\n完成 ${ok} 批 · 失敗 ${failed} 批`);
  console.log("⚠️ 跑完請再查一次 unclaimed 的數字確認真的降下來了 —— 「跑完了」不等於「有效」。");
  process.exit(failed > 0 ? 1 : 0);
};

void main();
