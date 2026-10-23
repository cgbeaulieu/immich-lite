/* Background music for the slideshow: a few cheerful tracks that come with the app
   (app/music/, openly licensed; credited on the Slideshow page), played in a
   shuffled loop while a slideshow plays. Pausing fades out and keeps the place;
   playing again carries on. Settings 'slideMusic' turns it on.

   Old TVs have few media decoders, so the viewer calls release() before it plays a
   video: that unloads the track (remembering where it was) to free its decoder. */
var Music = (function () {
  'use strict';

  var TRACKS = [
    // { file: 'music/carefree.mp3', title: 'Carefree', artist: 'Kevin MacLeod' }
  ];
  var LICENSE = 'CC BY 4.0';
  var VOLUME = 0.6, FADE_MS = 1200, STEP_MS = 60;

  var audio = null, order = [], pos = 0, resumeAt = 0, fadeTimer = null, wanted = false, failures = 0;

  function available() { return TRACKS.length > 0; }

  /* "Carefree and Life of Riley by Kevin MacLeod (incompetech.com), CC BY 4.0" */
  function credits() {
    var by = {}, names = [], out = [], i, a;
    for (i = 0; i < TRACKS.length; i++) {
      a = TRACKS[i].artist;
      if (!by[a]) { by[a] = []; names.push(a); }
      by[a].push(TRACKS[i].title);
    }
    for (i = 0; i < names.length; i++) {
      out.push(by[names[i]].join(', ') + ' by ' + names[i]);
    }
    return out.join('; ') + ', ' + LICENSE;
  }

  function setup() {
    var i;
    if (audio) { return; }
    audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', function () { resumeAt = 0; step(1); }, false);
    audio.addEventListener('error', function () {
      if (!audio.getAttribute('src')) { return; } // the unload in release()
      // A track that won't play is skipped; if none will, stop trying.
      if (++failures >= TRACKS.length) { wanted = false; unload(); return; }
      resumeAt = 0;
      step(1);
    }, false);
    audio.addEventListener('playing', function () { failures = 0; }, false);
    // Seeking only works once the length is known.
    audio.addEventListener('loadedmetadata', function () {
      if (resumeAt) { try { audio.currentTime = resumeAt; } catch (e) {} resumeAt = 0; }
    }, false);
    for (i = 0; i < TRACKS.length; i++) { order.push(i); }
    order = U.shuffled(order);
  }

  function step(dir) {
    pos = (pos + dir + order.length) % order.length;
    load();
    if (wanted) { begin(); }
  }

  function load() {
    audio.src = TRACKS[order[pos]].file;
    audio.load();
  }

  function unload() {
    clearInterval(fadeTimer);
    if (!audio || !audio.getAttribute('src')) { return; }
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  function begin() {
    var p;
    p = audio.play();
    if (p && p.then) { p.then(null, function () {}); } // newer engines; errors come as events
    fade(VOLUME);
  }

  /* Volume steps on a timer; done() runs at the end. */
  function fade(to, done) {
    var from = audio.volume, steps = Math.max(1, Math.round(FADE_MS / STEP_MS)), n = 0;
    clearInterval(fadeTimer);
    fadeTimer = setInterval(function () {
      n++;
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * n / steps));
      if (n >= steps) { clearInterval(fadeTimer); if (done) { done(); } }
    }, STEP_MS);
  }

  /* The slideshow started or went on again. */
  function play() {
    if (!available() || Settings.get('slideMusic') !== 'on') { return; }
    setup();
    wanted = true;
    if (!audio.getAttribute('src')) { audio.volume = 0; load(); }
    begin();
  }

  /* Paused: fade out, keep the place. */
  function pause() {
    wanted = false;
    if (!audio || !audio.getAttribute('src') || audio.paused) { return; }
    fade(0, function () { if (!wanted) { audio.pause(); } });
  }

  /* Frees the decoder (a video is about to play, or the viewer closed). */
  function release() {
    wanted = false;
    if (!audio || !audio.getAttribute('src')) { return; }
    resumeAt = audio.currentTime || 0;
    unload();
  }

  return { available: available, credits: credits, play: play, pause: pause, release: release };
})();
