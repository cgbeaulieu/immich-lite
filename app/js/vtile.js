/* Draws the map from vector tiles, so it needs no map key.

   immich's own map tiles (tiles.immich.cloud, what immich's web app uses, OpenStreetMap
   data in the Protomaps layout) come as Mapbox Vector Tiles: protobuf-encoded shapes,
   not pictures. immich draws them with MapLibre GL, which is far too new for the TV's
   engine, so this decodes them by hand and paints a simple dark map on a 2D canvas:
   land, water, parks, roads, borders and place names. Colours follow immich's dark map,
   a little brighter so they read on a TV across the room.

   VTile.decode(arrayBuffer) -> tile, VTile.draw(ctx, tile, view). ES5 only. */
var VTile = (function () {
  'use strict';

  var LAYERS = { earth: 1, water: 1, landuse: 1, roads: 1, boundaries: 1, places: 1, buildings: 1 };
  var PARKS = { national_park: 1, park: 1, cemetery: 1, protected_area: 1, nature_reserve: 1, forest: 1,
    golf_course: 1, wood: 1, grassland: 1, grass: 1, scrub: 1, allotments: 1, village_green: 1, playground: 1 };
  var FONT = '"LG Smart UI", "LG Display", "Helvetica Neue", Arial, sans-serif';

  var C = {
    water: '#0a0f1a', earth: '#1c1c1c', park: '#1a2b25', building: '#151515',
    minor: '#333333', major: '#414141', highway: '#4f4f4f', border: '#6b7488',
    country: '#9a9a9a', city: '#b4b4b4', town: '#8e8e8e', halo: '#101010'
  };

  /* ---------- protobuf ---------- */

  function Pbf(buf, pos, end) {
    this.buf = buf;
    this.pos = pos || 0;
    this.end = end === undefined ? buf.length : end;
  }

  Pbf.prototype.varint = function () {
    var buf = this.buf, val = 0, mul = 1, b;
    do {
      b = buf[this.pos++];
      val += (b & 0x7f) * mul;
      mul *= 128;
    } while (b >= 0x80);
    return val;
  };

  Pbf.prototype.skip = function (wire) {
    if (wire === 0) { while (this.buf[this.pos++] >= 0x80) { /* next byte */ } }
    else if (wire === 1) { this.pos += 8; }
    else if (wire === 2) { var n = this.varint(); this.pos += n; }
    else if (wire === 5) { this.pos += 4; }
    else { throw new Error('bad protobuf wire type ' + wire); }
  };

  Pbf.prototype.string = function () {
    var n = this.varint(), end = this.pos + n, s = '', i;
    for (i = this.pos; i < end; i++) { s += String.fromCharCode(this.buf[i]); }
    this.pos = end;
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; } // UTF-8 bytes to text
  };

  /* A protobuf value message: string, float, double, int64, uint64, sint64 or bool. */
  function readValue(p, view) {
    var end = p.varint() + p.pos, v = null, tag, f, n;
    while (p.pos < end) {
      tag = p.varint();
      f = tag >> 3;
      if (f === 1) { v = p.string(); }
      else if (f === 2) { v = view.getFloat32(p.pos, true); p.pos += 4; }
      else if (f === 3) { v = view.getFloat64(p.pos, true); p.pos += 8; }
      else if (f === 4 || f === 5) { v = p.varint(); }
      else if (f === 6) { n = p.varint(); v = n % 2 ? -(n + 1) / 2 : n / 2; }
      else if (f === 7) { v = !!p.varint(); }
      else { p.skip(tag & 7); }
    }
    return v;
  }

  /* ---------- Mapbox Vector Tile ---------- */

  /* Returns {layerName: {extent, features: [{type, props, geom: [[x, y, x, y...], ...]}]}}
     for the layers this map draws. type: 1 point, 2 line, 3 polygon. */
  function decode(arrayBuffer) {
    var buf = new Uint8Array(arrayBuffer), view = new DataView(arrayBuffer), p = new Pbf(buf), out = {}, tag, end, layer;
    while (p.pos < p.end) {
      tag = p.varint();
      if (tag >> 3 === 3) {
        end = p.varint() + p.pos;
        layer = readLayer(new Pbf(buf, p.pos, end), view);
        if (layer) { out[layer.name] = layer; }
        p.pos = end;
      } else {
        p.skip(tag & 7);
      }
    }
    return out;
  }

  function readLayer(p, view) {
    var name = null, extent = 4096, keys = [], values = [], spans = [], tag, f, n, i, features = [];
    while (p.pos < p.end) {
      tag = p.varint();
      f = tag >> 3;
      if (f === 1) {
        name = p.string();
        if (!LAYERS[name]) { return null; } // the name comes first: skip layers not drawn
      }
      else if (f === 2) { n = p.varint(); spans.push(p.pos, p.pos + n); p.pos += n; }
      else if (f === 3) { keys.push(p.string()); }
      else if (f === 4) { values.push(readValue(p, view)); }
      else if (f === 5) { extent = p.varint(); }
      else { p.skip(tag & 7); }
    }
    if (!name || !LAYERS[name]) { return null; }
    for (i = 0; i < spans.length; i += 2) {
      features.push(readFeature(new Pbf(p.buf, spans[i], spans[i + 1]), keys, values));
    }
    return { name: name, extent: extent, features: features };
  }

  function readFeature(p, keys, values) {
    var type = 0, props = {}, geom = [], tag, f, end;
    while (p.pos < p.end) {
      tag = p.varint();
      f = tag >> 3;
      if (f === 2) {
        end = p.varint() + p.pos;
        while (p.pos < end) { props[keys[p.varint()]] = values[p.varint()]; }
      } else if (f === 3) {
        type = p.varint();
      } else if (f === 4) {
        end = p.varint() + p.pos;
        geom = readGeometry(p, end);
      } else {
        p.skip(tag & 7);
      }
    }
    return { type: type, props: props, geom: geom };
  }

  /* MoveTo / LineTo / ClosePath commands with zigzag deltas, into flat x,y rings. */
  function readGeometry(p, end) {
    var rings = [], ring = null, x = 0, y = 0, cmd, count, n, i;
    while (p.pos < end) {
      n = p.varint();
      cmd = n & 7;
      count = n >> 3;
      if (cmd === 7) { // ClosePath
        if (ring && ring.length) { ring.push(ring[0], ring[1]); }
        continue;
      }
      for (i = 0; i < count; i++) {
        n = p.varint(); x += (n >>> 1) ^ -(n & 1);
        n = p.varint(); y += (n >>> 1) ^ -(n & 1);
        if (cmd === 1) { ring = [x, y]; rings.push(ring); }
        else if (ring) { ring.push(x, y); }
      }
    }
    return rings;
  }

  /* ---------- drawing ---------- */

  /* Interpolates [zoom, value, zoom, value...] exponentially (base 1.6, as immich's
     style does), clamped at both ends. */
  function ramp(z, stops) {
    var i, z0, z1, t;
    if (z <= stops[0]) { return stops[1]; }
    for (i = 2; i < stops.length; i += 2) {
      if (z <= stops[i]) {
        z0 = stops[i - 2]; z1 = stops[i];
        t = (Math.pow(1.6, z - z0) - 1) / (Math.pow(1.6, z1 - z0) - 1);
        return stops[i - 1] + (stops[i + 1] - stops[i - 1]) * t;
      }
    }
    return stops[stops.length - 1];
  }

  /* view: {z (style zoom: 512-pixel tiles), k (pixels per tile unit), ox, oy (offset),
     size (canvas pixels)} */
  function draw(ctx, tile, view) {
    var z = view.z, L;
    ctx.fillStyle = C.water;
    ctx.fillRect(0, 0, view.size, view.size);

    fill(ctx, tile.earth, view, C.earth, null);
    if (z >= 8) {
      ctx.globalAlpha = Math.min(1, (z - 8) / 3 + 0.3);
      fill(ctx, tile.landuse, view, C.park, function (pr) { return PARKS[pr.kind]; });
      ctx.globalAlpha = 1;
    }
    fill(ctx, tile.water, view, C.water, null);
    if (z >= 9) {
      stroke(ctx, tile.water, view, C.water, ramp(z, [9, 0.5, 18, 12]), function (pr) { return pr.kind === 'river'; });
    }
    if (z >= 14) { fill(ctx, tile.buildings, view, C.building, null); }

    L = tile.roads;
    if (z >= 11) {
      stroke(ctx, L, view, C.minor, ramp(z, [11, 0.6, 12.5, 0.9, 15, 2, 18, 11]), function (pr) {
        return pr.kind === 'minor_road' && !pr.is_tunnel;
      });
    }
    if (z >= 6) {
      stroke(ctx, L, view, C.major, ramp(z, [6, 0.6, 12, 1.6, 15, 3, 18, 13]), function (pr) {
        return pr.kind === 'major_road' && !pr.is_tunnel;
      });
    }
    if (z >= 4) {
      stroke(ctx, L, view, C.highway, ramp(z, [4, 0.6, 6, 1.1, 12, 1.8, 15, 5, 18, 15]), function (pr) {
        return pr.kind === 'highway' && !pr.is_tunnel;
      });
    }

    if (ctx.setLineDash) { ctx.setLineDash(z >= 4 ? [6, 3] : []); }
    stroke(ctx, tile.boundaries, view, C.border, 0.8, function (pr) { return pr.kind_detail > 2; });
    stroke(ctx, tile.boundaries, view, C.border, 1.4, function (pr) { return !(pr.kind_detail > 2); });
    if (ctx.setLineDash) { ctx.setLineDash([]); }

    labels(ctx, tile.places, view);
  }

  function trace(ctx, rings, view, closed) {
    var k = view.k, ox = view.ox, oy = view.oy, r, ring, i;
    for (r = 0; r < rings.length; r++) {
      ring = rings[r];
      ctx.moveTo(ring[0] * k + ox, ring[1] * k + oy);
      for (i = 2; i < ring.length; i += 2) { ctx.lineTo(ring[i] * k + ox, ring[i + 1] * k + oy); }
      if (closed) { ctx.closePath(); }
    }
  }

  /* One path per style, filled or stroked once: far cheaper than a path per shape. */
  function fill(ctx, layer, view, color, keep) {
    var fs, i, any = false;
    if (!layer) { return; }
    fs = layer.features;
    ctx.beginPath();
    for (i = 0; i < fs.length; i++) {
      if (fs[i].type !== 3 || (keep && !keep(fs[i].props))) { continue; }
      trace(ctx, fs[i].geom, view, true);
      any = true;
    }
    if (any) { ctx.fillStyle = color; ctx.fill(); }
  }

  function stroke(ctx, layer, view, color, width, keep) {
    var fs, i, any = false;
    if (!layer) { return; }
    fs = layer.features;
    ctx.beginPath();
    for (i = 0; i < fs.length; i++) {
      if (fs[i].type !== 2 || (keep && !keep(fs[i].props))) { continue; }
      trace(ctx, fs[i].geom, view, false);
      any = true;
    }
    if (any) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  function placeName(pr) { return pr['name:en'] || pr.name || ''; }

  /* Country and town names. Each one belongs to the tile its point is in, and is left
     out if it would cross the tile's edge (it would be cut there) or overlap one
     already drawn. Bigger places go first. */
  function labels(ctx, layer, view) {
    var list = [], fs, i, f, pr, x, y, text, w, h, box, taken = [], size = view.size, big, country;
    if (!layer) { return; }
    fs = layer.features;
    for (i = 0; i < fs.length; i++) {
      f = fs[i];
      pr = f.props;
      if (f.type !== 1 || !f.geom.length) { continue; }
      if (pr.kind !== 'country' && pr.kind !== 'locality') { continue; }
      if (pr.kind === 'locality' && view.z < 4) { continue; }
      if (pr.kind === 'country' && view.z > 7) { continue; }
      list.push(f);
    }
    list.sort(function (a, b) {
      var ca = a.props.kind === 'country' ? 0 : 1, cb = b.props.kind === 'country' ? 0 : 1;
      if (ca !== cb) { return ca - cb; }
      return (b.props.population_rank || 0) - (a.props.population_rank || 0) ||
        (a.props.min_zoom || 0) - (b.props.min_zoom || 0);
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (i = 0; i < list.length && taken.length < 14; i++) {
      pr = list[i].props;
      text = placeName(pr);
      if (!text) { continue; }
      country = pr.kind === 'country';
      big = country || (pr.population_rank || 0) >= 11;
      if (country) { text = text.toUpperCase(); }
      x = list[i].geom[0][0] * view.k + view.ox;
      y = list[i].geom[0][1] * view.k + view.oy;
      ctx.font = (country ? 'bold 17px ' : (big ? '21px ' : '18px ')) + FONT;
      w = ctx.measureText(text).width + 8;
      h = country ? 22 : 26;
      box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (box[0] < 2 || box[1] < 2 || box[2] > size - 2 || box[3] > size - 2 || overlaps(box, taken)) { continue; }
      taken.push(box);
      ctx.lineWidth = 4;
      ctx.strokeStyle = C.halo;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = country ? C.country : (big ? C.city : C.town);
      ctx.fillText(text, x, y);
    }
  }

  function overlaps(b, list) {
    for (var i = 0; i < list.length; i++) {
      if (b[0] < list[i][2] && b[2] > list[i][0] && b[1] < list[i][3] && b[3] > list[i][1]) { return true; }
    }
    return false;
  }

  return { decode: decode, draw: draw, WATER: C.water };
})();
