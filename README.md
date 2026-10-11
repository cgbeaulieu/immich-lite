# Immich-Lite (webOS)

A lightweight **Immich** photo/video client for **legacy LG webOS TVs** (webOS 3.x / 4.x) whose ancient web engine can't run the modern Immich TV clients (which require webOS 5.0+).

Built for the wave of 2016-era LG TVs that still work fine as panels but have been abandoned by LG — and rooted via the webOS homebrew scene.

## Why

The existing webOS Immich clients (`immichtv`, `immich.webos`) are modern web apps and **black-screen on webOS < 5.0** because the old Chromium/WebKit engine can't parse their JS/CSS. Immich-Lite targets the **oldest engine** deliberately: minimal, dependency-light, ES5-safe, so it runs where the others can't.

## Status: 🌱 pre-alpha / scoping

First task is to pin down exactly what the target TV's web engine supports — see `capabilities.html`.

## Target / constraints

- **Target device:** LG webOS 3.4 (first test TV: UH7650, webOS 3.4.3 "Rockhopper"). Rooted, Homebrew Channel installed.
- **Engine:** old Chromium (version TBD — `capabilities.html` will tell us). Assume **ES5** until proven otherwise.
- **Server:** self-hosted Immich via its REST API. The server must send permissive **CORS** headers (webOS < 10 enforces CORS).
- **Install:** packaged as an IPK, sideloaded via Homebrew Channel / dev mode.

## MVP (v1) scope — photos first

1. API-key (or login) auth to the user's Immich server
2. Timeline / album **thumbnail grid**, lazy-loaded
3. **Full-screen photo viewer** + simple slideshow
4. **Magic Remote / arrow-key** navigation (webOS keycodes, spatial nav)
5. IPK packaging + sideload

**Deferred:** video playback (old-webOS codec support is limited — tackle after photos work), search, multi-account, maps/places.

## First step — run the capability probe

The TV's engine dictates the whole stack, so before any app code:

```bash
# On this PC, from the project folder:
python -m http.server 8000
```

Then on the TV open the **web browser** and go to:

```
http://192.168.8.101:8000/capabilities.html
```

It prints the exact `navigator.userAgent` (Chromium version) and PASS/FAIL for the features that decide the stack (fetch vs XHR, Promise, flexbox/grid, IntersectionObserver, srcset, ES6 syntax, etc.). Read the results back and we lock the stack.

## License

TBD (intended: open source — likely MIT or GPL-3.0).
