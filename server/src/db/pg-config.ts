// PG 連線設定共用 helper：本機（localhost）不吃 SSL；其他（Render / 雲端 PG）強制 SSL。
// Render 提供的 URL 含 sslmode=require 但 node-postgres 有時仍需明確 ssl option。
export function pgConfig(url: string): { connectionString: string; ssl?: { rejectUnauthorized: boolean } } {
  const isLocal = /^postgres:\/\/[^@]+@(localhost|127\.0\.0\.1)/.test(url);
  return {
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  };
}
