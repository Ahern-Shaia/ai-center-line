#!/usr/bin/env bash
# HTML → PDF（headless Chrome）
#
# 為什麼不用 pandoc：本機沒有 xelatex/weasyprint，而中文 PDF 需要 CJK 引擎。
# Chrome 直接吃 HTML 的 @media print，所見即所得，也不用多裝東西。
#
# 用法：scripts/build-pdf.sh docs/sop/某某.html
set -euo pipefail
[ $# -eq 1 ] || { echo "用法：$0 <某某.html>"; exit 1; }
SRC="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="${SRC%.html}.pdf"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "找不到 Chrome"; exit 1; }
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$OUT" "file://$SRC" 2>&1 | grep -i "bytes written" || true
echo "→ $OUT"
