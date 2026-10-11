/* Focusable thumbnail grid with lazy image loading.
   No IntersectionObserver on the old engine, so what's on screen is worked out
   from scrollTop and the row height. Images far off screen are released again to
   keep memory down on the TV. */
var Grid = (function () {
  'use strict';

  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var AHEAD_ROWS = 4;   // rows above/below the viewport to load
  var KEEP_ROWS = 20;   // loaded rows further than this past the load window are released
  var MORE_ROWS = 3;    // ask for more items when the viewport is this close to the end

  function Grid(box, opts) {
    var self = this, pending = null;
    this.box = box;
    this.opts = opts || {};
    this.render = null;
    this.items = [];
    this.tiles = [];
    this.loaded = {};
    this.focus = 0;
    this.cols = 1;
    this.rowH = 1;
    this.active = false;

    // Magic Remote wheel / pointer scrolling. Throttled: old TVs choke on per-pixel work.
    box.addEventListener('scroll', function () {
      if (pending) { return; }
      pending = setTimeout(function () { pending = null; self.hydrate(); }, 120);
    }, false);
    window.addEventListener('resize', function () { self.measure(); self.hydrate(); }, false);
  }

  /* render(item) -> {thumb: url|null, badge: string, label: string, sub: string} */
  Grid.prototype.reset = function (render) {
    this.box.innerHTML = '';
    this.box.scrollTop = 0;
    this.render = render;
    this.items = [];
    this.tiles = [];
    this.loaded = {};
    this.focus = 0;
  };

  Grid.prototype.append = function (items) {
    var frag = document.createDocumentFragment(), start = this.items.length, i, tile;
    for (i = 0; i < items.length; i++) {
      tile = this.makeTile(items[i], start + i);
      frag.appendChild(tile);
      this.items.push(items[i]);
      this.tiles.push(tile);
    }
    this.box.appendChild(frag);
    this.measure();
    this.hydrate();
  };

  Grid.prototype.makeTile = function (item, index) {
    var self = this, r = this.render(item);
    var tile = document.createElement('div');
    var img = document.createElement('img');
    var el;
    tile.className = 'tile';
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
      tile.className += ' labelled';
      el = document.createElement('div');
      el.className = 'label';
      el.textContent = r.label;
      if (r.sub) {
        var sub = document.createElement('span');
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

  Grid.prototype.measure = function () {
    var t = this.tiles[0], cs, box, width;
    if (!t) { return; }
    cs = window.getComputedStyle(t);
    box = window.getComputedStyle(this.box);
    width = this.box.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
    this.cols = Math.max(1, Math.floor(width / (t.offsetWidth + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight))));
    this.rowH = Math.max(1, t.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom));
  };

  Grid.prototype.hydrate = function () {
    var n = this.tiles.length, top, first, last, i, img, src, k, row, totalRows;
    if (!n) { return; }
    top = this.box.scrollTop;
    first = Math.max(0, Math.floor(top / this.rowH) - AHEAD_ROWS);
    last = Math.ceil((top + this.box.clientHeight) / this.rowH) + AHEAD_ROWS;

    for (i = first * this.cols; i < Math.min(n, (last + 1) * this.cols); i++) {
      if (!this.loaded[i]) {
        img = this.tiles[i].firstChild;
        src = img.getAttribute('data-src');
        if (src) { img.src = src; this.loaded[i] = true; }
      }
    }
    for (k in this.loaded) {
      if (this.loaded.hasOwnProperty(k)) {
        row = Math.floor(k / this.cols);
        if (row < first - KEEP_ROWS || row > last + KEEP_ROWS) {
          this.tiles[k].firstChild.src = BLANK;
          delete this.loaded[k];
        }
      }
    }

    totalRows = Math.ceil(n / this.cols);
    if (last - AHEAD_ROWS >= totalRows - MORE_ROWS && this.opts.onNeedMore) { this.opts.onNeedMore(); }
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
    var t = this.tiles[i], box = this.box, pad = 24;
    var top = t.offsetTop - pad, bottom = t.offsetTop + t.offsetHeight + pad;
    if (top < box.scrollTop) {
      box.scrollTop = top;
    } else if (bottom > box.scrollTop + box.clientHeight) {
      box.scrollTop = bottom - box.clientHeight;
    }
    this.hydrate(); // the scroll handler is throttled; load straight away for key presses
  };

  /* Returns true if the key was used. Up from the top row is left to the caller. */
  Grid.prototype.key = function (k) {
    var f = this.focus, c = this.cols, n = this.tiles.length;
    if (!n) { return false; }
    switch (k) {
      case KEY.LEFT: if (f > 0) { this.setFocus(f - 1); } return true;
      case KEY.RIGHT: if (f < n - 1) { this.setFocus(f + 1); } return true;
      case KEY.UP:
        if (f - c >= 0) { this.setFocus(f - c); return true; }
        return false;
      case KEY.DOWN:
        if (f + c < n) {
          this.setFocus(f + c);
        } else if (Math.floor(f / c) < Math.floor((n - 1) / c)) {
          this.setFocus(n - 1); // short last row
        }
        return true;
      case KEY.CH_UP: this.setFocus(f - c * 3); return true;
      case KEY.CH_DOWN: this.setFocus(f + c * 3); return true;
      case KEY.OK:
        if (this.opts.onSelect) { this.opts.onSelect(this.items[f], f); }
        return true;
    }
    return false;
  };

  Grid.BLANK = BLANK;
  return Grid;
})();
