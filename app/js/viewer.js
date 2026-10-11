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
    initStack();
  }

  /* o: {items, index, urlFor(item), more(cb(gotMore)), onClose(index), autoplay, shuffle,
         toggleFavorite(item, cb(err))}.
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
    resetStack(it);
    status.textContent = it.isImage ? '' : 'Video: playback is not supported yet, showing a still';
    drawCaption();
    U.addClass(img, 'loading');
    img.src = opts.urlFor(it);
    if (items[i + 1]) {
      preload = new Image();
      preload.src = opts.urlFor(items[i + 1]);
    }
  }

  function drawCaption() {
    var it = opts.items[index];
    caption.textContent = (it.isFavorite ? '♥  ' : '') + U.fmtDate(it.date) + '     ' +
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
    hint.textContent = (on ? 'OK: pause' : 'OK: slideshow') + '     ▲ favorite     ▼ hide info     Back: exit';
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

  // ---------- stacks (burst shots, edits) ----------

  /* A timeline photo can be the primary of a stack (item.stackId, item.stackCount).
     CH+/CH- show the stack's other members in place, without moving off the timeline
     item, so Left/Right still go to the next timeline photo. Members come from
     opts.stack(item, cb(err, assets)), primary first, loaded on the first CH press. */
  var stackLabel, stackHint, stackItem = null, stackList = null, stackPos = 0, stackBusy = false, stackToken = 0;

  function initStack() {
    stackLabel = document.createElement('span');
    stackLabel.className = 'viewer-stack';
    bar.insertBefore(stackLabel, caption.nextSibling);
    stackHint = document.createElement('span');
    stackHint.className = 'viewer-stack-hint hidden';
    stackHint.textContent = 'CH+/CH-: stack';
    bar.appendChild(stackHint);
  }

  function resetStack(it) {
    stackItem = it && it.stackId && it.stackCount > 1 ? it : null;
    stackList = null;
    stackPos = 0;
    stackBusy = false;
    stackToken++;
    drawStack();
  }

  function drawStack() {
    var n = stackList ? stackList.length : (stackItem ? stackItem.stackCount : 0);
    stackLabel.textContent = stackItem ? '     Stack ' + (stackPos + 1) + ' / ' + n : '';
    U.toggleClass(stackHint, 'hidden', !stackItem);
  }

  function stepStack(dir) {
    var token = stackToken, m;
    if (!opts || !stackItem || !opts.stack) { return false; }
    if (!stackList) {
      if (stackBusy) { return true; }
      stackBusy = true;
      opts.stack(stackItem, function (err, list) {
        if (!opts || token !== stackToken) { return; } // moved to another photo meanwhile
        stackBusy = false;
        if (err) { return toast(err.message); }
        if (list.length < 2) { return toast('This stack has no other photos'); }
        stackList = list;
        stepStack(dir);
      });
      return true;
    }
    stackPos = (stackPos + dir + stackList.length) % stackList.length;
    m = stackList[stackPos];
    status.textContent = m.isImage ? '' : 'Video: playback is not supported yet, showing a still';
    drawStack();
    U.addClass(img, 'loading');
    img.src = opts.urlFor(m);
    return true;
  }

  function key(k) {
    switch (k) {
      case KEY.LEFT: case KEY.RW: prev(); return true;
      case KEY.RIGHT: case KEY.FF: next(); return true;
      case KEY.OK: setPlaying(!playing); return true;
      case KEY.PLAY: setPlaying(true); return true;
      case KEY.PAUSE: setPlaying(false); return true;
      case KEY.UP: toggleFavorite(); return true;
      case KEY.DOWN: U.toggleClass(bar, 'hidden', !bar.classList.contains('hidden')); return true;
      case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE: case KEY.STOP: close(); return true;
      case KEY.CH_UP: return stepStack(1);
      case KEY.CH_DOWN: return stepStack(-1);
    }
    return false;
  }

  return { init: init, open: open, close: close, key: key };
})();
