# Immich-Lite: architecture and plan

## Target engine (confirmed 2026-10-11)

Read over root SSH from the first test TV (LG UH7650, webOS 3.4.3), in `/usr/lib/libcbe.so`:

**Chrome/38.0.2125.122**

What that means for the code:

| Feature | Chrome 38 | What we do |
|---|---|---|
| ES2015 syntax (arrows, let/const, template literals, classes) | no | ES5 only, checked with `npx acorn --ecma5` |
| `fetch` | no (Chrome 42) | `XMLHttpRequest` |
| `Promise` | yes | not used; callbacks keep it simple |
| `Object.assign` | no (Chrome 45) | manual copy loops |
| IntersectionObserver | no (Chrome 51) | lazy loading worked out from `scrollTop` and row height |
| CSS grid, custom properties | no | floats and absolute positioning |
| flexbox, `object-fit`, `classList`, transforms | yes | used (with `-webkit-` prefixes kept for safety) |
| WebP in `<img>` | yes | Immich's default webp thumbnails work |

`capabilities.html` is still useful to run once in the TV browser to double-check, but it no longer blocks anything.

## Layout

```
app/                 the webOS app (packaged as the IPK later)
  appinfo.json       webOS app manifest
  index.html
  css/app.css
  js/util.js         key codes, DOM helpers, localStorage wrapper
  js/immich.js       Immich REST client (XHR)
  js/grid.js         focusable thumbnail grid with lazy image loading
  js/viewer.js       full-screen viewer and slideshow
  js/app.js          screens, modes, key handling
tools/devserver.py   serves app/ and proxies /api to Immich (or a mock library)
capabilities.html    engine probe
```

No build step. The files in `app/` are what ships.

## Immich API (checked against server v3.3.1)

| Need | Endpoint |
|---|---|
| Check the key | `GET /api/users/me` |
| Months in the timeline | `GET /api/timeline/buckets?visibility=timeline&order=desc` returns `[{timeBucket, count}]` |
| Assets in one month | `GET /api/timeline/bucket?timeBucket=...` returns parallel arrays (`id[]`, `isImage[]`, `fileCreatedAt[]`, ...), which `immich.js` turns into objects |
| Albums | `GET /api/albums` (no asset list in v3) |
| Assets in an album | the same two timeline calls with `albumId=...` |
| Grid image | `GET /api/assets/{id}/thumbnail?size=thumbnail` (small webp) |
| Full-screen image | `GET /api/assets/{id}/thumbnail?size=preview` (large jpeg, right for 1080p) |

**Auth:** the API key goes in the `?apiKey=` query parameter. The server accepts it there as well as in the `x-api-key` header (`server/src/services/auth.service.ts`). This lets `<img>` tags load thumbnails directly, since they can't send headers, and it keeps JSON calls free of CORS preflights. The trade-off is that the key can show up in server or proxy access logs. That's acceptable on a home LAN.

**API key permissions:** `user.read`, `timeline.read`, `asset.view`, `album.read`. A key with all permissions also works.

## CORS: the open question

The Immich server sends **no CORS headers** (checked on v3.3.1). Where that matters:

- **Images:** don't care. `<img>` loads cross-origin without CORS.
- **JSON calls (XHR):** a cross-origin XHR response can't be read without `Access-Control-Allow-Origin`, *unless* the engine runs the app with web security relaxed.

How it plays out by way of running the app:

1. **Dev server (desktop or TV browser):** same origin through the proxy, so CORS doesn't apply. Works today.
2. **Packaged IPK (`file://` origin):** still unknown. Many older webOS releases are reported to let packaged web apps make cross-origin XHR calls. We test this the first time the IPK runs on the TV.
3. **If the IPK is blocked**, in order of preference:
   - a. Add CORS headers in front of Immich (a few lines in a reverse proxy on the server box). Simple, but it changes the server.
   - b. Bundle a small webOS JS service in the IPK that does the HTTP calls (services aren't bound by CORS). Self-contained, more work.
   - c. Point the app at a small always-on proxy like `devserver.py`. Fine for testing, not for daily use.

`immich.js` only needs a different base URL for 3a or 3c. Option 3b would swap its `get()` for a Luna service call.

## Next steps

1. **IPK packaging:** app icons (80x80 and 130x130 PNG), and a small script that builds the `.ipk` (an `ar` archive of `debian-binary`, `control.tar.gz` and `data.tar.gz`), so no webOS SDK is needed.
2. **Install over root SSH** and launch on the TV. This needs a short window when nobody is watching. Then settle the CORS question above.
3. Real-library performance: test against the full Immich library. If the grid's DOM gets too heavy, virtualise it (keep only nearby rows in the DOM).
4. Month headers in the timeline, and a "jump to year" control using the colour buttons.
5. Later: video playback (H.264 MP4 through Immich's transcodes), favourites, a people/places browser.
