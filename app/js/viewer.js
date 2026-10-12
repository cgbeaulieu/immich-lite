/* Full-screen photo viewer and slideshow. */
var Viewer = (function () {
  'use strict';

  var root, img, bar, caption, hint, status, toastEl, progress;
  var okLabel = 'Slideshow';
  var opts = null, index = 0, playing = false, timer = null, toastTimer = null, preload = null;
  var photoToken = 0, arrows = {};

  function init() {
    root = U.$('viewer');
    img = U.$('viewer-img');
    bar = U.$('viewer-bar');
    caption = U.$('viewer-caption');
    hint = U.$('viewer-play');
    status = U.$('viewer-status');
    toastEl = U.$('viewer-toast');
    progress = U.$('viewer-progress-fill');
    root.onclick = function () { next(); }; // Magic Remote click
    initArrows();
    initStack();
    initVideo();
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
    if (videoItem && !o.autoplay) { playVideo(); } // a video picked in the grid starts playing
  }

  function close() {
    var i = index, done;
    Details.close(true);
    setPlaying(false, true);
    U.hide(toastEl);
    photoToken++;
    img.src = Grid.BLANK;
    stopVideo();
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

  /* Bottom-left: the date big, then favorite, stars, position and stack on one line. */
  function drawCaption() {
    var it = opts.items[index], date = document.createElement('div'), meta = document.createElement('div'), parts = [], st;
    date.className = 'v-date';
    date.textContent = U.fmtDateLong(it.date) || ' ';
    meta.className = 'v-meta';
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
    caption.appendChild(meta);
  }

  /* Bottom-right: what the keys do, as keycaps. */
  function renderHint() {
    var list = [['◀ ▶', 'Browse'], ['OK', okLabel], ['▲', 'Favorite'], ['▼', 'Details']], i, h, cap;
    if (stackItem) { list.push(['CH', 'Stack']); }
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

  function setPlaying(on, quiet) {
    var was = playing;
    playing = on;
    okLabel = on ? 'Pause' : 'Slideshow';
    renderHint();
    if (on) { U.hide(bar); }
    schedule();
    if (!quiet && on !== was) {
      toast(on ? 'Slideshow on, ' + Settings.get('slideSeconds') + ' seconds' + (opts && opts.shuffle ? ', shuffled' : '')
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

  function key(k) {
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

    video.addEventListener('loadedmetadata', function () { turnVideo(); }, false); // frame size known now
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

  /* Phones record portrait video as landscape frames plus a rotation flag, and the
     TV's engine ignores the flag, so the video plays sideways. immich reports the
     rotation as an EXIF orientation ('6' = turn 90 clockwise, '8' = 90 the other way,
     '3' = 180); the video is turned in CSS to match. */
  var videoTurn = null;

  function findVideoTurn(it) {
    var c = opts && opts.client;
    if (!c || !c.asset) { return; }
    c.asset(it.id, function (err, a) {
      var o = !err && a && a.exifInfo && String(a.exifInfo.orientation || '');
      if (videoItem !== it) { return; }
      videoTurn = o === '6' || o === '90' ? 90 : (o === '8' || o === '-90' || o === '270' ? -90 : (o === '3' || o === '180' ? 180 : 0));
      turnVideo();
    });
  }

  /* Only when the TV really decoded it sideways (a landscape frame for a turned video):
     videos immich has already re-encoded upright are left alone. */
  function turnVideo() {
    var st = video.style, W = root.clientWidth, H = root.clientHeight, deg = videoTurn || 0, sideways;
    sideways = video.videoWidth > video.videoHeight;
    if (!videoItem || !video.videoWidth || !(deg === 180 || (deg && sideways))) { return unturnVideo(); }
    if (deg === 180) {
      st.width = W + 'px'; st.height = H + 'px'; st.left = '0'; st.top = '0';
    } else { // a box the other way round, turned into place
      st.width = H + 'px'; st.height = W + 'px';
      st.left = Math.round((W - H) / 2) + 'px'; st.top = Math.round((H - W) / 2) + 'px';
    }
    st.webkitTransform = st.transform = 'rotate(' + deg + 'deg)';
  }

  function unturnVideo() {
    var st = video.style;
    st.width = st.height = st.left = st.top = '';
    st.webkitTransform = st.transform = '';
  }

  function playVideo() {
    var p;
    if (!videoItem) { return; }
    if (!opts.videoUrlFor) { return cantPlay(); }
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
    unturnVideo();
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
