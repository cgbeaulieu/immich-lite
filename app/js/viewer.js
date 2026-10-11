/* Full-screen photo viewer and slideshow. */
var Viewer = (function () {
  'use strict';

  var root, img, bar, caption, hint, status, toastEl;
  var opts = null, index = 0, playing = false, timer = null, toastTimer = null, preload = null;

  function init() {
    root = U.$('viewer');
    img = U.$('viewer-img');
    bar = U.$('viewer-bar');
    caption = U.$('viewer-caption');
    hint = U.$('viewer-play');
    status = U.$('viewer-status');
    toastEl = U.$('viewer-toast');
    img.onload = function () { U.removeClass(img, 'loading'); schedule(); };
    img.onerror = function () {
      U.removeClass(img, 'loading');
      if (opts) { status.textContent = 'Could not load this photo'; }
      schedule();
    };
    root.onclick = function () { next(); }; // Magic Remote click
    Details.init(root, toastEl, {
      client: function () { return opts && opts.client; },
      redraw: function () { if (opts) { drawCaption(); } },
      toast: toast,
      setBar: function (on) { U.toggleClass(bar, 'hidden', !on); },
      openPerson: function (p) { var go = opts && opts.openPerson; close(); if (go) { go(p); } }
    });
  }

  /* o: {items, index, urlFor(item), more(cb(gotMore)), onClose(index), autoplay, shuffle,
         toggleFavorite(item, cb(err)), client (for the details panel), openPerson(person)}.
     o.items may be the grid's live array, so months loaded later show up here too. */
  function open(o) {
    opts = o;
    playing = false;
    U.show(root);
    U.show(bar);
    playing = !!o.autoplay; // so a slideshow that starts on a video skips it
    show(o.index, 1);
    playing = false;
    setPlaying(!!o.autoplay);
  }

  function close() {
    var i = index, done;
    Details.close(true);
    setPlaying(false, true);
    U.hide(toastEl);
    img.src = Grid.BLANK;
    U.hide(root);
    if (opts) {
      done = opts.onClose;
      opts = null;
      done(i);
    }
  }

  /* dir is the way we're moving (1 or -1); a playing slideshow skips videos that way. */
  function show(i, dir) {
    var items = opts.items, it;
    if (i < 0) { return; }
    if (i >= items.length) {
      // Past the last loaded photo: load more, then try again.
      opts.more(function (got) {
        if (!opts) { return; }
        if (got && i < opts.items.length) { show(i, dir); } else { setPlaying(false); toast('End of photos'); }
      });
      return;
    }
    it = items[i];
    if (playing && !it.isImage) { return show(i + dir, dir); }
    index = i;
    status.textContent = it.isImage ? '' : 'Video: playback is not supported yet, showing a still';
    drawCaption();
    Details.photo(it, playing);
    U.addClass(img, 'loading');
    img.src = opts.urlFor(it);
    if (items[i + 1]) {
      preload = new Image();
      preload.src = opts.urlFor(items[i + 1]);
    }
  }

  function drawCaption() {
    var it = opts.items[index];
    caption.textContent = (it.isFavorite ? '♥  ' : '') + (it.rating > 0 ? Details.stars(it.rating) + '  ' : '') +
      U.fmtDate(it.date) + '     ' +
      (opts.shuffle ? 'Shuffle' : (index + 1) + ' / ' + opts.items.length);
  }

  function toggleFavorite() {
    var it = opts && opts.items[index];
    if (!it || !opts.toggleFavorite) { return; }
    opts.toggleFavorite(it, function (err) {
      if (err) { return toast(err.message); }
      if (opts && opts.items[index] === it) { drawCaption(); }
      toast(it.isFavorite ? '♥  Added to favorites' : 'Removed from favorites');
    });
  }

  function next() { if (opts) { show(index + 1, 1); } }
  function prev() { if (opts) { show(index - 1, -1); } }

  /* The next slide is timed from when the current photo finishes loading, so slow
     loads don't skip photos. */
  function schedule() {
    clearTimeout(timer);
    if (playing && opts) { timer = setTimeout(next, Settings.slideMs()); }
  }

  function setPlaying(on, quiet) {
    var was = playing;
    playing = on;
    hint.textContent = (on ? 'OK: pause' : 'OK: slideshow') + '     ▲ favorite     ▼ details     Back: exit';
    if (on) { U.hide(bar); }
    schedule();
    if (!quiet && on !== was) {
      toast(on ? 'Slideshow on, ' + Settings.get('slideSeconds') + ' seconds' + (opts && opts.shuffle ? ', shuffled' : '')
               : 'Slideshow paused');
    }
  }

  function toast(text) {
    toastEl.textContent = text;
    U.show(toastEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { U.hide(toastEl); }, 2500);
  }

  /* Down: the details panel. It hides the info bar while it's open, and pauses a slideshow. */
  function openDetails() {
    var it = opts && opts.items[index];
    if (!it) { return; }
    setPlaying(false);
    Details.open(it, !bar.classList.contains('hidden'));
  }

  function key(k) {
    var n = Details.digit(k);
    if (n !== -1) { if (opts && opts.items[index]) { Details.rate(opts.items[index], n); } return true; }
    // The open panel takes every key but Stop, so nothing changes under it.
    if (Details.isOpen() && k !== KEY.STOP) { Details.key(k); return true; }
    switch (k) {
      case KEY.LEFT: case KEY.RW: prev(); return true;
      case KEY.RIGHT: case KEY.FF: next(); return true;
      case KEY.OK: setPlaying(!playing); return true;
      case KEY.PLAY: setPlaying(true); return true;
      case KEY.PAUSE: setPlaying(false); return true;
      case KEY.UP: toggleFavorite(); return true;
      case KEY.DOWN: openDetails(); return true;
      case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE: case KEY.STOP: close(); return true;
    }
    return false;
  }

  return { init: init, open: open, close: close, key: key };
})();
