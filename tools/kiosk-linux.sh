#!/usr/bin/env bash
# SofaView: Linux でキオスク起動する例（snap 版の Chromium に対応。環境に合わせて調整してください）。
#
#   使い方: tools/kiosk-linux.sh [chromium のコマンド名 または パス]
#
# - Chromium / Chrome for Testing では --load-extension で拡張を読み込めます。
#   製品版 Chrome（137 以降）は --load-extension が無効なので、docs/OPERATIONS.md の「導入方法 B/C」を使ってください。
# - 拡張機能 ID は manifest の key で固定されています（flbnighbcpldceamhclmdncdecjcefpc）。
set -euo pipefail

BROWSER="${1:-chromium}"
EXTRA_ARGS=()

# ssh でつないで実行すると、そのままではつなぎ元（手元のパソコン）の画面に出てしまう（X 転送）。
# ssh のときは、テレビにつないだこのパソコンの画面（:0）に出す。ssh を切っても動き続けるよう、裏で起動する
if [[ -n "${SSH_CONNECTION:-}" || "${DISPLAY:-}" == localhost:* || -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  export DISPLAY="${SOFAVIEW_DISPLAY:-:0}"
  unset WAYLAND_DISPLAY
  if [[ -z "${XAUTHORITY:-}" || ! -f "${XAUTHORITY:-}" ]]; then
    for f in "/run/user/$(id -u)"/.mutter-Xwaylandauth.* "/run/user/$(id -u)/gdm/Xauthority" "$HOME/.Xauthority"; do
      if [[ -f "$f" ]]; then
        export XAUTHORITY="$f"
        break
      fi
    done
  fi
  EXTRA_ARGS+=(--ozone-platform=x11)
  if [[ -z "${SOFAVIEW_DETACHED:-}" ]]; then
    LOG="${SOFAVIEW_LOG:-/tmp/sofaview-kiosk.log}"
    SOFAVIEW_DETACHED=1 setsid nohup bash "${BASH_SOURCE[0]}" "$@" >"$LOG" 2>&1 &
    sleep 4
    echo "テレビの画面（DISPLAY=$DISPLAY）で起動しました。ログ: $LOG" >&2
    cat "$LOG" >&2
    exit 0
  fi
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="${SOFAVIEW_EXT_DIR:-$HERE/extension}"
EXT_ID="flbnighbcpldceamhclmdncdecjcefpc"

# snap 版の Chromium（Ubuntu の `chromium` は snap）は、ホームの「.」で始まる隠しフォルダに書けない。
# 書けないと、設定（プロファイル）が保存されず、読み込んだ拡張機能も毎回消える。snap のときは、snap が書ける場所に置く
is_snap=0
BIN="$(command -v "$BROWSER" 2>/dev/null || true)"
if [[ -n "$BIN" && "$(readlink -f "$BIN")" == /snap/* ]] || { command -v snap >/dev/null 2>&1 && snap list chromium >/dev/null 2>&1 && [[ "$BROWSER" == chromium ]]; }; then
  is_snap=1
fi
if [[ $is_snap == 1 ]]; then
  PROFILE="${SOFAVIEW_PROFILE:-$HOME/snap/chromium/common/sofaview-profile}"
else
  PROFILE="${SOFAVIEW_PROFILE:-$HOME/.sofaview-profile}"
fi
mkdir -p "$PROFILE"

# すでに同じプロファイルで Chromium が動いていると、新しく起動せず、動いているほうにページを開くだけになる
# （--load-extension も --kiosk も無視され、拡張機能が読み込まれない）。先に終了させる
if pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null 2>&1 || { [[ $is_snap == 1 ]] && pgrep -x chromium >/dev/null 2>&1; }; then
  if [[ "${SOFAVIEW_FORCE:-0}" != 1 ]]; then
    echo "Chromium がすでに動いています。先に終了してください（例: pkill -f chromium）。そのまま続けるときは SOFAVIEW_FORCE=1 を付けて実行します。" >&2
    exit 1
  fi
fi

echo "ブラウザ: $BROWSER（snap: $is_snap）" >&2
echo "拡張機能: $EXT_DIR" >&2
echo "プロファイル: $PROFILE" >&2
[[ -f "$EXT_DIR/manifest.json" ]] || { echo "manifest.json が見つかりません: $EXT_DIR" >&2; exit 1; }

# SOFAVIEW_DEBUG=1: 動作確認用。このパソコンの中（127.0.0.1）からだけ、開いているページを見られる
#   curl -s http://127.0.0.1:9222/json/list
if [[ "${SOFAVIEW_DEBUG:-0}" == 1 ]]; then
  EXTRA_ARGS+=(--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1)
fi

# 動作確認用: SOFAVIEW_KIOSK=0 で、普通の窓で開く。SOFAVIEW_URL で、最初に開くページを変える（例: chrome://extensions）
if [[ "${SOFAVIEW_KIOSK:-1}" != 0 ]]; then
  EXTRA_ARGS+=(--kiosk)
fi
START_URL="${SOFAVIEW_URL:-chrome-extension://${EXT_ID}/hub/index.html}"

exec "$BROWSER" \
  "${EXTRA_ARGS[@]}" \
  --user-data-dir="$PROFILE" \
  --load-extension="$EXT_DIR" \
  --autoplay-policy=no-user-gesture-required \
  --noerrdialogs --disable-infobars --no-first-run --no-default-browser-check \
  --disable-session-crashed-bubble --disable-features=Translate,DisableLoadExtensionCommandLineSwitch \
  --password-store=basic \
  "$START_URL"
