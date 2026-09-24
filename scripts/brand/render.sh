#!/usr/bin/env bash
# Renders the Open Graph card and icon PNGs into public/ with headless Chrome.
# Usage: scripts/brand/render.sh   (needs Google Chrome and python3 with Pillow)
set -euo pipefail
cd "$(dirname "$0")/../.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
BRAND="$PWD/scripts/brand"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

shoot() { # <url> <width> <height> <out>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=1 --default-background-color=00000000 \
    --window-size="$2,$3" --virtual-time-budget=2000 --screenshot="$4" "$1" 2>/dev/null
}

icon() { # <svg> <size> <out>
  printf '<body style="margin:0"><img src="file://%s" width="%s" height="%s" style="display:block">' "$1" "$2" "$2" > "$TMP/icon.html"
  shoot "file://$TMP/icon.html" "$2" "$2" "$3"
}

shoot "file://$BRAND/og-card.html" 1200 630 public/og-image.png
icon "$BRAND/icon-square.svg" 180 public/apple-touch-icon.png
icon "$BRAND/icon-square.svg" 192 public/icon-192.png
icon "$BRAND/icon-square.svg" 512 public/icon-512.png
icon "$PWD/public/favicon.svg" 256 "$TMP/favicon-256.png"

python3 - "$TMP/favicon-256.png" <<'PY'
import sys
from PIL import Image
Image.open(sys.argv[1]).save("public/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
PY

ls -la public
