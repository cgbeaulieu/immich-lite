/* Photo map for the remote: an OpenStreetMap map with photos grouped into bubbles.
   Arrows move the map, CH+/CH- zoom, OK opens the bubble under the crosshair in the
   middle (or zooms in). The Magic Remote can drag, scroll to zoom and click bubbles.

   Hand-rolled rather than Leaflet: it needs to be remote-first, and it has to run on
   the old engine. Markers are clustered on a pixel grid each time the view changes. */
var MapView = (function () {
  'use strict';

  var TILE = 256;         // zoom levels count in 256-pixel tiles, as on most web maps
  /* The map itself is drawn from immich's own vector tiles (see vtile.js), the ones
     immich's web app uses: no key needed, unlike CARTO, and OpenStreetMap's servers
     block apps that can't send a Referer. They're drawn on 512-pixel canvases, one
     level below the zoom above; past level 15 (the deepest immich has) they're enlarged. */
  var DT = 512, SRC_MAX = 15;
  var KEEP_TILES = 24;    // canvases kept for panning back (about 1 MB each)
  var KEEP_SOURCES = 40;  // decoded tiles kept
  var FETCHES = 4;        // tile downloads at once
  var CELL = 110;        // cluster grid size in screen pixels
  var PICK_RADIUS = 90;  // how close to the crosshair a bubble must be for OK
  var MIN_ZOOM = 2, MAX_ZOOM = 17;

  var box, tileLayer, markerLayer, info, built = false;
  var markers = null;    // [{id, x, y, city}] with x, y in world units (0..1)
  var zoom = 3, cx = 0.5, cy = 0.4;
  var tiles = {}, clusters = [], picked = null, handlers = null;
  var sources = {}, sourceOrder = [], queue = [], fetching = 0, wanted = {}, stamp = 0;

  /* Web Mercator: longitude/latitude to 0..1 world coordinates. */
  function project(lat, lon) {
    var s = Math.sin(lat * Math.PI / 180);
    s = Math.max(-0.9999, Math.min(0.9999, s));
    return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
  }

  function build() {
    var drag = null;
    box = U.$('map');
    tileLayer = document.createElement('div');
    tileLayer.className = 'map-tiles';
    markerLayer = document.createElement('div');
    markerLayer.className = 'map-markers';
    info = document.createElement('div');
    info.className = 'map-info';
    box.appendChild(tileLayer);
    box.appendChild(markerLayer);
    box.appendChild(info);
    var cross = document.createElement('div');
    cross.className = 'map-cross';
    box.appendChild(cross);
    var credit = document.createElement('div');
    credit.className = 'map-credit';
    credit.textContent = '© OpenStreetMap contributors · map tiles by immich';
    box.appendChild(credit);

    // Magic Remote: drag to move, wheel to zoom.
    box.addEventListener('mousedown', function (e) { drag = { x: e.clientX, y: e.clientY, moved: false }; }, false);
    box.addEventListener('mousemove', function (e) {
      if (!drag) { return; }
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y, scale = TILE * Math.pow(2, zoom);
      if (Math.abs(dx) + Math.abs(dy) < 4 && !drag.moved) { return; }
      drag.moved = true;
      cx -= dx / scale; cy -= dy / scale;
      drag.x = e.clientX; drag.y = e.clientY;
      clamp(); render();
    }, false);
    window.addEventListener('mouseup', function () { setTimeout(function () { drag = null; }, 0); }, false);
    box.addEventListener('mousewheel', function (e) {
      setZoom(zoom + (e.wheelDelta > 0 ? 1 : -1));
      e.preventDefault();
    }, false);
    box.addEventListener('click', function (e) {
      if (drag && drag.moved) { return; }
      var t = e.target;
      while (t && t !== box && !t.getAttribute('data-cluster')) { t = t.parentNode; }
      if (t && t !== box) { open(clusters[parseInt(t.getAttribute('data-cluster'), 10)]); }
    }, false);
    built = true;
  }

  /* h: {load(cb(err, markers)), thumbUrl(id), tiles (base URL of the vector tiles),
         onOpen(ids, label), onPointer()} */
  function show(h) {
    handlers = h;
    if (!built) { build(); }
    if (markers) { render(); return; }
    info.textContent = 'Loading photo locations...';
    h.load(function (err, list) {
      var i, p, out = [];
      if (err) { info.textContent = err.message; return; }
      for (i = 0; i < (list || []).length; i++) {
        if (typeof list[i].lat !== 'number' || typeof list[i].lon !== 'number') { continue; }
        p = project(list[i].lat, list[i].lon);
        out.push({ id: list[i].id, x: p.x, y: p.y, city: list[i].city || '' });
      }
      markers = out;
      fit();
      render();
    });
  }

  /* Zooms to show every photo. */
  function fit() {
    var minX = 1, maxX = 0, minY = 1, maxY = 0, i, w, h, span;
    if (!markers.length) { return; }
    for (i = 0; i < markers.length; i++) {
      minX = Math.min(minX, markers[i].x); maxX = Math.max(maxX, markers[i].x);
      minY = Math.min(minY, markers[i].y); maxY = Math.max(maxY, markers[i].y);
    }
    cx = (minX + maxX) / 2;
    cy = (minY + maxY) / 2;
    w = box.clientWidth || 1280;
    h = box.clientHeight || 600;
    span = Math.max((maxX - minX) / w, (maxY - minY) / h) * 1.3;
    zoom = span > 0 ? Math.floor(Math.log(1 / (span * TILE)) / Math.LN2) : 12;
    zoom = Math.max(MIN_ZOOM, Math.min(13, zoom));
  }

  function clamp() {
    cx = cx - Math.floor(cx);          // wrap around the date line
    cy = Math.max(0.02, Math.min(0.98, cy));
  }

  function setZoom(z) {
    z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    if (z !== zoom) { zoom = z; render(); }
  }

  function render() {
    var W = box.clientWidth, H = box.clientHeight, scale = TILE * Math.pow(2, zoom);
    var d = zoom - 1, n = Math.pow(2, d), ox = cx * scale - W / 2, oy = cy * scale - H / 2;
    var tx, ty, key, t, k, spare = [];

    stamp++;
    wanted = {};
    for (ty = Math.floor(oy / DT); ty * DT < oy + H; ty++) {
      if (ty < 0 || ty >= n) { continue; }
      for (tx = Math.floor(ox / DT); tx * DT < ox + W; tx++) {
        key = d + '/' + tx + '/' + ty; // tx unwrapped: the world can show twice side by side
        t = tiles[key] || makeTile(d, tx, ty, n);
        t.used = stamp;
        t.el.style.left = Math.round(tx * DT - ox) + 'px';
        t.el.style.top = Math.round(ty * DT - oy) + 'px';
        if (!t.el.parentNode) { tileLayer.appendChild(t.el); }
        if (!t.ready) { wanted[t.source] = true; }
      }
    }
    // Off-screen canvases leave the page; the most recent few are kept for panning back.
    for (k in tiles) {
      if (tiles.hasOwnProperty(k) && tiles[k].used !== stamp) {
        if (tiles[k].el.parentNode) { tileLayer.removeChild(tiles[k].el); }
        spare.push(tiles[k]);
      }
    }
    spare.sort(function (a, b) { return a.used - b.used; });
    for (k = 0; k < spare.length - KEEP_TILES; k++) { delete tiles[spare[k].key]; }

    drawClusters(W, H, scale, ox, oy);
  }

  /* A tile's canvas starts as the enlarged quarter of the tile above it, when that one
     is drawn (so zooming in never flashes empty), then gets drawn properly once its
     data is in. */
  function makeTile(d, tx, ty, n) {
    var wx = ((tx % n) + n) % n, s = Math.min(d, SRC_MAX), f = d - s;
    var el = document.createElement('canvas'), ctx, up, t;
    el.className = 'map-tile';
    el.width = el.height = DT;
    ctx = el.getContext('2d');
    up = tiles[(d - 1) + '/' + Math.floor(tx / 2) + '/' + Math.floor(ty / 2)];
    if (up && up.ready) {
      ctx.drawImage(up.el, (((tx % 2) + 2) % 2) * DT / 2, (ty % 2) * DT / 2, DT / 2, DT / 2, 0, 0, DT, DT);
    } else {
      ctx.fillStyle = VTile.WATER;
      ctx.fillRect(0, 0, DT, DT);
    }
    t = { key: d + '/' + tx + '/' + ty, el: el, ready: false, used: stamp,
      source: s + '/' + (wx >> f) + '/' + (ty >> f) };
    tiles[t.key] = t;
    wanted[t.source] = true;
    source(t.source, function (data) {
      var scaleUp = Math.pow(2, f), extent = (data.earth || data.water || { extent: 4096 }).extent;
      VTile.draw(ctx, data, {
        z: d, size: DT, k: DT * scaleUp / extent,
        ox: -(wx - ((wx >> f) << f)) * DT, oy: -(ty - ((ty >> f) << f)) * DT
      });
      t.ready = true;
    });
    return t;
  }

  /* Decoded tile data by 'z/x/y', downloaded at most FETCHES at a time. A download
     whose tile scrolled or zoomed out of view before its turn is dropped. */
  function source(key, cb) {
    var c = sources[key];
    if (c && c.data) { return cb(c.data); }
    if (c) { c.waiting.push(cb); return; }
    sources[key] = { data: null, waiting: [cb] };
    queue.push(key);
    pump();
  }

  function pump() {
    var key;
    while (fetching < FETCHES && queue.length) {
      key = queue.shift();
      if (!wanted[key]) { delete sources[key]; continue; } // asked for again if it's needed
      fetchTile(key);
    }
  }

  function fetchTile(key) {
    var x = new XMLHttpRequest();
    fetching++;
    x.open('GET', handlers.tiles + '/' + key + '.mvt', true);
    x.responseType = 'arraybuffer';
    x.timeout = 30000;
    x.onload = x.onerror = x.ontimeout = function () {
      var c = sources[key], data = null, list, i;
      fetching--;
      if (x.status === 200 && x.response) {
        try { data = VTile.decode(x.response); } catch (e) { data = null; }
      }
      if (!c) { return pump(); }
      if (!data) { delete sources[key]; return pump(); } // left as it is; tried again next time
      c.data = data;
      list = c.waiting;
      c.waiting = [];
      sourceOrder.push(key);
      if (sourceOrder.length > KEEP_SOURCES) { delete sources[sourceOrder.shift()]; }
      for (i = 0; i < list.length; i++) { list[i](data); }
      pump();
    };
    x.send();
  }

  function drawClusters(W, H, scale, ox, oy) {
    var cells = {}, list = [], i, m, px, py, key, c, html = [], best = null, bestD = PICK_RADIUS, d, size, shift;
    if (!markers) { return; }
    for (i = 0; i < markers.length; i++) {
      m = markers[i];
      px = m.x * scale - ox;
      py = m.y * scale - oy;
      // The world repeats sideways; bring the marker to the copy nearest the view.
      shift = Math.round((W / 2 - px) / scale);
      px += shift * scale;
      if (px < -CELL || px > W + CELL || py < -CELL || py > H + CELL) { continue; }
      key = Math.floor(px / CELL) + ':' + Math.floor(py / CELL);
      c = cells[key];
      if (!c) { c = cells[key] = { n: 0, sx: 0, sy: 0, ids: [], cover: m.id, cities: {} }; list.push(c); }
      c.n++; c.sx += px; c.sy += py; c.ids.push(m.id);
      if (m.city) { c.cities[m.city] = (c.cities[m.city] || 0) + 1; }
    }
    clusters = list;
    for (i = 0; i < list.length; i++) {
      c = list[i];
      c.x = c.sx / c.n; c.y = c.sy / c.n;
      c.label = topCity(c.cities);
      d = Math.sqrt(Math.pow(c.x - W / 2, 2) + Math.pow(c.y - H / 2, 2));
      if (d < bestD) { bestD = d; best = c; }
    }
    picked = best;
    for (i = 0; i < list.length; i++) {
      c = list[i];
      size = c.n > 99 ? 76 : (c.n > 9 ? 68 : 60);
      html.push('<div class="map-bubble' + (c === best ? ' picked' : '') + '" data-cluster="' + i + '" style="left:' +
        Math.round(c.x - size / 2) + 'px;top:' + Math.round(c.y - size / 2) + 'px;width:' + size + 'px;height:' + size +
        'px"><img src="' + handlers.thumbUrl(c.cover) + '"><span>' + c.n + '</span></div>');
    }
    markerLayer.innerHTML = html.join('');

    if (!markers.length) {
      info.textContent = 'None of your photos have a location yet.';
    } else if (best) {
      info.textContent = best.n + (best.n === 1 ? ' photo' : ' photos') + (best.label ? ' around ' + best.label : '') +
        '     OK: open     CH+/CH-: zoom     Arrows: move';
    } else {
      info.textContent = markers.length + ' photos with a location     OK: zoom in     CH+/CH-: zoom     Arrows: move';
    }
  }

  function topCity(cities) {
    var best = '', n = 0, k;
    for (k in cities) { if (cities.hasOwnProperty(k) && cities[k] > n) { n = cities[k]; best = k; } }
    return best;
  }

  function open(c) {
    if (!c) { return; }
    handlers.onOpen(c.ids, c.label || (c.n + ' photos'));
  }

  function pan(dx, dy) {
    var scale = TILE * Math.pow(2, zoom);
    cx += dx * box.clientWidth / 4 / scale;
    cy += dy * box.clientHeight / 4 / scale;
    clamp();
    render();
  }

  /* Returns true if the key was used. Up at the top edge is still a pan: use Back to
     reach the tabs. */
  function key(k) {
    if (!markers) { return false; }
    switch (k) {
      case KEY.LEFT: pan(-1, 0); return true;
      case KEY.RIGHT: pan(1, 0); return true;
      case KEY.UP: pan(0, -1); return true;
      case KEY.DOWN: pan(0, 1); return true;
      case KEY.CH_UP: case 187: case 107: setZoom(zoom + 1); return true;   // CH+, '=' and numpad '+'
      case KEY.CH_DOWN: case 189: case 109: setZoom(zoom - 1); return true; // CH-, '-' and numpad '-'
      case KEY.OK: if (picked) { open(picked); } else { setZoom(zoom + 2); } return true;
    }
    return false;
  }

  /* Forget the loaded photo locations (partner settings changed); the next show reloads. */
  function reset() { markers = null; }

  return { show: show, key: key, reset: reset };
})();
