# Immich Lite for webOS

> Unofficial community client. Not affiliated with or endorsed by Immich or FUTO.

A lightweight **Immich** photo/video client for **legacy LG webOS TVs** (webOS 3.x / 4.x) whose ancient web engine can't run the modern Immich TV clients (which require webOS 5.0+).

Built for the wave of 2016-era LG TVs that still work fine as panels but have been abandoned by LG — and rooted via the webOS homebrew scene.

## Why

The existing webOS Immich clients (`immichtv`, `immich.webos`) are modern web apps and **black-screen on webOS < 5.0** because the old Chromium/WebKit engine can't parse their JS/CSS. Immich-Lite targets the **oldest engine** deliberately: minimal, dependency-light, ES5-safe, so it runs where the others can't.

## Status: 🌱 pre-alpha

- Target engine confirmed: **Chrome 38** (read from the TV over root SSH). The code is strict ES5.
- Working in a browser: API-key setup, timeline grid (loaded a month at a time, images lazy-loaded), albums, full-screen viewer with slideshow, arrow-key and Magic Remote navigation.
- Not done yet: IPK packaging and the first run on the TV, which will show whether CORS blocks the packaged app. See [docs/PLAN.md](docs/PLAN.md).

## Target / constraints

- **Target device:** LG webOS 3.4 (first test TV: UH7650, webOS 3.4.3 "Rockhopper"). Rooted, Homebrew Channel installed.
- **Engine:** Chromium 38 (`Chrome/38.0.2125.122` on webOS 3.4.3). **ES5 only**, XHR instead of fetch, no CSS grid.
- **Server:** self-hosted Immich via its REST API. The server must send permissive **CORS** headers (webOS < 10 enforces CORS).
- **Install:** packaged as an IPK, sideloaded via Homebrew Channel / dev mode.

## MVP (v1) scope — photos first

1. API-key (or login) auth to the user's Immich server
2. Timeline / album **thumbnail grid**, lazy-loaded
3. **Full-screen photo viewer** + simple slideshow
4. **Magic Remote / arrow-key** navigation (webOS keycodes, spatial nav)
5. IPK packaging + sideload

**Deferred:** video playback (old-webOS codec support is limited — tackle after photos work), search, multi-account, maps/places.

## Running it (development)

`tools/devserver.py` serves the app and forwards `/api` to your Immich server on the same origin, so CORS doesn't get in the way:

```bash
python tools/devserver.py --immich http://192.168.8.145:2283
```

Or with a fake library, no Immich needed:

```bash
python tools/devserver.py --mock
```

Open `http://localhost:8000/` on this PC, or `http://192.168.8.101:8000/` in the TV's web browser. Leave the server address as filled in, paste an API key (Immich → Account Settings → API Keys; any key works in mock mode) and connect.

Keys: arrows move, OK/Enter opens, Back/Esc goes back, OK in the viewer starts or stops the slideshow, CH+/CH- jump three rows.

The engine probe is at `/capabilities.html` on the same server.

Before committing JS, check it still parses as ES5:

```bash
npx -y acorn@8.14.0 --ecma5 --silent app/js/app.js
```

## License

TBD (intended: open source — likely MIT or GPL-3.0).
