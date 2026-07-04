// Demo seed（dev-only）：把本機假資料 data/taiwanhomecare-warroom.json 灌進 DB，
// 讓戰情室有「台灣福祉」真資料可讀（六群組＋tickets，算得出 33/67/62）。
// 帳號：gm@taiwanhomecare.demo（總經理室）/ owner-d2@taiwanhomecare.demo（售後群負責人）· 密碼 demo123。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import bcrypt from "bcryptjs";
import { pgConfig } from "./pg-config.js";

interface WarRoomJson {
  tenant_name: string;
  departments: { department_id: string; name: string; ragic_table: string; line_group_id: string }[];
  tickets: {
    department_id: string;
    category: string;
    summary: string;
    confidence: "high" | "medium" | "low";
    confirm_status: "待簽核" | "已簽核" | "逾時警示";
    confirmed_at: string | null;
    needs_review?: boolean;
    message_count: number;
    created_at: string;
  }[];
}

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("缺 MIGRATION_DATABASE_URL（或 DATABASE_URL）");
  process.exit(1);
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(dir, "../../../data/taiwanhomecare-warroom.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8")) as WarRoomJson;

const TENANT = "77777777-0000-0000-0000-000000000001"; // 台灣福祉 demo 租戶

const c = new pg.Client(pgConfig(url));
await c.connect();
try {
  await c.query("BEGIN");
  // 通過所有表的 FORCE RLS policy：
  // - aiproot_admin 逃生門通過 tenants / users / audit_log 的 policy
  // - current_tenant 通過 departments / tickets（這兩張表沒有 aiproot_admin 逃生門）
  // 本機 dev 用 superuser 連線時 RLS 直接 bypass，這幾行是 no-op；Render 等 non-superuser 環境靠這幾行才過。
  await c.query(`SELECT set_config('app.actor_role', 'aiproot_admin', true)`);
  await c.query(`SELECT set_config('app.current_tenant', $1, true)`, [TENANT]);
  await c.query(`DELETE FROM tenants WHERE tenant_id=$1`, [TENANT]); // FK cascade 清舊 demo 資料
  await c.query(`INSERT INTO tenants (tenant_id, tenant_name, onboard_status) VALUES ($1,'aiproot','測試中')`, [TENANT]);

  const deptMap: Record<string, string> = {};
  for (const d of data.departments) {
    const r = await c.query<{ department_id: string }>(
      `INSERT INTO departments (tenant_id, department_name, line_group_id, extraction_schema, ragic_table)
       VALUES ($1,$2,$3,$4,$5) RETURNING department_id`,
      [TENANT, d.name, d.line_group_id, d.ragic_table, d.ragic_table],
    );
    deptMap[d.department_id] = r.rows[0].department_id;
  }

  let n = 0;
  for (const t of data.tickets) {
    await c.query(
      `INSERT INTO tickets (tenant_id, department_id, category, summary, confidence, confirm_status, confirmed_at, needs_review, message_count, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [TENANT, deptMap[t.department_id], t.category, t.summary, t.confidence, t.confirm_status, t.confirmed_at, t.needs_review ?? false, t.message_count, t.created_at],
    );
    n++;
  }

  const hash = await bcrypt.hash("demo123", 10);
  await c.query(`DELETE FROM users WHERE email IN ('gm@taiwanhomecare.demo','owner-d2@taiwanhomecare.demo','sales-jianguo@taiwanhomecare.demo','rd-zonghan@taiwanhomecare.demo')`);
  const gmRow = await c.query<{ user_id: string }>(
    `INSERT INTO users (tenant_id, role, email, display_name, password_hash) VALUES ($1,'tenant_admin','gm@taiwanhomecare.demo','王總',$2) RETURNING user_id`,
    [TENANT, hash],
  );
  const gmId = gmRow.rows[0].user_id;
  await c.query(
    `INSERT INTO users (tenant_id, role, department_id, email, display_name, password_hash) VALUES ($1,'group_owner',$2,'owner-d2@taiwanhomecare.demo','阿豪',$3)`,
    [TENANT, deptMap["D2"], hash],
  );
  // demo 額外簽核者（用於「已由 XX 確認」呈現，不用登入）
  const jgRow = await c.query<{ user_id: string }>(
    `INSERT INTO users (tenant_id, role, department_id, email, display_name, password_hash) VALUES ($1,'group_owner',$2,'sales-jianguo@taiwanhomecare.demo','建國',$3) RETURNING user_id`,
    [TENANT, deptMap["D4"], hash],
  );
  const jgId = jgRow.rows[0].user_id;
  const zhRow = await c.query<{ user_id: string }>(
    `INSERT INTO users (tenant_id, role, department_id, email, display_name, password_hash) VALUES ($1,'group_owner',$2,'rd-zonghan@taiwanhomecare.demo','宗瀚',$3) RETURNING user_id`,
    [TENANT, deptMap["D6"], hash],
  );
  const zhId = zhRow.rows[0].user_id;

  // JSON 中 D4/D6 已預設 confirm_status='已簽核'，但沒填 confirmed_by（因為當時還沒 user_id）。
  // 這裡補：把已簽核者掛給 建國(D4) / 宗瀚(D6)，並統一時間戳為 09:15 / 09:42（demo 呈現用）。
  const preSigned: { deptCode: string; signerId: string; time: string }[] = [
    { deptCode: "D4", signerId: jgId, time: "2026-07-03T09:15:00+08:00" },
    { deptCode: "D6", signerId: zhId, time: "2026-07-03T09:42:00+08:00" },
  ];
  for (const s of preSigned) {
    await c.query(
      `UPDATE tickets SET confirmed_by=$1, confirmed_at=$2
       WHERE tenant_id=$3 AND department_id=$4 AND confirm_status='已簽核'`,
      [s.signerId, s.time, TENANT, deptMap[s.deptCode]],
    );
  }

  await c.query("COMMIT");
  console.log(`demo seed 完成：租戶「aiproot」· ${data.departments.length} 部門 · ${n} tickets`);
  console.log("帳號：gm@taiwanhomecare.demo（總經理室）/ owner-d2@taiwanhomecare.demo（售後群）· 密碼 demo123");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
