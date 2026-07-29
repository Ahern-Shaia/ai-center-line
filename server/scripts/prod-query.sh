#!/usr/bin/env bash
# 正式環境唯讀診斷。憑證讀 server/.env.prod（不進版控）。
#
# 這支存在的理由是兩個踩過很多次的坑：
#
#  ① RLS 靜默回 0（已踩 10 次）
#     FORCE RLS 之下少設 session 變數 → 查詢回 0 列**而且不報錯**，
#     跟「真的沒有資料」完全分不出來。2026-07-29 就這樣寫出一份錯的 bug 報告。
#     → 本腳本一律先設好 app.actor_role / app.current_tenant。
#
#  ② 手滑寫到 prod
#     → 只放行 SELECT / WITH / EXPLAIN / SHOW，其餘一律拒絕。
#       真要改 prod 請走 migration 並由人執行（CLAUDE.md R10）。
#
# 用法：
#   ./scripts/prod-query.sh "SELECT count(*) FROM tickets"
#   ./scripts/prod-query.sh -f query.sql
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HERE/.env.prod"

[ -f "$ENV_FILE" ] || { echo "找不到 $ENV_FILE"; exit 1; }
set -a; . "$ENV_FILE"; set +a

if [ -z "${PROD_DATABASE_URL:-}" ]; then
  echo "PROD_DATABASE_URL 還沒填 · 請編輯 $ENV_FILE"; exit 1
fi

if [ "${1:-}" = "-f" ]; then
  [ -n "${2:-}" ] || { echo "用法：$0 -f <檔案>"; exit 1; }
  SQL="$(cat "$2")"
else
  SQL="${1:-}"
  [ -n "$SQL" ] || { echo "用法：$0 \"SELECT ...\"  或  $0 -f <檔案>"; exit 1; }
fi

# 只讀。用第一個關鍵字判斷，並擋掉用分號串出來的第二段指令。
FIRST="$(printf '%s' "$SQL" | tr '[:lower:]' '[:upper:]' | grep -oE '[A-Z]+' | head -1)"
case "$FIRST" in
  SELECT|WITH|EXPLAIN|SHOW|TABLE) ;;
  *) echo "❌ 只放行唯讀查詢（開頭是 SELECT / WITH / EXPLAIN / SHOW / TABLE）· 收到：$FIRST"
     echo "   要改 prod 請寫成 migration 並由人執行（CLAUDE.md R10）"; exit 1 ;;
esac
if printf '%s' "$SQL" | grep -qiE ';[[:space:]]*(insert|update|delete|drop|alter|create|truncate|grant)\b'; then
  echo "❌ 偵測到分號後接寫入指令 · 拒絕執行"; exit 1
fi

# ⚠️ 這三行是重點：少了就靜默回 0 列。
#    tickets / departments / users 的 policy 是 AND-only，只設 actor_role 沒用。
psql "$PROD_DATABASE_URL" -P pager=off -v ON_ERROR_STOP=1 <<SQL_EOF
SET default_transaction_read_only = on;
SET app.actor_role = 'aiproot_admin';
$( [ -n "${PROD_TENANT_ID:-}" ] && echo "SET app.current_tenant = '${PROD_TENANT_ID}';" )
$SQL
SQL_EOF
