/* Photo details panel in the viewer (Down opens it): when and where the photo was
   taken, camera settings, the people in it, its star rating and "Add to album".
   Also saves the ratings set with the number keys, panel open or not.

   Keys while the panel is open: Up/Down move between the rows (Down on the last row
   closes), Left/Right pick a face or change the stars, OK selects, Back closes.
   Left/Right never change photos here, so nothing moves under the panel. */
var Details = (function () {
  'use strict';

  var CACHE_MAX = 30;   // asset details kept, so stepping back and forth doesn't refetch
  var PEEK_MS = 400;    // rest this long on a photo before fetching its rating for the caption
  var PAGE = 6;         // CH+/CH- step in the album list
  var HINT = '▲▼ move, ▼ at the bottom closes\n◀▶ pick a face or change the stars\nOK select   1-5 rate   0 clear   Back close';

  var panel, body, env;
  var cur = null;                 // the photo the viewer shows
  var shown = false, barShown = true;
  var cache = {}, cacheCount = 0, loadingId = null, failed = null;
  var peekTimer = null;
  var rows = [], focus = 0;       // rows: {kind: 'faces' | 'rating' | 'album' | 'bar', el, ...}
  var moved = false;              // the user has moved the focus since the panel opened
  var picker = null;              // the album list while it's open: {albums, rows, focus}
  var jobs = [], busy = false;    // rating saves, sent one at a time so they land in order

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text) { e.textContent = text; }
    return e;
  }

  /* 0-9 from the top row, the numpad or the remote's number keys; -1 for anything else. */
  function digit(k) {
    if (k >= 48 && k <= 57) { return k - 48; }
    if (k >= 96 && k <= 105) { return k - 96; }
    return -1;
  }

  function stars(n) { return new Array((n || 0) + 1).join('★'); }
  function starsOf5(n) { return stars(n) + new Array(5 - (n || 0) + 1).join('☆'); }

  /* env: {client(), redraw(), toast(text), setBar(on), openPerson(person)} from the viewer.
     The panel goes before `before` (the toast) so toasts stay on top of it. */
  function init(viewerRoot, before, e) {
    env = e;
    panel = el('div', 'hidden');
    panel.id = 'details';
    // A click in the panel must not reach the viewer, where it means "next photo".
    panel.onclick = function (ev) { ev.stopPropagation(); };
    viewerRoot.insertBefore(panel, before);
  }

  // ---------- asset details ----------

  function remember(id, dto) {
    if (cacheCount >= CACHE_MAX) { cache = {}; cacheCount = 0; }
    if (!cache[id]) { cacheCount++; }
    cache[id] = dto;
  }

  /* The rating the server knows, unless this session already changed it. */
  function apply(it, dto) {
    var r = dto.exifInfo && dto.exifInfo.rating;
    if (it.rating === undefined) { it.rating = r > 0 ? r : null; }
  }

  function load() {
    var it = cur, c = env.client();
    if (!it || !c || cache[it.id] || loadingId === it.id) { return; }
    loadingId = it.id;
    c.asset(it.id, function (err, dto) {
      if (loadingId === it.id) { loadingId = null; }
      if (err || !dto) {
        failed = { id: it.id, message: err ? err.message : 'No answer' };
      } else {
        remember(it.id, dto);
        apply(it, dto);
      }
      if (cur !== it) { return; }
      env.redraw();
      if (shown && !picker) { render(); }
    });
  }

  /* The viewer moved to it. Its rating is fetched for the caption once the user rests
     on it, but not during a slideshow (the caption is hidden then). */
  function photo(it, playing) {
    var was = it.rating;
    cur = it;
    clearTimeout(peekTimer);
    if (shown) { picker = null; render(); load(); return; } // a Magic Remote click moved on
    if (cache[it.id]) {
      apply(it, cache[it.id]);
      if (it.rating !== was) { env.redraw(); }
      return;
    }
    if (!playing) { peekTimer = setTimeout(load, PEEK_MS); }
  }

  // ---------- the panel ----------

  function open(it, barWasShown) {
    cur = it;
    shown = true;
    picker = null;
    barShown = barWasShown;
    rows = [];
    focus = 0;
    moved = false;
    env.setBar(false);
    U.show(panel);
    render();
    load();
  }

  /* leaving: the viewer itself is closing. */
  function close(leaving) {
    clearTimeout(peekTimer);
    if (leaving) { cur = null; }
    if (!shown) { return; }
    shown = false;
    picker = null;
    U.hide(panel);
    panel.innerHTML = '';
    if (!leaving) { env.setBar(barShown); }
  }

  function frame(hint) {
    panel.innerHTML = '';
    body = el('div', 'd-body');
    panel.appendChild(body);
    panel.appendChild(el('div', 'd-hint', hint));
  }

  function render() {
    var it = cur, dto = cache[it.id], ex = (dto && dto.exifInfo) || {};
    var keep = rows[focus] ? rows[focus].kind : null, when, place, people, i;

    frame(HINT);
    rows = [];
    when = dto && dto.localDateTime ? String(dto.localDateTime) : '';
    body.appendChild(el('div', 'd-date', U.fmtDayHeader(when ? when.substr(0, 10) : it.date) || 'Photo details'));
    if (when.length >= 16) { body.appendChild(el('div', 'd-time', fmtTime(when))); }
    place = join([ex.city, ex.state, ex.country], ', ');
    if (place) { body.appendChild(el('div', 'd-place', place)); }
    if (ex.description) { body.appendChild(el('div', 'd-desc', ex.description)); }

    people = visiblePeople(dto);
    if (people.length) {
      body.appendChild(el('div', 'd-sub', people.length === 1 ? 'Person in this photo' : 'People in this photo'));
      addFaces(people);
    }
    addRow('rating', 'Rating');
    addRow('album', 'Add to album');
    addRow('bar', '');

    if (dto) {
      addFacts(dto, ex);
    } else {
      body.appendChild(el('div', 'd-note', failed && failed.id === it.id
        ? 'Could not load the details: ' + failed.message : 'Loading details...'));
    }

    // Faces that arrive after the panel opened take the focus, unless the user has moved.
    focus = 0;
    for (i = 0; i < rows.length; i++) { if (moved && rows[i].kind === keep) { focus = i; } }
    draw();
  }

  function addFaces(people) {
    var box = el('div', 'd-faces'), row = { kind: 'faces', el: box, faces: [], people: people, pick: 0 }, i;
    var index = rows.length;
    for (i = 0; i < people.length; i++) {
      (function (j) {
        var face = el('div', 'd-face'), img = el('img');
        img.src = env.client().personThumbUrl(people[j].id);
        img.onerror = function () { if (img.src !== Grid.BLANK) { img.src = Grid.BLANK; } };
        face.appendChild(img);
        face.appendChild(el('span', '', people[j].name || 'Unnamed'));
        face.onmouseover = function () { focus = index; row.pick = j; moved = true; draw(); };
        face.onclick = function () { env.openPerson(people[j]); };
        box.appendChild(face);
        row.faces.push(face);
      })(i);
    }
    body.appendChild(box);
    rows.push(row);
  }

  function addRow(kind, label) {
    var index = rows.length, row = el('div', 'd-row');
    row.appendChild(el('span', 'name', label));
    row.appendChild(el('span', 'value'));
    row.onmouseover = function () { focus = index; moved = true; draw(); };
    row.onclick = function () { focus = index; activate(); };
    body.appendChild(row);
    rows.push({ kind: kind, el: row });
  }

  function addFacts(dto, ex) {
    var w = ex.exifImageWidth || dto.width, h = ex.exifImageHeight || dto.height, facts, i, line;
    facts = [
      ['File', dto.originalFileName],
      ['Camera', camera(ex)],
      ['Lens', ex.lensModel],
      ['Settings', join([ex.fNumber ? 'f/' + round1(ex.fNumber) : '', ex.exposureTime ? ex.exposureTime + ' s' : '',
        ex.focalLength ? round1(ex.focalLength) + ' mm' : '', ex.iso ? 'ISO ' + ex.iso : ''], '   ')],
      ['Size', join([w && h ? w + ' × ' + h + '  (' + round1(w * h / 1e6) + ' MP)' : '', fmtBytes(ex.fileSizeInByte)], '   ')]
    ];
    body.appendChild(el('div', 'd-sub', 'Details'));
    for (i = 0; i < facts.length; i++) {
      if (!facts[i][1]) { continue; }
      line = el('div', 'd-fact');
      line.appendChild(el('span', 'k', facts[i][0]));
      line.appendChild(el('span', 'v', facts[i][1]));
      body.appendChild(line);
    }
  }

  function draw() {
    var i, j, r, on;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      on = i === focus;
      if (r.kind === 'faces') {
        for (j = 0; j < r.faces.length; j++) { U.toggleClass(r.faces[j], 'focused', on && j === r.pick); }
        continue;
      }
      U.toggleClass(r.el, 'focused', on);
      if (r.kind === 'rating') {
        r.el.lastChild.textContent = cur.rating > 0 ? starsOf5(cur.rating) : (cur.rating === null ? 'Not rated' : '');
        U.toggleClass(r.el.lastChild, 'd-stars', cur.rating > 0);
      } else if (r.kind === 'album') {
        r.el.lastChild.textContent = '›';
      } else if (r.kind === 'bar') {
        r.el.firstChild.textContent = barShown ? 'Hide info bar' : 'Show info bar';
      }
    }
    r = rows[focus];
    if (r) { reveal(r.kind === 'faces' ? r.faces[r.pick] : r.el); }
  }

  /* Keeps the focused row on screen (the panel scrolls on a 720p screen). */
  function reveal(e) {
    if (e.offsetTop - 24 < body.scrollTop) { body.scrollTop = e.offsetTop - 24; }
    else if (e.offsetTop + e.offsetHeight + 24 > body.scrollTop + body.clientHeight) {
      body.scrollTop = e.offsetTop + e.offsetHeight + 24 - body.clientHeight;
    }
  }

  function activate() {
    var r = rows[focus];
    if (!r) { return; }
    if (r.kind === 'faces') { env.openPerson(r.people[r.pick]); }
    else if (r.kind === 'album') { openPicker(); }
    else if (r.kind === 'bar') { barShown = !barShown; close(); }
  }

  function side(dir) {
    var r = rows[focus];
    if (!r) { return; }
    moved = true;
    if (r.kind === 'faces') {
      r.pick = Math.max(0, Math.min(r.faces.length - 1, r.pick + dir));
      draw();
    } else if (r.kind === 'rating') {
      rate(cur, Math.max(0, Math.min(5, (cur.rating || 0) + dir)));
    }
  }

  /* Returns true if the key was used. The panel keeps arrows, OK and Back to itself. */
  function key(k) {
    if (picker) { return pickerKey(k); }
    switch (k) {
      case KEY.UP: if (focus > 0) { focus--; moved = true; draw(); } return true;
      case KEY.DOWN: if (focus < rows.length - 1) { focus++; moved = true; draw(); } else { close(); } return true;
      case KEY.LEFT: side(-1); return true;
      case KEY.RIGHT: side(1); return true;
      case KEY.OK: activate(); return true;
      case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE: close(); return true;
    }
    return false;
  }

  // ---------- ratings ----------

  function ratedText(n) { return n ? 'Rated ' + n + (n === 1 ? ' star' : ' stars') : 'Rating cleared'; }

  /* n: 1-5, or 0 to clear. Shown straight away, saved in the background. */
  function rate(it, n) {
    var c = env.client(), last = jobs[jobs.length - 1];
    if (!it || !c) { return; }
    if (n > 5) { return env.toast('Press 1 to 5 to rate, 0 to clear'); }
    if (it.rating !== undefined && (it.rating || 0) === n && !(last && last.it === it)) { return env.toast(ratedText(n)); }
    // Quick Left/Right presses fold into the save that hasn't gone out yet.
    if (last && last.it === it) { last.n = n; } else { jobs.push({ c: c, it: it, n: n, was: it.rating }); }
    setLocal(it, n || null);
    pump();
  }

  function setLocal(it, r) {
    var dto = cache[it.id];
    it.rating = r;
    if (dto && dto.exifInfo) { dto.exifInfo.rating = r; }
    if (cur === it) { env.redraw(); }
    if (shown && !picker && cur === it) { draw(); }
  }

  function pump() {
    var job;
    if (busy || !jobs.length) { return; }
    job = jobs.shift();
    busy = true;
    // Immich v3 clears a rating with null (0 is no longer accepted).
    job.c.setRating([job.it.id], job.n || null, function (err) {
      busy = false;
      if (err) {
        if (job.it.rating === (job.n || null)) { setLocal(job.it, job.was); }
        env.toast(err.message);
      } else if (!jobs.length || jobs[0].it !== job.it) {
        env.toast(ratedText(job.n));
      }
      pump();
    });
  }

  // ---------- add to album ----------

  function openPicker() {
    var c = env.client(), it = cur;
    picker = { albums: [], rows: [], focus: 0 };
    moved = true; // come back to this row
    drawPicker('Loading albums...');
    c.albums(function (err, list) {
      if (!picker || cur !== it || !shown) { return; }
      if (err) { return drawPicker(err.message); }
      // Most recently changed first, like the Albums tab.
      list.sort(function (a, b) {
        var x = a.lastModifiedAssetTimestamp || a.updatedAt || '', y = b.lastModifiedAssetTimestamp || b.updatedAt || '';
        return x < y ? 1 : (x > y ? -1 : 0);
      });
      picker.albums = list;
      drawPicker(list.length ? '' : 'No albums yet. Create one in Immich first.');
    });
  }

  function drawPicker(note) {
    var i;
    frame('▲▼ choose   OK add   Back cancel');
    body.appendChild(el('div', 'd-date', 'Add to album'));
    if (note) { body.appendChild(el('div', 'd-note', note)); }
    picker.rows = [];
    for (i = 0; i < picker.albums.length; i++) {
      (function (j) {
        var a = picker.albums[j], row = el('div', 'd-row');
        row.appendChild(el('span', 'name', a.albumName || 'Untitled album'));
        row.appendChild(el('span', 'value', String(a.assetCount)));
        row.onmouseover = function () { picker.focus = j; drawPickerFocus(); };
        row.onclick = function () { addTo(a); };
        body.appendChild(row);
        picker.rows.push(row);
      })(i);
    }
    drawPickerFocus();
  }

  function drawPickerFocus() {
    var i;
    for (i = 0; i < picker.rows.length; i++) { U.toggleClass(picker.rows[i], 'focused', i === picker.focus); }
    if (picker.rows[picker.focus]) { reveal(picker.rows[picker.focus]); }
  }

  function pickerKey(k) {
    var n = picker.rows.length;
    switch (k) {
      case KEY.UP: picker.focus = Math.max(0, picker.focus - 1); break;
      case KEY.DOWN: picker.focus = Math.min(n - 1, picker.focus + 1); break;
      case KEY.CH_UP: picker.focus = Math.max(0, picker.focus - PAGE); break;
      case KEY.CH_DOWN: picker.focus = Math.min(n - 1, picker.focus + PAGE); break;
      case KEY.OK: if (picker.albums[picker.focus]) { addTo(picker.albums[picker.focus]); } return true;
      case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE: picker = null; render(); return true;
      default: return true;
    }
    if (n) { drawPickerFocus(); }
    return true;
  }

  function addTo(a) {
    var c = env.client(), it = cur, name = a.albumName || 'Untitled album';
    picker = null;
    render();
    c.addToAlbum(a.id, [it.id], function (err, results) {
      var r = null, i;
      if (err) { return env.toast(err.message); }
      for (i = 0; i < (results || []).length; i++) { if (results[i].id === it.id) { r = results[i]; } }
      if (r && r.success) { env.toast('Added to ' + name); }
      else if (r && r.error === 'duplicate') { env.toast('Already in ' + name); }
      else if (r && r.error === 'no_permission') { env.toast('You can\'t add photos to ' + name); }
      else { env.toast('Could not add to ' + name + (r && r.error ? ' (' + r.error + ')' : '')); }
    });
  }

  // ---------- formatting ----------

  function visiblePeople(dto) {
    var out = [], list = (dto && dto.people) || [], i;
    for (i = 0; i < list.length; i++) { if (!list[i].isHidden) { out.push(list[i]); } }
    return out;
  }

  function join(parts, sep) {
    var out = [], i;
    for (i = 0; i < parts.length; i++) { if (parts[i]) { out.push(parts[i]); } }
    return out.join(sep);
  }

  function round1(x) { return String(Math.round(x * 10) / 10); }

  /* Many cameras repeat the make in the model ("Canon" + "Canon EOS R6"). */
  function camera(ex) {
    var make = ex.make || '', model = ex.model || '';
    if (make && model.toLowerCase().indexOf(make.toLowerCase()) === 0) { return model; }
    return join([make, model], ' ');
  }

  /* localDateTime is the local time written as UTC: "2026-09-28T15:05:00.000Z" -> "3:05 PM" */
  function fmtTime(iso) {
    var h = parseInt(iso.substr(11, 2), 10);
    return (h % 12 || 12) + ':' + iso.substr(14, 2) + (h < 12 ? ' AM' : ' PM');
  }

  function fmtBytes(n) {
    if (!n) { return ''; }
    if (n >= 1e9) { return round1(n / 1e9) + ' GB'; }
    if (n >= 1e6) { return round1(n / 1e6) + ' MB'; }
    return Math.max(1, Math.round(n / 1e3)) + ' KB';
  }

  return {
    init: init, photo: photo, open: open, close: close, key: key, rate: rate,
    isOpen: function () { return shown; },
    digit: digit, stars: stars
  };
})();
