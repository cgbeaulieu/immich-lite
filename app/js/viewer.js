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
    status.textContent = m.isImage ? '' : 'A video in this stack, shown as a still';
    drawStack();
    U.addClass(img, 'loading');
    img.src = opts.urlFor(m);
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
    U.show(vinfo);
    drawVideoTime();
    drawVideoHint();
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

  /* Only the OK part of the hint changes; the rest stays as setPlaying wrote it. */
  function drawVideoHint() {
    if (!videoItem) { return; }
    hint.textContent = hint.textContent.replace(/^OK: \S+( video)?/, videoPlaying() ? 'OK: pause video' : 'OK: play video');
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
