/* Photo map for the remote: OpenStreetMap tiles with photos grouped into bubbles.
   Arrows move the map, CH+/CH- zoom, OK opens the bubble under the crosshair in the
   middle (or zooms in). The Magic Remote can drag, scroll to zoom and click bubbles.

   Hand-rolled rather than Leaflet: it needs to be remote-first, and it has to run on
   the old engine. Markers are clustered on a pixel grid each time the view changes. */
var MapView = (function () {
  'use strict';

  var TILE = 256;
  var TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var CELL = 110;        // cluster grid size in screen pixels
  var PICK_RADIUS = 90;  // how close to the crosshair a bubble must be for OK
  var MIN_ZOOM = 2, MAX_ZOOM = 17;

  var box, tileLayer, markerLayer, info, built = false;
  var markers = null;    // [{id, x, y, city}] with x, y in world units (0..1)
  var zoom = 3, cx = 0.5, cy = 0.4;
  var tiles = {}, clusters = [], picked = null, handlers = null;

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
    credit.textContent = '© OpenStreetMap contributors';
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

  /* h: {load(cb(err, markers)), thumbUrl(id), onOpen(ids, label), onPointer()} */
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
    var W = box.clientWidth, H = box.clientHeight, n = Math.pow(2, zoom), scale = TILE * n;
    var ox = cx * scale - W / 2, oy = cy * scale - H / 2;
    var used = {}, tx, ty, key, img, wx, k;

    // Tiles
    for (ty = Math.floor(oy / TILE); ty * TILE < oy + H; ty++) {
      if (ty < 0 || ty >= n) { continue; }
      for (tx = Math.floor(ox / TILE); tx * TILE < ox + W; tx++) {
        wx = ((tx % n) + n) % n;
        key = zoom + '/' + tx + '/' + ty;
        img = tiles[key];
        if (!img) {
          img = document.createElement('img');
          img.className = 'map-tile';
          img.src = TILE_URL.replace('{z}', zoom).replace('{x}', wx).replace('{y}', ty);
          tileLayer.appendChild(img);
          tiles[key] = img;
        }
        img.style.left = Math.round(tx * TILE - ox) + 'px';
        img.style.top = Math.round(ty * TILE - oy) + 'px';
        used[key] = true;
      }
    }
    for (k in tiles) {
      if (tiles.hasOwnProperty(k) && !used[k]) {
        tileLayer.removeChild(tiles[k]);
        delete tiles[k];
      }
    }

    drawClusters(W, H, scale, ox, oy);
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

  return { show: show, key: key };
})();
