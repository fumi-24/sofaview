#!/usr/bin/env bash
# SofaView: Linux でキオスク起動する例（未検証。環境に合わせて調整してください）。
#
#   使い方: tools/kiosk-linux.sh [chromium のコマンド名 または パス]
#
# - Chromium / Chrome for Testing では --load-extension で拡張を読み込めます。
#   製品版 Chrome（137 以降）は --load-extension が無効なので、docs/OPERATIONS.md の「導入方法 B/C」を使ってください。
# - 拡張機能 ID は manifest の key で固定されています（flbnighbcpldceamhclmdncdecjcefpc）。
set -euo pipefail

BROWSER="${1:-chromium}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="${SOFAVIEW_EXT_DIR:-$HERE/extension}"
PROFILE="${SOFAVIEW_PROFILE:-$HOME/.sofaview-profile}"
EXT_ID="flbnighbcpldceamhclmdncdecjcefpc"

exec "$BROWSER" \
  --kiosk \
  --user-data-dir="$PROFILE" \
  --load-extension="$EXT_DIR" \
  --autoplay-policy=no-user-gesture-required \
  --noerrdialogs --disable-infobars --no-first-run --no-default-browser-check \
  --disable-session-crashed-bubble --disable-features=Translate \
  --password-store=basic \
  "chrome-extension://${EXT_ID}/hub/index.html"
