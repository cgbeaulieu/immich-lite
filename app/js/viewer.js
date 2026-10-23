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
    root.onclick = function () { next(); }; // Magic Remote click
    root.onmousemove = function () { wake(); };
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
    wake();
    playing = !!o.autoplay; // so a slideshow that starts on a video skips it (or plays it through)
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

  /* dir is the way we're moving (1 or -1); a playing slideshow skips videos that way,
     unless videos play by themselves (then it plays them through). */
  function show(i, dir) {
    var items = opts.items, it, was;
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
    if (playing && !it.isImage && !autoplayOn()) { return show(i + dir, dir); }
    index = i;
    resetStack(it);
    status.textContent = '';
    was = stopVideo();
    if (!it.isImage) { showVideo(it); }
    if (was) { setPlaying(playing, true); } // puts the photo hint and a slideshow's music back
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
    var list = [['◀ ▶', videoSeeks() ? 'Seek' : 'Browse'], ['OK', okLabel], ['▲', 'Favorite'], ['▼', 'Details']], i, h, cap;
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
    if (slideVideo()) { return runProgress(0); } // the video's end moves the slideshow on
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
     plays, the TV's screensaver is held off and the music (if on) plays, except
     while the slideshow plays a video, which has the sound. */
  function setPlaying(on, quiet) {
    var was = playing, it = opts && opts.items[index];
    playing = on;
    okLabel = on ? 'Pause' : 'Slideshow';
    renderHint();
    Awake.hold(on && !!opts);
    if (on && opts && !slideVideo()) { Music.play(); } else { Music.pause(); }
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
  var video, vinfo, vtime, vfill, videoItem = null, videoBroken = false;

  function initVideo() {
    var line = document.createElement('div'), hit = document.createElement('div');
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
    // The line is thin for the Magic Remote, so a taller see-through strip takes its clicks.
    hit.id = 'viewer-vhit';
    hit.appendChild(line);
    hit.onclick = function (e) { clickLine(e, line); };
    vinfo.appendChild(vtime);
    vinfo.appendChild(hit);
    bar.insertBefore(vinfo, bar.firstChild);

    // Frame size and length known now: a sideways note, a pending jump, and ◀ ▶ can seek.
    video.addEventListener('loadedmetadata', function () { noteTurn(); startFrom(); drawVideoHint(); }, false);
    video.addEventListener('playing', function () {
      if (videoItem) { U.show(video); status.textContent = ''; }
    }, false);
    video.addEventListener('waiting', function () {
      if (videoItem) { status.textContent = 'Loading video...'; }
    }, false);
    video.addEventListener('play', drawVideoHint, false);
    video.addEventListener('pause', drawVideoHint, false);
    video.addEventListener('ended', videoEnded, false);
    video.addEventListener('timeupdate', drawVideoTime, false);
    video.addEventListener('durationchange', drawVideoTime, false);
    video.addEventListener('error', videoFailed, false);
  }

  function showVideo(it) {
    videoItem = it;
    videoTurn = null;
    videoBroken = false;
    U.show(vinfo);
    drawVideoTime();
    drawVideoHint();
    findVideoTurn(it);
    // Started once the remote rests here a moment, so skipping past a few videos
    // doesn't load each one (old TVs have one decoder).
    if (autoplayOn()) {
      autoTimer = setTimeout(function () {
        if (videoItem === it && !Details.isOpen()) { playVideo(); }
      }, AUTOPLAY_MS);
    }
  }

  /* Settings 'Play videos': 'on' starts a video as soon as it shows, and a slideshow in
     order plays it through instead of skipping it. Only where the viewer has a video
     address (the Slideshow page's slideshows are photos only). */
  var AUTOPLAY_MS = 600, autoTimer = null;

  function autoplayOn() { return !!(opts && opts.videoUrlFor) && Settings.get('videoAutoplay') === 'on'; }

  /* A playing slideshow on a video it plays through: no slide timer and no music then,
     and the video's end moves it on. Not once the video has failed: that still stays
     the usual time, like a photo. */
  function slideVideo() { return playing && !!videoItem && !videoBroken && autoplayOn(); }

  function videoEnded() {
    drawVideoHint();
    if (slideVideo() && video.getAttribute('src')) { next(); }
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
    clearTimeout(autoTimer);
    if (!opts.videoUrlFor) { return cantPlay(); }
    videoBroken = false;
    if (playing) { schedule(); } // trying a failed one again: the slideshow waits for it now
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
    startAt = null;
    clearTimeout(autoTimer);
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

  /* Back to the still. OK tries again (in a slideshow, OK pauses it first). A slideshow
     shows the still for the usual time, with its music, and goes on. */
  function cantPlay() {
    unloadVideo();
    U.hide(video);
    status.textContent = '';
    videoBroken = true;
    drawVideoTime();
    drawVideoHint();
    if (playing) { setPlaying(true, true); }
    toast('This video can\'t play on this TV');
  }

  /* On a video, OK plays or pauses it instead of the slideshow, and while it plays
     ◀ ▶ seek (renderHint asks videoSeeks). */
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

  /* Seeking: ⏪ ⏩, and ◀ ▶ while the video plays, jump SEEK_S seconds; a click on the
     line jumps to that point. immich answers range requests, so a jump doesn't wait
     for the whole file. */
  var SEEK_S = 10, seekedAt = 0, startAt = null;

  function canSeek() {
    var d = video.duration;
    return !!video.getAttribute('src') && isFinite(d) && d > 0;
  }

  /* ◀ ▶ seek only while the video plays; paused, not started or ended, they browse. */
  function videoSeeks() { return !!videoItem && videoPlaying() && canSeek(); }

  function seekTo(t) {
    if (!canSeek()) { return; }
    video.currentTime = Math.max(0, Math.min(video.duration, t));
    seekedAt = new Date().getTime();
    if (!Details.isOpen()) { U.show(bar); } // where it is now, even in a slideshow
    wake();
    drawVideoTime();
  }

  /* A Magic Remote click on the line. Before the video has loaded it starts playing,
     from that point once its length is known (startFrom). */
  function clickLine(e, line) {
    var r = line.getBoundingClientRect(), f = r.width ? (e.clientX - r.left) / r.width : 0;
    if (e.stopPropagation) { e.stopPropagation(); } // not also the viewer's click (next photo)
    if (!videoItem) { return; }
    f = Math.max(0, Math.min(1, f));
    if (canSeek()) { return seekTo(f * video.duration); }
    startAt = f;
    playVideo();
  }

  function startFrom() {
    if (startAt === null || !canSeek()) { return; }
    video.currentTime = startAt * video.duration;
    startAt = null;
    drawVideoTime();
  }

  /* While a video is showing, OK, Play and Pause work the video instead of the slideshow.
     ⏪ ⏩ seek once it has been started (before that they browse, as on a photo). ◀ ▶
     seek while it plays and browse otherwise: many Magic Remotes have no ⏪ ⏩. */
  function videoKey(k) {
    var now = new Date().getTime(), step = k === KEY.RIGHT || k === KEY.FF ? SEEK_S : -SEEK_S;
    // In a slideshow, OK and Pause pause the slideshow and the video with it, so one
    // press stills the screen as on a photo (a video playing on under a paused
    // slideshow would be odd). OK then plays the video on its own.
    if (playing && (k === KEY.OK || k === KEY.PAUSE)) {
      clearTimeout(autoTimer);
      video.pause();
      setPlaying(false);
      return true;
    }
    switch (k) {
      case KEY.OK: if (videoPlaying()) { video.pause(); } else { playVideo(); } return true;
      case KEY.PLAY: playVideo(); return true;
      case KEY.PAUSE: video.pause(); return true;
      case KEY.RW: case KEY.FF:
        if (!video.getAttribute('src')) { return false; }
        seekTo(video.currentTime + step);
        return true;
      case KEY.LEFT: case KEY.RIGHT:
        if (videoSeeks()) { seekTo(video.currentTime + step); return true; }
        // A held ▶ that seeked to the end stops there, not at the next photo.
        if (k === KEY.RIGHT && video.ended && now - seekedAt < 600) { seekedAt = now; return true; }
        return false;
    }
    return false;
  }

  return { init: init, open: open, close: close, key: key };
})();
