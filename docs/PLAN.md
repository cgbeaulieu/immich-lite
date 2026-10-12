# immich lite: architecture and plan

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
| WebP in `<img>` | yes | immich's default webp thumbnails work |
| `<video>` with H.264 MP4 | yes (hardware decoder, one at a time) | immich's transcoded playback file; a video is unloaded (`removeAttribute('src')` + `load()`) as soon as it's left |

`capabilities.html` is still useful to run once in the TV browser to double-check, but it no longer blocks anything.

## Layout

```
app/                 the webOS app (packaged as the IPK later)
  appinfo.json       webOS app manifest
  index.html
  css/app.css
  js/util.js         key codes, DOM helpers, localStorage wrapper
  js/immich.js       immich REST client (XHR)
  js/grid.js         focusable grid: packed sections (days, Explore rows), lazy images
  js/viewer.js       full-screen viewer, slideshow, favorite toggle
  js/details.js      the viewer's details panel: info, people, star rating, add to album
  js/settings.js     settings page and stored preferences
  js/search.js       search page and recent searches
  js/vtile.js        decodes immich's vector map tiles and draws them on a canvas
  js/map.js          remote-first photo map (immich's tiles of OpenStreetMap data, clustered bubbles)
  js/app.js          views and the Back stack, tabs, sources, slideshow/shuffle, keys
tools/devserver.py   serves app/ and proxies /api to immich (or a mock library)
capabilities.html    engine probe
```

No build step. The files in `app/` are what ships.

## immich API (checked against server v3.3.1)

| Need | Endpoint |
|---|---|
| Check the key | `GET /api/users/me` |
| Months in the timeline | `GET /api/timeline/buckets?visibility=timeline&order=desc` returns `[{timeBucket, count}]` |
| Assets in one month | `GET /api/timeline/bucket?timeBucket=...` returns parallel arrays (`id[]`, `isImage[]`, `fileCreatedAt[]`, ...), which `immich.js` turns into objects |
| Albums | `GET /api/albums` (no asset list in v3) |
| Assets in an album | the same two timeline calls with `albumId=...` |
| Grid image | `GET /api/assets/{id}/thumbnail?size=thumbnail` (small webp) |
| Full-screen image | `GET /api/assets/{id}/thumbnail?size=preview` (large jpeg, right for 1080p) |
| Video | `GET /api/assets/{id}/video/playback` (the transcoded copy, H.264 MP4 by default; range requests supported) as a `<video>` src. Length is the bucket's `duration[]` column, in ms in v3 (older servers sent `"H:MM:SS.sss"`; both are parsed) |

**Auth:** the API key goes in the `?apiKey=` query parameter. The server accepts it there as well as in the `x-api-key` header (`server/src/services/auth.service.ts`). This lets `<img>` tags load thumbnails directly, since they can't send headers, and it keeps JSON calls free of CORS preflights. The trade-off is that the key can show up in server or proxy access logs. That's acceptable on a home LAN.

More endpoints used for Explore, Search, Map and Favorites:

| Need | Endpoint |
|---|---|
| People | `GET /api/people?withHidden=false`, faces from `GET /api/people/{id}/thumbnail`, their photos via the timeline calls with `personId=...` |
| Places | `GET /api/search/cities` (one cover photo per city), a city's photos via `POST /api/search/metadata {city}` |
| Memories | `GET /api/memories?for=<now>` ("on this day", assets included) |
| Search | `POST /api/search/smart {query, page}` (needs immich's machine learning, which is on by default) |
| Map | `GET /api/map/markers` (every located photo: id, lat, lon, city) |
| Favorites | timeline calls with `isFavorite=true`; star with `PUT /api/assets {ids, isFavorite}` |
| Shuffle | `POST /api/search/random` with the view's filter (`albumIds`, `personIds`, `tagIds`, `visibility`, `city`, `isFavorite`) |
| Archive | timeline calls with `visibility=archive` (`asset.read`) |
| Folders | `GET /api/view/folder/unique-paths` (every folder holding assets, as full paths; built into a tree in the app), a folder's own photos (not subfolders) from `GET /api/view/folder?path=...` as full asset objects, all at once (`folder.read`) |
| Tags | `GET /api/tags` returns `[{id, name, value: 'Places/Canada', parentId}]` (`tag.read`), a tag's photos via the timeline calls with `tagId=...` |
| Partner photos | timeline and map calls with `withPartners=true` (on by default). immich only returns partners whose `inTimeline` is on, and refuses `withPartners` on the timeline unless `visibility=timeline` with no `isFavorite`/`isTrashed`, so only Photos and the map pass it. Settings lists `GET /api/partners?direction=shared-with` and flips `inTimeline` with `PUT /api/partners/{id}` (`partner.read`, `partner.update`). Search and random search already include partners shown in the timeline (server side) |
| Stacks | timeline calls with `withStacked=true`, on Photos only (under any other filter immich would hide a stack's other photos, so they could vanish from an album, person, favorites or tag view): only a stack's primary photo comes back, and the bucket gains a `stack` column, `[stackId, count]` (count as a string) or null. Members via `GET /api/stacks/{id}` (`{id, primaryAssetId, assets}`) |
| Library statistics | `GET /api/assets/statistics` (`{images, videos, total}`, your own assets, timeline and archive), `quotaUsageInBytes` / `quotaSizeInBytes` from `GET /api/users/me`, `GET /api/server/storage` (server disk). None are admin-only; `/server/statistics` is, so it isn't used |
| Photo details | `GET /api/assets/{id}`: `exifInfo` (camera, lens, exposure, place, `rating`) and `people` (id + name, enough for `/people/{id}/thumbnail`, so no `face.read` needed). Fetched 0.4 s after landing on a photo (not during a slideshow) so the caption can show the stars; the last 30 are cached |
| Rating | `PUT /api/assets {ids, rating}`: 1-5, or `null` to clear (v3 rejects 0). Saves go out one at a time so quick presses land in order |
| Add to album | `PUT /api/albums/{id}/assets {ids}` answers `[{id, success, error}]`; `error: 'duplicate'` means it was already there |

**API key permissions:** `user.read`, `asset.read`, `asset.view`, `asset.update`, `album.read`, `albumAsset.create`, `person.read`, `memory.read`, `map.read`, `stack.read`, `folder.read`, `tag.read`, `asset.statistics`, `server.storage`, `partner.read`, `partner.update`. A key with all permissions also works.

Both `PUT /api/assets` and `PUT /api/assets/{id}` are marked deprecated in v3.3.1, with no replacement in that version yet. The app uses the bulk one (favorites and ratings); check this when immich ships the replacement.

## CORS: the open question

The immich server sends **no CORS headers** (checked on v3.3.1). Where that matters:

- **Images:** don't care. `<img>` loads cross-origin without CORS.
- **JSON calls (XHR):** a cross-origin XHR response can't be read without `Access-Control-Allow-Origin`, *unless* the engine runs the app with web security relaxed.

How it plays out by way of running the app:

1. **Dev server (desktop or TV browser):** same origin through the proxy, so CORS doesn't apply. Works today.
2. **Packaged IPK (`file://` origin):** still unknown. Many older webOS releases are reported to let packaged web apps make cross-origin XHR calls. We test this the first time the IPK runs on the TV.
3. **If the IPK is blocked**, in order of preference:
   - a. Add CORS headers in front of immich (a few lines in a reverse proxy on the server box). Simple, but it changes the server.
   - b. Bundle a small webOS JS service in the IPK that does the HTTP calls (services aren't bound by CORS). Self-contained, more work.
   - c. Point the app at a small always-on proxy like `devserver.py`. Fine for testing, not for daily use.

`immich.js` only needs a different base URL for 3a or 3c. Option 3b would swap its `get()` for a Luna service call.

## Phone sign-in (QR code)

The IPK carries a webOS JS service, `com.cgbeaulieu.immichlite.service` (`service/`), besides the
web app. It runs on the TV's Node v0.12.2 (checked on the UH7650 over SSH) with the built-in
`webos-service` module, so it is ES5 too.

| Piece | What it does |
|---|---|
| `service/pairing.js` | A small HTTP server on port 8790 (the next free one up to 8795), started by the sign-in screen. Serves the phone page, `/info` (the server address the TV already has), `/submit` (takes the address and email + password or API key with the 8-character code), `/status` (whether the TV signed in) |
| `service/service.js` | The service bus side: `start {server}` -> `{code, url}`, `poll` -> credentials once, `report {ok, message}`, `stop`. Holds an activity so webOS doesn't stop it while waiting |
| `service/phone.html` | The page the phone opens |
| `app/js/pairing.js` | The QR card: draws the code (app/lib/qrcode.js), polls every 2 s, signs in with what arrives, reports back. Calls the service through PalmServiceBridge on the TV, or `/pair/` on the dev server |

Safety: listens only while the sign-in screen is up (stopped a few seconds after leaving it),
needs the code shown on the TV (8 wrong ones lock it), expires after 10 minutes, keeps the
credentials in memory until the app takes them, and the app never stores the password. It is
plain HTTP on the home network, like the rest of the app's traffic to immich.

Packaging needs the service in the IPK: `ares-package app service`, or the equivalent layout if
we build the IPK ourselves (`usr/palm/applications/<id>/` and `usr/palm/services/<id>.service/`).

## Next steps

1. **IPK packaging:** app icons (80x80 and 130x130 PNG), and a small script that builds the `.ipk` (an `ar` archive of `debian-binary`, `control.tar.gz` and `data.tar.gz`), so no webOS SDK is needed.
2. **Install over root SSH** and launch on the TV. This needs a short window when nobody is watching. Then settle the CORS question above.
3. Real-library performance: test against the full immich library. If the grid's DOM gets too heavy, virtualise it (keep only nearby rows in the DOM). `/map/markers` for a very large library may also be slow to load and cluster on the TV.
4. Check on the TV: how fast the vector map draws (decoding runs on the page), and whether the webOS screensaver interrupts long slideshows.
5. Stacks collapse on the Photos timeline only (see the Stacks row above). Check that the ⧉ badge glyph renders in the TV's fonts.
6. Check video on the TV: real immich transcodes play (and 4K or HEVC originals that immich didn't transcode fail cleanly to the still), the video draws above the still and below the bar, and stepping between videos never leaves the decoder stuck. Tested so far only in desktop Chromium against the mock.
7. Check on the TV: the ★ and ☆ characters render in the TV's fonts (♥ already does, and they're in the same Unicode block), and the number keys on the LG remote send 48-57.
8. Later: seeking in videos (Left/Right are taken by previous/next), "jump to year".
