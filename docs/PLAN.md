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
  js/grid.js         focusable grid: packed sections (days, Explore rows), lazy images
  js/viewer.js       full-screen viewer, slideshow, favorite toggle
  js/settings.js     settings page and stored preferences
  js/search.js       search page and recent searches
  js/map.js          remote-first photo map (OpenStreetMap tiles, clustered bubbles)
  js/app.js          views and the Back stack, tabs, sources, slideshow/shuffle, keys
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

More endpoints used for Explore, Search, Map and Favorites:

| Need | Endpoint |
|---|---|
| People | `GET /api/people?withHidden=false`, faces from `GET /api/people/{id}/thumbnail`, their photos via the timeline calls with `personId=...` |
| Places | `GET /api/search/cities` (one cover photo per city), a city's photos via `POST /api/search/metadata {city}` |
| Memories | `GET /api/memories?for=<now>` ("on this day", assets included) |
| Search | `POST /api/search/smart {query, page}` (needs Immich's machine learning, which is on by default) |
| Map | `GET /api/map/markers` (every located photo: id, lat, lon, city) |
| Favorites | timeline calls with `isFavorite=true`; star with `PUT /api/assets {ids, isFavorite}` |
| Shuffle | `POST /api/search/random` with the view's filter (`albumIds`, `personIds`, `city`, `isFavorite`) |
| Stacks | timeline calls with `withStacked=true` (Photos, Favorites, albums, people): only a stack's primary photo comes back, and the bucket gains a `stack` column, `[stackId, count]` (count as a string) or null. Members via `GET /api/stacks/{id}` (`{id, primaryAssetId, assets}`) |
| Library statistics | `GET /api/assets/statistics` (`{images, videos, total}`, your own assets, timeline and archive), `quotaUsageInBytes` / `quotaSizeInBytes` from `GET /api/users/me`, `GET /api/server/storage` (server disk). None are admin-only; `/server/statistics` is, so it isn't used |

**API key permissions:** `user.read`, `asset.read`, `asset.view`, `asset.update`, `album.read`, `person.read`, `memory.read`, `map.read`, `stack.read`, `asset.statistics`, `server.storage`. A key with all permissions also works.

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
3. Real-library performance: test against the full Immich library. If the grid's DOM gets too heavy, virtualise it (keep only nearby rows in the DOM). `/map/markers` for a very large library may also be slow to load and cluster on the TV.
4. Check on the TV: OpenStreetMap tiles load over HTTPS (old TVs can lack newer root certificates), and whether the webOS screensaver interrupts long slideshows.
5. Stacks with `withStacked=true` hide non-primary members everywhere, so an album or person view that contains only a non-primary member of a stack won't show it (Immich does this server-side). Check on the real library whether albums should drop `withStacked`. Also check the ⧉ badge glyph renders in the TV's fonts.
6. Later: video playback (`/assets/{id}/video/playback`, H.264), photo details panel, "jump to year".
