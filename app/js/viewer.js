/* Full-screen photo viewer and slideshow. */
var Viewer = (function () {
  'use strict';

  var root, img, bar, caption, hint, status, toastEl, progress;
  var okLabel = 'Slideshow';
  var opts = null, index = 0, playing = false, timer = null, toastTimer = null, preload = null;
  var photoToken = 0, arrows = {}, idleTimer = null;
  var IDLE_MS = 4000;

  function init() {
    root = U.$('viewer');
    img = U.$('viewer-img');
    bar = U.$('viewer-bar');
    caption = U.$('viewer-caption');
    hint = U.$('viewer-play');
    status = U.$('viewer-status');
    toastEl = U.$('viewer-toast');
    progress = U.$('viewer-progress-fill');
    root.onclick = function () { if (zoomScale === 1) { next(); } }; // Magic Remote click (zoomed, it ends a drag)
    root.onmousemove = function () { wake(); };
    initArrows();
    initStack();
    initVideo();
    initZoom();
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
    wake();
    playing = !!o.autoplay; // so a slideshow that starts on a video skips it
    show(o.index, 1);
    playing = false;
    setPlaying(!!o.autoplay);
    if (videoItem && !o.autoplay) { playVideo(); } // a video picked in the grid starts playing
  }

  function close() {
    var i = index, done;
    Details.close(true);
    setPlaying(false, true);
    U.hide(toastEl);
    photoToken++;
    resetZoom();
    clearTimeout(idleTimer);
    U.removeClass(root, 'idle');
    img.src = Grid.BLANK;
    stopVideo();
    Music.release();
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
    status.textContent = '';
    if (stopVideo()) { setPlaying(playing, true); } // puts the photo hint back
    if (!it.isImage) { showVideo(it); }
    drawCaption();
    Details.photo(it, playing);
    drawArrows();
    loadPhoto(opts.urlFor(it));
    if (items[i + 1]) {
      preload = new Image();
      preload.src = opts.urlFor(items[i + 1]);
    }
  }

  /* Loads the photo off screen, then shows it already sized to its own shape. Swapping
     the src of the visible <img> made the old engine draw the new photo stretched to
     the old size (or the full screen) for a moment before it fit. */
  function loadPhoto(src) {
    var t = ++photoToken, pre = new Image();
    resetZoom(); // each photo starts at fit
    U.addClass(img, 'loading');
    pre.onload = function () {
      if (t !== photoToken) { return; } // moved on meanwhile
      fitPhoto(pre.naturalWidth, pre.naturalHeight);
      img.src = src; // cached now, so it appears at once
      U.removeClass(img, 'loading');
      schedule();
    };
    pre.onerror = function () {
      if (t !== photoToken) { return; }
      U.removeClass(img, 'loading');
      if (opts) { status.textContent = 'Could not load this photo'; }
      schedule();
    };
    pre.src = src;
  }

  /* Fits w x h into the screen, centred, keeping its shape. */
  function fitPhoto(w, h) {
    var W = root.clientWidth, H = root.clientHeight, scale, dw, dh, st = img.style;
    if (!w || !h) { w = W; h = H; }
    scale = Math.min(W / w, H / h);
    dw = Math.round(w * scale);
    dh = Math.round(h * scale);
    st.width = dw + 'px';
    st.height = dh + 'px';
    st.left = Math.round((W - dw) / 2) + 'px';
    st.top = Math.round((H - dh) / 2) + 'px';
  }

  /* Previous / next arrows at the edges. They show and hide with the info bar (CSS),
     and the Magic Remote can click them. */
  function initArrows() {
    var names = ['prev', 'next'], i;
    for (i = 0; i < names.length; i++) {
      (function (name) {
        var a = document.createElement('div');
        a.className = 'v-arrow ' + name;
        a.innerHTML = Icons.svg('chevron');
        a.onclick = function (e) {
          if (e && e.stopPropagation) { e.stopPropagation(); } // not also the viewer's click
          if (name === 'prev') { prev(); } else { next(); }
        };
        root.appendChild(a); // after the bar, so '#viewer-bar.hidden ~ .v-arrow' hides them
        arrows[name] = a;
      })(names[i]);
    }
  }

  function drawArrows() {
    U.toggleClass(arrows.prev, 'hidden', !opts || index === 0);
  }

  /* Bottom-left: the date big, where it was and who's in it (once the details are in),
     then favorite, stars, position and stack on one line. */
  function drawCaption() {
    var it = opts.items[index], date = document.createElement('div'), meta = document.createElement('div'), parts = [], st, where, line;
    date.className = 'v-date';
    date.textContent = U.fmtDateLong(it.date) || ' ';
    meta.className = 'v-meta';
    where = Details.where(it);
    if (it.isFavorite) { parts.push('♥ Favorite'); }
    parts.push(opts.shuffle ? 'Shuffle' : (index + 1) + ' of ' + opts.items.length);
    if (stackItem) { parts.push('Stack ' + (stackPos + 1) + ' of ' + (stackList ? stackList.length : stackItem.stackCount)); }
    if (it.rating > 0) {
      st = document.createElement('span');
      st.className = 'star';
      st.textContent = Details.stars(it.rating) + '   ';
      meta.appendChild(st);
    }
    meta.appendChild(document.createTextNode(parts.join('   ·   ')));
    caption.innerHTML = '';
    caption.appendChild(date);
    if (where) {
      line = document.createElement('div');
      line.className = 'v-where';
      line.textContent = where;
      caption.appendChild(line);
    }
    caption.appendChild(meta);
  }

  /* Bottom-right: what the keys do, as keycaps. */
  function renderHint() {
    var list = [['◀ ▶', 'Browse'], ['OK', okLabel], ['▲', 'Favorite'], ['▼', 'Details']], i, h, cap;
    if (stackItem) { list.push(['CH', 'Stack']); }
    if (zoomScale > 1) { list = zoomHints(); }
    hint.innerHTML = '';
    for (i = 0; i < list.length; i++) {
      h = document.createElement('span');
      h.className = 'keyhint';
      cap = document.createElement('span');
      cap.className = 'keycap';
      cap.textContent = list[i][0];
      h.appendChild(cap);
      h.appendChild(document.createTextNode(list[i][1]));
      hint.appendChild(h);
    }
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
    runProgress(playing && opts ? Settings.slideMs() : 0);
    if (playing && opts) { timer = setTimeout(next, Settings.slideMs()); }
  }

  /* The thin line along the bottom fills up until the next slide (hidden when paused). */
  function runProgress(ms) {
    var st = progress.style;
    st.webkitTransition = st.transition = 'none';
    st.width = '0';
    U.toggleClass(progress.parentNode, 'hidden', !ms);
    if (!ms) { return; }
    progress.offsetWidth; // apply the reset before animating again
    st.webkitTransition = 'width ' + ms + 'ms linear';
    st.transition = 'width ' + ms + 'ms linear';
    st.width = '100%';
  }

  /* Pausing a slideshow brings the info bar back, and fetches the photo's details so
     the caption can say where it was and who's in it ("where was this?"). While it
     plays, the TV's screensaver is held off and the music (if on) plays. */
  function setPlaying(on, quiet) {
    var was = playing, it = opts && opts.items[index];
    playing = on;
    okLabel = on ? 'Pause' : 'Slideshow';
    renderHint();
    Awake.hold(on && !!opts);
    if (on && opts) { Music.play(); } else { Music.pause(); }
    if (on) { U.hide(bar); }
    else if (was && !quiet && it) { // quiet: closing, or a video took over
      if (!Details.isOpen()) { U.show(bar); }
      Details.photo(it, false);
      drawCaption();
    }
    schedule();
    if (!quiet && on !== was) {
      toast(on ? 'Slideshow on, ' + Settings.get('slideSeconds') + ' seconds' + (opts && opts.shuffle ? ', shuffled' : '') +
                 '. OK pauses'
               : 'Slideshow paused');
    }
    if (videoItem) { drawVideoHint(); }
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
  var stackItem = null, stackList = null, stackPos = 0, stackBusy = false, stackToken = 0;

  function initStack() {}

  function resetStack(it) {
    stackItem = it && it.stackId && it.stackCount > 1 ? it : null;
    stackList = null;
    stackPos = 0;
    stackBusy = false;
    stackToken++;
    drawStack();
  }

  function drawStack() {
    if (opts && opts.items[index]) { drawCaption(); }
    renderHint();
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
    status.textContent = m.isImage ? '' : 'A video in this stack, shown as a still';
    drawStack();
    loadPhoto(opts.urlFor(m));
    return true;
  }

  /* Down: the details panel. It hides the info bar while it's open, and pauses a
     slideshow or a playing video. */
  function openDetails() {
    var it = opts && opts.items[index];
    if (!it) { return; }
    setPlaying(false);
    if (videoItem && videoPlaying()) { video.pause(); }
    Details.open(it, !bar.classList.contains('hidden'));
  }

  /* The info bar, hints and arrows fade out after a few seconds of no keys, so the
     photo or video has the screen; any key or pointer movement brings them back.
     (Fading is an opacity change, which is cheap for the TV to draw.) */
  function wake() {
    U.removeClass(root, 'idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { U.addClass(root, 'idle'); }, IDLE_MS);
  }

  function key(k) {
    wake();
    if (zoomScale > 1 && zoomKey(k)) { return true; }
    var n = Details.digit(k);
    if (n !== -1) { if (opts && opts.items[index]) { Details.rate(opts.items[index], n); } return true; }
    // The open panel takes every key but Stop, so nothing changes under it.
    if (Details.isOpen() && k !== KEY.STOP) { Details.key(k); return true; }
    if (videoItem && videoKey(k)) { return true; }
    switch (k) {
      case KEY.LEFT: case KEY.RW: prev(); return true;
      case KEY.RIGHT: case KEY.FF: next(); return true;
      case KEY.OK: setPlaying(!playing); return true;
      case KEY.PLAY: setPlaying(true); return true;
      case KEY.PAUSE: setPlaying(false); return true;
      case KEY.UP: toggleFavorite(); return true;
      case KEY.DOWN: openDetails(); return true;
      case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE: case KEY.STOP: close(); return true;
      case KEY.CH_UP: return stepStack(1);
      case KEY.CH_DOWN: return stepStack(-1);
    }
    return false;
  }

  // ---------- zoom ----------

  /* The Magic Remote's wheel zooms a photo in steps, toward the pointer, so the spot
     under it stays put. Dragging or the arrows move around; Back or OK go back to fit.
     The preview (about 1440 pixels) goes soft when enlarged, so the first zoom fetches
     the full-size image and shows the enlarged preview until it's in. Moving on drops
     it: a 12-megapixel photo takes about 48 MB once decoded. Videos don't zoom (the TV
     draws them on a plane of its own).

     How it's drawn: each step gives the <img> its zoomed width and height, so the engine
     draws the photo sharp at that size, once per step, and a translate3d transform places
     it. The transform puts the photo on a layer of its own that the GPU moves, so a drag
     or an arrow press only moves that layer: no relayout, no redraw. Zooming with a
     scale() transform instead risks the old engine enlarging the layer it drew at fit
     (soft), and moving with left/top would redraw the whole screen on every step. */
  var ZOOM_STEPS = [1, 1.5, 2, 3, 4];
  var ZOOM_LEAST = 2;           // the deepest zoom is the photo's own size, but at least this
  var FULL_MAX_PIXELS = 25e6;   // bigger originals stay on the preview (4 bytes a pixel decoded)
  var WHEEL_MS = 150;           // at most one step this often: each one redraws the photo
  var zoomScale = 1;            // 1 is fit
  var zoomTop = 4, zx = 0, zy = 0, fw = 0, fh = 0, fitBox = null, zoomToken = 0, zoomHinted = false;
  var full = null;              // {url, preview, state: 'asking' | 'loading' | 'shown' | 'preview', loader}
  var zdrag = null, zpointing = false, zmoving = false, wheelTimer = null, wheelNext = null, zoomBadge;

  function initZoom() {
    zoomBadge = document.createElement('div');
    zoomBadge.id = 'viewer-zoom';
    zoomBadge.className = 'hidden';
    root.appendChild(zoomBadge);
    root.addEventListener('mousewheel', onWheel, false);
    root.addEventListener('mousedown', function (e) {
      if (zoomScale === 1) { return; }
      zdrag = { x: e.clientX, y: e.clientY, moved: false };
      e.preventDefault(); // or the browser drags off a copy of the image
    }, false);
    root.addEventListener('mousemove', function (e) {
      var d = zdrag;
      zpointing = true;
      if (!d) { return; }
      if (!d.moved && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 4) { return; }
      d.moved = true;
      zx += e.clientX - d.x;
      zy += e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      queueMove();
    }, false);
    window.addEventListener('mouseup', function () { zdrag = null; }, false);
    // webOS hides the pointer when a key is pressed or it's left still.
    document.addEventListener('cursorStateChange', function (e) {
      if (e.detail && e.detail.visibility === false) { zpointing = false; }
    }, false);
  }

  /* The photo on screen: the timeline's, or the stack member CH moved to. */
  function shownItem() {
    return opts ? (stackList && stackList[stackPos]) || opts.items[index] : null;
  }

  /* A photo that has loaded (not a video, not one that failed), with the details panel shut. */
  function zoomable() {
    var it = shownItem(), src = img.getAttribute('src');
    return !!(it && it.isImage && !videoItem && !Details.isOpen() && src &&
      (src === opts.urlFor(it) || (full && src === full.url)));
  }

  /* One step per wheel notch, at most one every WHEEL_MS; a notch turned meanwhile waits
     its turn (only the last one: a fast spin shouldn't run away). */
  function onWheel(e) {
    var r, dir = e.wheelDelta > 0 ? 1 : (e.wheelDelta < 0 ? -1 : 0);
    if (!dir || !zoomable()) { return; }
    e.preventDefault();
    wake();
    r = root.getBoundingClientRect();
    wheelNext = { dir: dir, x: e.clientX - r.left, y: e.clientY - r.top };
    if (!wheelTimer) { wheelTick(); }
  }

  function wheelTick() {
    var w = wheelNext;
    wheelNext = null;
    wheelTimer = null;
    if (!w) { return; }
    zoomStep(w.dir, w.x, w.y);
    wheelTimer = setTimeout(wheelTick, WHEEL_MS);
  }

  /* Fit, the steps and the deepest zoom. A step just short of the deepest is left out,
     so the last one isn't a nudge. */
  function zoomSteps() {
    var out = [], i;
    for (i = 0; i < ZOOM_STEPS.length && ZOOM_STEPS[i] < zoomTop * 0.87; i++) { out.push(ZOOM_STEPS[i]); }
    out.push(zoomTop);
    return out;
  }

  function zoomStep(dir, px, py) {
    var steps = zoomSteps(), s = zoomScale, to = s, i;
    if (dir > 0) {
      for (i = 0; i < steps.length; i++) { if (steps[i] > s + 0.01) { to = steps[i]; break; } }
    } else {
      for (i = steps.length - 1; i >= 0; i--) { if (steps[i] < s - 0.01) { to = steps[i]; break; } }
    }
    if (to !== s) { zoomTo(to, px, py); }
  }

  /* s: the new scale (1 is fit). px, py: the screen point that stays put. */
  function zoomTo(s, px, py) {
    var s0 = zoomScale;
    if (s <= 1) { return unzoom(); }
    if (s0 === 1) { startZoom(); }
    zx = px - (px - zx) * s / s0;
    zy = py - (py - zy) * s / s0;
    zoomScale = s;
    place();
    drawZoom();
  }

  /* Leaving fit: remember the fitted box, pause a slideshow, fetch the full-size image. */
  function startZoom() {
    var st = img.style;
    fitBox = { w: st.width, h: st.height, l: st.left, t: st.top };
    fw = img.offsetWidth;
    fh = img.offsetHeight;
    zx = img.offsetLeft;
    zy = img.offsetTop;
    if (playing) { setPlaying(false); }
    if (!full) { loadFull(shownItem()); }
  }

  /* The zoomed size, then where it sits. */
  function place() {
    var st = img.style;
    st.width = Math.round(fw * zoomScale) + 'px';
    st.height = Math.round(fh * zoomScale) + 'px';
    st.left = st.top = '0';
    move();
  }

  /* Keeps the photo over the screen: centred on a side it doesn't fill, and with no gap
     at an edge on a side it does. */
  function move() {
    var W = root.clientWidth, H = root.clientHeight, w = Math.round(fw * zoomScale), h = Math.round(fh * zoomScale);
    var st = img.style, t;
    zx = w <= W ? (W - w) / 2 : Math.max(W - w, Math.min(0, zx));
    zy = h <= H ? (H - h) / 2 : Math.max(H - h, Math.min(0, zy));
    t = 'translate3d(' + Math.round(zx) + 'px, ' + Math.round(zy) + 'px, 0)';
    st.webkitTransform = t;
    st.transform = t;
  }

  /* Pointer moves come faster than an old TV draws: one move per frame. */
  function queueMove() {
    var run = function () { zmoving = false; if (zoomScale > 1) { move(); } };
    if (zmoving) { return; }
    zmoving = true;
    if (window.requestAnimationFrame) { window.requestAnimationFrame(run); } else { setTimeout(run, 16); }
  }

  function unzoom() {
    var st = img.style;
    if (zoomScale === 1) { return; }
    zoomScale = 1;
    zdrag = null;
    st.webkitTransform = '';
    st.transform = '';
    st.width = fitBox.w;
    st.height = fitBox.h;
    st.left = fitBox.l;
    st.top = fitBox.t;
    drawZoom();
  }

  /* Another photo, or closing: back to fit, and let go of the full-size image so its
     memory can be freed (the preview, still cached, stands in until the next photo). */
  function resetZoom() {
    zoomToken++;
    wheelNext = null;
    unzoom();
    if (full) {
      dropLoader();
      if (full.state === 'shown') { img.src = full.preview; }
      full = null;
    }
    zoomTop = ZOOM_STEPS[ZOOM_STEPS.length - 1];
  }

  /* The full-size image is immich's 'fullsize': for a JPEG, PNG, WebP or GIF that's the
     original file itself. The photo's details come first, to leave alone two that would
     go wrong (they stay on the preview, as does one that fails to load):
     - an original stored turned, with an EXIF note saying so: this engine ignores the
       note (newer ones obey it), so it would show sideways or upside down;
     - a huge one, which could run the TV out of memory. */
  function loadFull(it) {
    var c = opts.client, t = zoomToken, url = c && c.thumbUrl && it ? c.thumbUrl(it.id, 'fullsize') : null;
    full = { url: url, preview: img.getAttribute('src'), state: 'asking', loader: null };
    if (!url || !c.asset) { return keepPreview(); }
    c.asset(it.id, function (err, a) {
      var ex = (a && a.exifInfo) || {}, w = ex.exifImageWidth || (a && a.width), h = ex.exifImageHeight || (a && a.height), pre;
      if (t !== zoomToken) { return; } // moved on meanwhile
      if (err || !a || w * h > FULL_MAX_PIXELS || (turned(a) && !engineTurns())) { return keepPreview(); }
      if (w && h) { setTop(w, h); }
      full.state = 'loading';
      drawZoom();
      pre = full.loader = new Image();
      pre.onload = function () {
        var pw = pre.naturalWidth, ph = pre.naturalHeight;
        if (t !== zoomToken) { return; }
        // Not the preview's shape: turned after all.
        if (!pw || !ph || Math.abs(pw / ph - img.naturalWidth / img.naturalHeight) > 0.03 * pw / ph) { return keepPreview(); }
        img.src = url; // cached now, and drawn into the same box, so it only gets sharper
        full.state = 'shown';
        full.loader = null;
        setTop(pw, ph);
        drawZoom();
      };
      pre.onerror = function () { if (t === zoomToken) { keepPreview(); } };
      pre.src = url;
    });
  }

  /* An original immich sends as it is, stored turned or mirrored (EXIF orientation). */
  function turned(a) {
    var o = String((a.exifInfo && a.exifInfo.orientation) || 1);
    return o !== '1' && !a.isEdited && /\.(avif|gif|jpe?g|png|webp)$/i.test(a.originalPath || a.originalFileName || '');
  }

  /* Whether this engine turns photos by their EXIF note itself (Chrome 81 on, not the TV's). */
  function engineTurns() {
    var cs = window.getComputedStyle && window.getComputedStyle(img);
    return !!cs && cs.imageOrientation === 'from-image';
  }

  function keepPreview() {
    dropLoader();
    full.state = 'preview';
    setTop(img.naturalWidth, img.naturalHeight);
    drawZoom();
  }

  function dropLoader() {
    var pre = full.loader;
    if (!pre) { return; }
    full.loader = null;
    pre.onload = pre.onerror = null;
    pre.src = Grid.BLANK; // stops the download
  }

  /* The deepest zoom: one image pixel to one screen pixel, but at least ZOOM_LEAST (a
     small photo still enlarges) and at most the last step. Zoomed past it already (before
     the size was known), the photo stays as it is: no jump. */
  function setTop(w, h) {
    var own = Math.max(w, h) / (Math.max(fw, fh) * (window.devicePixelRatio || 1));
    own = Math.max(ZOOM_LEAST, Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], own || 0));
    zoomTop = Math.floor(own * 10 + 0.001) / 10; // a tenth, rounded down: never past the photo's own size
  }

  /* Keys while zoomed: the arrows move a quarter screen, OK and Back go back to fit, Play
     goes back to fit and starts the slideshow. A remote click can also send OK, so OK
     while the pointer is in use is taken as that click, which does nothing here. */
  function zoomKey(k) {
    var W = root.clientWidth / 4, H = root.clientHeight / 4;
    switch (k) {
      case KEY.LEFT: return pan(W, 0);
      case KEY.RIGHT: return pan(-W, 0);
      case KEY.UP: return pan(0, H);
      case KEY.DOWN: return pan(0, -H);
      case KEY.OK: if (!zpointing) { unzoom(); } return true;
      case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE: unzoom(); return true;
      case KEY.PLAY: unzoom(); return false;
    }
    return false;
  }

  function pan(dx, dy) {
    zpointing = false;
    zx += dx;
    zy += dy;
    move();
    return true;
  }

  /* The zoom level, top right, and while zoomed the key hints say how to move and get out. */
  function drawZoom() {
    var on = zoomScale > 1;
    U.toggleClass(root, 'zoomed', on);
    U.toggleClass(zoomBadge, 'hidden', !on);
    if (on) {
      zoomBadge.textContent = (Math.round(zoomScale * 10) / 10) + '×' +
        (full && full.state === 'loading' ? '   ·   Loading full size' : '');
    }
    if (on !== zoomHinted) { zoomHinted = on; renderHint(); }
  }

  function zoomHints() {
    var list = [['Scroll', 'Zoom'], ['◀ ▲ ▼ ▶', 'Move'], ['Back', 'Fit']];
    if (stackItem) { list.push(['CH', 'Stack']); }
    return list;
  }

  // ---------- video ----------

  /* A video plays in a <video> laid over the still. The still (the preview image)
     stays underneath as the poster until playback starts, and is what's left if the
     TV can't play the file. Nothing is fetched until the video is played, so stepping
     past videos stays cheap. opts.videoUrlFor(item) gives the video's address.
     The elements are made here, not in index.html, to keep the video code together. */
  var video, vinfo, vtime, vfill, videoItem = null;

  function initVideo() {
    var line = document.createElement('div');
    video = document.createElement('video');
    video.id = 'viewer-video';
    video.className = 'hidden';
    video.preload = 'none';
    root.insertBefore(video, img.nextSibling); // above the still, below the bar and toasts

    vinfo = document.createElement('div');
    vinfo.id = 'viewer-vinfo';
    vinfo.className = 'hidden';
    vtime = document.createElement('span');
    vtime.id = 'viewer-vtime';
    vfill = document.createElement('div');
    vfill.id = 'viewer-vfill';
    line.id = 'viewer-vline';
    line.appendChild(vfill);
    vinfo.appendChild(vtime);
    vinfo.appendChild(line);
    bar.insertBefore(vinfo, bar.firstChild);

    video.addEventListener('loadedmetadata', function () { noteTurn(); }, false); // frame size known now
    video.addEventListener('playing', function () {
      if (videoItem) { U.show(video); status.textContent = ''; }
    }, false);
    video.addEventListener('waiting', function () {
      if (videoItem) { status.textContent = 'Loading video...'; }
    }, false);
    video.addEventListener('play', drawVideoHint, false);
    video.addEventListener('pause', drawVideoHint, false);
    video.addEventListener('ended', drawVideoHint, false);
    video.addEventListener('timeupdate', drawVideoTime, false);
    video.addEventListener('durationchange', drawVideoTime, false);
    video.addEventListener('error', videoFailed, false);
  }

  function showVideo(it) {
    videoItem = it;
    videoTurn = null;
    U.show(vinfo);
    drawVideoTime();
    drawVideoHint();
    findVideoTurn(it);
  }

  /* Phones record portrait video as landscape frames plus a rotation flag. The TV's
     video layer ignores the flag and also ignores CSS rotation (it draws video on its own
     hardware plane), so the app can't turn it: only a copy immich has re-encoded upright
     plays the right way up. When a video is affected, say so once, so it's not a mystery.
     immich reports the rotation as an EXIF orientation ('6', '8', '3' or degrees). */
  var videoTurn = null, turnNoted = null;

  function findVideoTurn(it) {
    var c = opts && opts.client;
    if (!c || !c.asset) { return; }
    c.asset(it.id, function (err, a) {
      var o = !err && a && a.exifInfo && String(a.exifInfo.orientation || '');
      if (videoItem !== it) { return; }
      videoTurn = /^(6|8|90|-90|270)$/.test(o);
      noteTurn();
    });
  }

  /* Only when the TV really decoded it sideways: a landscape frame for a portrait video. */
  function noteTurn() {
    if (!videoItem || !videoTurn || !video.videoWidth || video.videoWidth <= video.videoHeight) { return; }
    if (turnNoted === videoItem) { return; }
    turnNoted = videoItem;
    toast('Filmed upright: this TV plays it sideways');
  }

  function playVideo() {
    var p;
    if (!videoItem) { return; }
    if (!opts.videoUrlFor) { return cantPlay(); }
    Music.release(); // old TVs have few decoders
    if (!video.getAttribute('src')) {
      video.src = opts.videoUrlFor(videoItem);
      status.textContent = 'Loading video...';
    }
    p = video.play();
    // Newer engines return a promise that rejects when loading fails; the error event handles that.
    if (p && p.then) { p.then(null, function () {}); }
  }

  function videoPlaying() { return !!video.getAttribute('src') && !video.paused && !video.ended; }

  /* Removing the source and calling load() frees the decoder, and old TVs only have
     one, so a video is unloaded as soon as it's left. Returns whether one was current. */
  function stopVideo() {
    var was = !!videoItem;
    videoItem = null;
    videoTurn = null;
    unloadVideo();
    U.hide(video);
    U.hide(vinfo);
    return was;
  }

  function unloadVideo() {
    if (!video.getAttribute('src')) { return; }
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  /* Only an error from the current video counts: unloading one can report late. */
  function videoFailed() {
    if (!videoItem || !video.getAttribute('src') || !video.error) { return; }
    cantPlay();
  }

  /* Back to the still. OK tries again. */
  function cantPlay() {
    unloadVideo();
    U.hide(video);
    status.textContent = '';
    drawVideoTime();
    drawVideoHint();
    toast('This video can\'t play on this TV');
  }

  /* On a video, OK plays or pauses it instead of the slideshow. */
  function drawVideoHint() {
    if (!videoItem) { return; }
    okLabel = videoPlaying() ? 'Pause video' : 'Play video';
    renderHint();
  }

  /* Elapsed / total, and the progress line. Before the video loads, the length comes
     from the timeline. */
  function drawVideoTime() {
    var t = video.getAttribute('src') ? video.currentTime : 0, d = video.duration;
    if (!videoItem) { return; }
    if (!isFinite(d) || !d) { d = videoItem.duration / 1000 || 0; }
    vtime.textContent = U.fmtDuration(t) + ' / ' + (d ? U.fmtDuration(d) : '-:--');
    vfill.style.width = (d ? Math.min(100, t / d * 100) : 0) + '%';
  }

  /* While a video is showing, OK, Play and Pause work the video instead of the slideshow. */
  function videoKey(k) {
    switch (k) {
      case KEY.OK: if (videoPlaying()) { video.pause(); } else { playVideo(); } return true;
      case KEY.PLAY: playVideo(); return true;
      case KEY.PAUSE: video.pause(); return true;
    }
    return false;
  }

  return { init: init, open: open, close: close, key: key };
})();
