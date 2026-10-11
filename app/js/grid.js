/* Focusable thumbnail grid with titled sections and lazy image loading.

   Items are split into sections (a day in the timeline, "People" on Explore...).
   Like Immich's web timeline, a section smaller than a row is packed beside its
   neighbours instead of taking a whole row. Up/down navigation therefore works on
   screen rows (tiles sharing a top edge), picking the nearest tile by position.

   No IntersectionObserver on the old engine: what's on screen is worked out from
   scrollTop and tile offsets. Images far off screen are released again to keep
   memory down on the TV. */
var Grid = (function () {
  'use strict';

  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var LOAD_SCREENS = 1;   // load images this many screens above and below the view
  var KEEP_SCREENS = 4;   // release loaded images further away than this
  var MORE_SCREENS = 1.5; // ask for more items when the end is this close

  function Grid(box, opts) {
    var self = this, pending = null;
    this.box = box;
    this.opts = opts || {};
    this.reset(null);

    // Magic Remote wheel / pointer scrolling. Throttled: old TVs choke on per-pixel work.
    box.addEventListener('scroll', function () {
      if (pending) { return; }
      pending = setTimeout(function () { pending = null; self.hydrate(); }, 120);
    }, false);
    window.addEventListener('resize', function () {
      var i;
      for (i = 0; i < self.sections.length; i++) { self.size(self.sections[i]); }
      self.layout();
      self.hydrate();
    }, false);
  }

  /* render(item) -> {thumb, badge, label, sub, shape: 'photo' | 'card' | 'person'} */
  Grid.prototype.reset = function (render) {
    this.box.innerHTML = '';
    this.box.scrollTop = 0;
    this.render = render;
    this.items = [];
    this.tiles = [];
    this.sections = [];   // {key, el, start, count}
    this.secOf = [];      // item index -> section index
    this.rows = [];       // screen rows: {start, end, top}
    this.rowOf = [];      // item index -> row index
    this.loaded = {};
    this.focus = 0;
    this.active = !!this.active;
  };

  /* Adds items to the end. Items with a different key from the last section start a
     new section, titled with title (no title: just a new row). */
  Grid.prototype.append = function (items, key, title) {
    var frag = document.createDocumentFragment(), last = this.sections[this.sections.length - 1];
    var i, tile, el, header;
    if (!items.length) { return; }
    if (!last || (key !== undefined && key !== last.key)) {
      el = document.createElement('div');
      el.className = 'section';
      if (title) {
        header = document.createElement('div');
        header.className = 'section-title';
        header.textContent = title;
        el.appendChild(header);
      }
      this.box.appendChild(el);
      last = { key: key, el: el, start: this.items.length, count: 0 };
      this.sections.push(last);
    }
    for (i = 0; i < items.length; i++) {
      tile = this.makeTile(items[i], this.items.length);
      frag.appendChild(tile);
      this.secOf.push(this.sections.length - 1);
      this.items.push(items[i]);
      this.tiles.push(tile);
    }
    last.count += items.length;
    last.el.appendChild(frag);
    this.size(last);
    this.layout();
    this.hydrate();
  };

  /* A section narrower than a full row shrinks to its tiles so the next one can sit
     beside it; anything wider takes the full width. */
  Grid.prototype.size = function (s) {
    var t = this.tiles[s.start], bs = window.getComputedStyle(this.box), cs = window.getComputedStyle(t);
    var inner = this.box.clientWidth - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight);
    var outer = t.offsetWidth + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
    var perRow = Math.max(1, Math.floor(inner / outer));
    s.el.style.width = s.count < perRow ? (s.count * outer + 'px') : '100%';
  };

  Grid.prototype.makeTile = function (item, index) {
    var self = this, r = this.render(item);
    var tile = document.createElement('div');
    var img = document.createElement('img');
    var el, sub;
    tile.className = 'tile ' + (r.shape || 'photo');
    img.className = 'thumb';
    img.src = BLANK;
    img.setAttribute('data-src', r.thumb || '');
    img.onerror = function () { if (img.src !== BLANK) { img.src = BLANK; } };
    tile.appendChild(img);
    if (r.badge) {
      el = document.createElement('span');
      el.className = 'badge';
      el.textContent = r.badge;
      tile.appendChild(el);
    }
    if (r.label) {
      el = document.createElement('div');
      el.className = 'label';
      el.textContent = r.label;
      if (r.sub) {
        sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = r.sub;
        el.appendChild(sub);
      }
      tile.appendChild(el);
    }
    // Magic Remote pointer: hovering focuses, clicking opens. No scrolling on hover.
    tile.onmouseover = function () {
      if (self.opts.onPointer) { self.opts.onPointer(); }
      self.setFocus(index, true);
    };
    tile.onclick = function () {
      self.setFocus(index, true);
      if (self.opts.onSelect) { self.opts.onSelect(self.items[index], index); }
    };
    return tile;
  };

  /* Rebuilds the screen rows: runs of tiles with the same top edge. Tiles flow in
     order, so their tops never go back up. */
  Grid.prototype.layout = function () {
    var top = null, row = null, i, t;
    this.rows = [];
    this.rowOf = [];
    for (i = 0; i < this.tiles.length; i++) {
      t = this.tiles[i].offsetTop;
      if (t !== top) {
        row = { start: i, end: i + 1, top: t, bottom: t + this.tiles[i].offsetHeight };
        this.rows.push(row);
        top = t;
      } else {
        row.end = i + 1;
      }
      this.rowOf[i] = this.rows.length - 1;
    }
  };

  /* First row reaching below y. */
  Grid.prototype.rowAt = function (y) {
    var lo = 0, hi = this.rows.length - 1, mid;
    while (lo < hi) {
      mid = (lo + hi) >> 1;
      if (this.rows[mid].bottom < y) { lo = mid + 1; } else { hi = mid; }
    }
    return lo;
  };

  Grid.prototype.hydrate = function () {
    var h = this.box.clientHeight, top = this.box.scrollTop, r, i, img, src, k, t, lastTile;
    var from = top - h * LOAD_SCREENS, to = top + h * (1 + LOAD_SCREENS);
    if (!this.rows.length || !h) { return; }

    for (r = this.rowAt(from); r < this.rows.length; r++) {
      if (this.rows[r].top > to) { break; }
      for (i = this.rows[r].start; i < this.rows[r].end; i++) {
        if (!this.loaded[i]) {
          img = this.tiles[i].firstChild;
          src = img.getAttribute('data-src');
          if (src) { img.src = src; this.loaded[i] = true; }
        }
      }
    }
    for (k in this.loaded) {
      if (this.loaded.hasOwnProperty(k)) {
        t = this.tiles[k];
        if (t.offsetTop < top - h * KEEP_SCREENS || t.offsetTop > top + h * (1 + KEEP_SCREENS)) {
          t.firstChild.src = BLANK;
          delete this.loaded[k];
        }
      }
    }

    lastTile = this.tiles[this.tiles.length - 1];
    if (lastTile.offsetTop < top + h * (1 + MORE_SCREENS) && this.opts.onNeedMore) { this.opts.onNeedMore(); }
  };

  Grid.prototype.setActive = function (on) {
    this.active = on;
    U.toggleClass(this.tiles[this.focus], 'focused', on);
  };

  Grid.prototype.setFocus = function (i, noScroll) {
    if (!this.tiles.length) { return; }
    i = Math.max(0, Math.min(this.tiles.length - 1, i));
    U.removeClass(this.tiles[this.focus], 'focused');
    this.focus = i;
    if (this.active) { U.addClass(this.tiles[i], 'focused'); }
    if (!noScroll) { this.reveal(i); }
    if (this.opts.onFocus) { this.opts.onFocus(this.items[i], i); }
  };

  Grid.prototype.reveal = function (i) {
    var t = this.tiles[i], box = this.box, pad = 24, s = this.sections[this.secOf[i]];
    // On a section's first row, bring its title into view too.
    var top = (t.offsetTop === this.tiles[s.start].offsetTop ? s.el.offsetTop : t.offsetTop) - pad;
    var bottom = t.offsetTop + t.offsetHeight + pad;
    if (top < box.scrollTop) {
      box.scrollTop = top;
    } else if (bottom > box.scrollTop + box.clientHeight) {
      box.scrollTop = bottom - box.clientHeight;
    }
    this.hydrate(); // the scroll handler is throttled; load straight away for key presses
  };

  /* Moves focus by screen rows, to the tile nearest the current one sideways. */
  Grid.prototype.moveRows = function (delta) {
    var r = this.rowOf[this.focus], target = r + delta, row, cur, x, best, bestD = Infinity, d, i, t;
    if (target < 0 || target >= this.rows.length) {
      if (delta > 0 && r < this.rows.length - 1) { target = this.rows.length - 1; } else { return false; }
    }
    cur = this.tiles[this.focus];
    x = cur.offsetLeft + cur.offsetWidth / 2;
    row = this.rows[target];
    for (i = row.start; i < row.end; i++) {
      t = this.tiles[i];
      d = Math.abs(t.offsetLeft + t.offsetWidth / 2 - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    this.setFocus(best);
    return true;
  };

  /* Returns true if the key was used. Up from the top row is left to the caller. */
  Grid.prototype.key = function (k) {
    var f = this.focus, n = this.tiles.length;
    if (!n) { return false; }
    switch (k) {
      case KEY.LEFT: if (f > 0) { this.setFocus(f - 1); } return true;
      case KEY.RIGHT: if (f < n - 1) { this.setFocus(f + 1); } return true;
      case KEY.UP: return this.moveRows(-1);
      case KEY.DOWN: this.moveRows(1); return true;
      case KEY.CH_UP: if (!this.moveRows(-3)) { this.setFocus(0); } return true;
      case KEY.CH_DOWN: this.moveRows(3); return true;
      case KEY.OK:
        if (this.opts.onSelect) { this.opts.onSelect(this.items[f], f); }
        return true;
    }
    return false;
  };

  Grid.BLANK = BLANK;
  return Grid;
})();
