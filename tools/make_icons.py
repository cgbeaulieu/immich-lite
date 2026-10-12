"""Renders the webOS launcher icons from docs/logo.svg with headless Edge or Chrome.

    python tools/make_icons.py

Writes app/icon.png (80x80) and app/largeIcon.png (130x130), the sizes webOS asks for,
with a transparent background around the rounded square.
"""

import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge",
]
SIZES = {"icon.png": 80, "largeIcon.png": 130}


def main():
    browser = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not browser:
        sys.exit("Needs Edge or Chrome to render the SVG")
    svg = open(os.path.join(ROOT, "docs", "logo.svg"), encoding="utf-8").read()
    with tempfile.TemporaryDirectory() as tmp:
        for name, size in SIZES.items():
            page = os.path.join(tmp, "icon.html")
            with open(page, "w", encoding="utf-8") as f:
                f.write("<!DOCTYPE html><html><body style='margin:0;background:transparent'>"
                        "<div style='width:%dpx;height:%dpx'>%s</div></body></html>"
                        % (size, size, svg.replace('width="96" height="96"', 'width="%d" height="%d"' % (size, size))))
            out = os.path.join(ROOT, "app", name)
            subprocess.run([browser, "--headless", "--disable-gpu", "--hide-scrollbars",
                            "--default-background-color=00000000", "--window-size=%d,%d" % (size, size),
                            "--user-data-dir=" + os.path.join(tmp, "profile"),
                            "--screenshot=" + out, "file:///" + page.replace("\\", "/")],
                           check=True, capture_output=True, timeout=60)
            print("wrote", os.path.relpath(out, ROOT), "(%dx%d)" % (size, size))


if __name__ == "__main__":
    main()
