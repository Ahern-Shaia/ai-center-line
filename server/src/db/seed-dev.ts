// Dev seed：租戶 A/B ＋ 部門 ＋ tenant_admin 帳號（bcrypt）＋ 待簽核 tickets。
// 以擁有者連線（superuser）繞過 RLS 寫入；僅 dev。帳號：admin-a@demo.test / admin-b@demo.test（pw123）。
import pg from "pg";
import bcrypt from "bcryptjs";

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("缺 MIGRATION_DATABASE_URL（或 DATABASE_URL）");
  process.exit(1);
}

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const hash = await bcrypt.hash("pw123", 10);

  // 乾淨起點（dev 專用）：清掉先前測試/重跑殘留，確保計數可預期
  await c.query(`TRUNCATE audit_log, tickets, users, departments, tenants RESTART IDENTITY CASCADE`);

  await c.query(`
    INSERT INTO tenants (tenant_id, tenant_name) VALUES
     ('11111111-1111-1111-1111-111111111111','租戶A'),
     ('22222222-2222-2222-2222-222222222222','租戶B') ON CONFLICT DO NOTHING;
    INSERT INTO departments (department_id, tenant_id, department_name, line_group_id, extraction_schema, ragic_table) VALUES
     ('a1a1a1a1-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','技術工程','GA1','daily','HR_A'),
     ('a2a2a2a2-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','售後服務','GA2','svc','CRM_A'),
     ('b1b1b1b1-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','技術工程','GB1','daily','HR_B') ON CONFLICT DO NOTHING;
  `);

  await c.query(
    `INSERT INTO users (user_id, tenant_id, role, email, password_hash) VALUES
       ('00000000-000a-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','tenant_admin','admin-a@demo.test',$1),
       ('00000000-000b-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','tenant_admin','admin-b@demo.test',$1)
     ON CONFLICT (user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash, email=EXCLUDED.email`,
    [hash],
  );

  await c.query(`
    INSERT INTO tickets (ticket_id, tenant_id, department_id, summary, confidence, confirm_status) VALUES
     ('00000000-0000-0000-000a-000000000001','11111111-1111-1111-1111-111111111111','a1a1a1a1-0000-0000-0000-000000000001','A-技術待簽核','high','待簽核'),
     ('00000000-0000-0000-000a-000000000002','11111111-1111-1111-1111-111111111111','a2a2a2a2-0000-0000-0000-000000000002','A-售後待簽核','medium','待簽核'),
     ('00000000-0000-0000-000b-000000000001','22222222-2222-2222-2222-222222222222','b1b1b1b1-0000-0000-0000-000000000001','B-技術待簽核','high','待簽核')
    ON CONFLICT (ticket_id) DO NOTHING;
  `);

  console.log("seed-dev 完成：admin-a@demo.test / admin-b@demo.test（密碼 pw123）");
} finally {
  await c.end();
}
