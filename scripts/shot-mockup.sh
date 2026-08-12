#!/bin/bash
# 把 HTML mockup 截成 PNG（用系統的 Chrome，不裝 headless 套件）
# 用法：scripts/shot-mockup.sh docs/mockup/xxx.html [寬] [高]
set -euo pipefail
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="${SRC%.html}.png"
"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --screenshot="$OUT" --window-size="${2:-1440},${3:-1000}" \
  --default-background-color=FFFFFFFF "file://$SRC" 2>/dev/null
echo "$OUT"
