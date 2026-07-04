// Dev migration runner：以擁有者連線套用 migrations/*.sql（建表/RLS/角色需 owner 權限）。
// prod（R10）：由人工執行 SQL，勿用此自動跑。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("缺 MIGRATION_DATABASE_URL（或 DATABASE_URL）。請先 cp .env.example .env。");
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
  .sort();

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const f of files) {
    process.stdout.write(`→ apply ${f} ... `);
    await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
    console.log("ok");
  }
  console.log(`\n完成：${files.length} 個 migration`);
} finally {
  await client.end();
}
