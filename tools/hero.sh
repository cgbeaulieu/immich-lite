#!/bin/sh
# Renders tools/hero.html (the timeline on a TV, phone sign-in beside it) to docs/hero.png
# with a transparent background, so it sits on GitHub's light and dark themes alike.
# Retake the screenshots first (tools/screenshots.mjs). Needs Edge or Chrome and Pillow.
set -e
cd "$(dirname "$0")/.."
BROWSER="${BROWSER:-C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe}"
HERE="$(pwd -W 2>/dev/null || pwd)"   # Git Bash on Windows: C:/... for the browser
OUT="$HERE/docs/hero.png"
"$BROWSER" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --default-background-color=00000000 --window-size=1600,1000 \
  --screenshot="$OUT" "file:///$HERE/tools/hero.html" 2>/dev/null
python -c "from PIL import Image; im = Image.open('docs/hero.png'); im.save('docs/hero.png', optimize=True)"
echo "saved docs/hero.png"
