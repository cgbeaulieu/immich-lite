# Developing immich lite

The app is plain ES5 and CSS with no build step: the files in `app/` and `service/` are what ships.
[PLAN.md](PLAN.md) covers the architecture, the immich API calls and the TV engine's limits.

## In a browser

`tools/devserver.py` serves the app and forwards `/api` to your immich server on the same origin, so CORS doesn't get in the way:

```bash
python tools/devserver.py --immich http://192.168.1.10:2283
```

Or with a fake library, no immich needed:

```bash
python tools/devserver.py --mock
```

Open `http://localhost:8000/` on this PC, or `http://<this-pc>:8000/` in the TV's web browser. Leave the server address as filled in and sign in (in mock mode any email and password work, except the password `wrong`). On a PC keyboard, Esc is Back and Enter is OK. The engine probe is at `/capabilities.html` on the same server.

The mock's videos all play the same tiny 6-second clip (built by the dev server, no files needed), except December 2025's, which fail on purpose to show the "can't play" fallback.

Phone sign-in works here too: the dev server offers the TV service's calls under `/pair/`, so the
QR code on the PC's sign-in screen opens on a phone on the same Wi-Fi (Windows may ask to let Python
through the firewall). The service's own tests run on the PC with Node (the relay test needs the
dev server running in mock mode on port 8012):

```bash
node tools/test_pairing.js
```

```bash
node tools/test_proxy.js
```

Before committing JS, check it still parses as ES5:

```bash
for f in app/js/*.js service/*.js; do npx -y acorn@8.14.0 --ecma5 --silent "$f" || echo "not ES5: $f"; done
```

## Screenshots

The fake library can show real stock photos instead of coloured squares. Fetch them once (about 18 MB from [Lorem Picsum](https://picsum.photos), into the git-ignored `tools/stock/`; needs Pillow):

```bash
python tools/stock_photos.py
```

Then run the dev server with them, and take the screenshots in `docs/screenshots/` with headless Edge or Chrome (Node 22 or newer):

```bash
python tools/devserver.py --mock --photos tools/stock --port 8010
```

```bash
node tools/screenshots.mjs
```

Pass shot names (`node tools/screenshots.mjs timeline albums`) to retake only some of them.

## On a TV

Package the app and its service into an IPK:

```bash
npx -y -p @webos-tools/cli ares-package app service -o dist
```

**Developer mode** (LG's Developer Mode app): add the TV with `npx -y -p @webos-tools/cli ares-setup-device`,
then install with `npx -y -p @webos-tools/cli ares-install dist/<file>.ipk`.

**Rooted TV** (SSH as root): `tools/tv_deploy.sh` copies the IPK over, installs it, stops the old
service (webOS keeps the old one running after an install, so new service code wouldn't load) and
relaunches the app:

```bash
TV=root@192.168.1.50 TV_KEY=~/webos_key sh tools/tv_deploy.sh dist/com.cgbeaulieu.immichlite_0.1.7_all.ipk
```

Bump the version in `app/appinfo.json` and `service/package.json` for each build.
