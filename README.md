# Immich Lite for webOS

> Unofficial community client. Not affiliated with or endorsed by Immich or FUTO.

A lightweight **Immich** photo/video client for **legacy LG webOS TVs** (webOS 3.x / 4.x) whose ancient web engine can't run the modern Immich TV clients (which require webOS 5.0+).

Built for the wave of 2016-era LG TVs that still work fine as panels but have been abandoned by LG — and rooted via the webOS homebrew scene.

## Why

The existing webOS Immich clients (`immichtv`, `immich.webos`) are modern web apps and **black-screen on webOS < 5.0** because the old Chromium/WebKit engine can't parse their JS/CSS. Immich-Lite targets the **oldest engine** deliberately: minimal, dependency-light, ES5-safe, so it runs where the others can't.

## Status: 🌱 pre-alpha

- Target engine confirmed: **Chrome 38** (read from the TV over root SSH). The code is strict ES5.
- Working in a browser (tested against a mock library), not yet run on the TV itself.
- Not done yet: IPK packaging and the first run on the TV, which will show whether CORS blocks the packaged app. See [docs/PLAN.md](docs/PLAN.md).

## Features

| Tab | What it does |
|---|---|
| **Photos** | Your timeline, grouped by day (or month) like Immich's web app, loaded a month at a time. Stacks (burst shots, edits) show as one photo with a ⧉ count |
| **Explore** | "On this day" memories, People (face recognition) and Places (cities), plus a Library row: **Archive** (archived photos), **Folders** (browse by the folders the photos are stored in) and **Tags** |
| **Map** | Your photos on an OpenStreetMap map, grouped into bubbles |
| **Favorites** | Photos you've starred |
| **Albums** | Your albums and albums shared with you |
| **Search** | Immich smart search ("beach", "dog in the snow"), with recent searches |
| **Settings** | Library statistics (photo and video counts, storage used, server disk), slideshow speed and order, grouping, thumbnail size, hide videos, include partner photos in Photos, change server, sign out |
| **▶ Slideshow** | Plays the current view, in order or shuffled (shuffle draws from your whole library or the album/person/place/tag/archive) |
| **Videos** | Play full screen with a progress line and elapsed/total time; the grid shows their length. Slideshows skip them |

## Remote keys

| Where | Keys |
|---|---|
| Anywhere | Arrows move, OK opens, Back goes back, **Play** starts a slideshow of what's focused |
| Photo grids | CH+/CH- jump three rows |
| Photo viewer | Left/Right previous/next, OK slideshow on/off, **▲ favorite**, ▼ hide info, CH+/CH- step through a stack |
| On a video | OK, Play and Pause play and pause it (it starts by itself when opened from the grid). Left/Right stop it and move on |
| Map | Arrows move, CH+/CH- zoom, OK opens the bubble under the crosshair |

The Magic Remote pointer works too: point to focus, click to open, and on the map drag to move and scroll to zoom.

## API key permissions

Create the key in Immich under Account Settings → API Keys. A key with **all permissions** is simplest. The app needs:
`user.read`, `asset.read`, `asset.view`, `asset.update` (favorites), `album.read`, `person.read`, `memory.read`, `map.read`, `stack.read` (stacks),
`folder.read` (Folders), `tag.read` (Tags),
`asset.statistics` and `server.storage` (library statistics in Settings; without them those lines are left out).

## Target / constraints

- **Target device:** LG webOS 3.4 (first test TV: UH7650, webOS 3.4.3 "Rockhopper"). Rooted, Homebrew Channel installed.
- **Engine:** Chromium 38 (`Chrome/38.0.2125.122` on webOS 3.4.3). **ES5 only**, XHR instead of fetch, no CSS grid.
- **Server:** self-hosted Immich v3 via its REST API. Immich sends no CORS headers; whether the packaged app needs them is still to be tested (see docs/PLAN.md).
- **Install:** packaged as an IPK, sideloaded via Homebrew Channel / dev mode.
- **Map tiles** come from OpenStreetMap over the internet (fine for personal use; credit shown on the map).

**Not yet:** seeking within a video, photo details (camera, location), people in a photo, multiple accounts.

## Running it (development)

`tools/devserver.py` serves the app and forwards `/api` to your Immich server on the same origin, so CORS doesn't get in the way:

```bash
python tools/devserver.py --immich http://192.168.8.145:2283
```

Or with a fake library, no Immich needed:

```bash
python tools/devserver.py --mock
```

The mock's videos all play the same tiny 6-second clip (built by the dev server, no files needed), except December 2025's, which fail on purpose to show the "can't play" fallback.

Open `http://localhost:8000/` on this PC, or `http://192.168.8.101:8000/` in the TV's web browser. Leave the server address as filled in, paste an API key (Immich → Account Settings → API Keys; any key works in mock mode) and connect.

On a PC keyboard, Esc is Back, and Enter is OK.

The engine probe is at `/capabilities.html` on the same server.

Before committing JS, check it still parses as ES5:

```bash
for f in app/js/*.js; do npx -y acorn@8.14.0 --ecma5 --silent "$f" || echo "not ES5: $f"; done
```

## License

TBD (intended: open source — likely MIT or GPL-3.0).
