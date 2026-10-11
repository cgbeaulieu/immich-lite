/* Shared helpers. ES5 only: this runs on the webOS 3.x engine (old Chromium),
   so no let/const, arrow functions, template literals or fetch. */
var KEY = {
  LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13,
  BACK: 461,          // webOS remote Back (needs disableBackHistoryAPI in appinfo.json)
  ESC: 27, BACKSPACE: 8,
  CH_UP: 33, CH_DOWN: 34,
  PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412,
  RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406
};

var U = {
  $: function (id) { return document.getElementById(id); },

  addClass: function (el, c) { if (el) { el.classList.add(c); } },
  removeClass: function (el, c) { if (el) { el.classList.remove(c); } },
  toggleClass: function (el, c, on) { if (el) { if (on) { el.classList.add(c); } else { el.classList.remove(c); } } },

  show: function (el) { U.removeClass(el, 'hidden'); },
  hide: function (el) { U.addClass(el, 'hidden'); },

  MONTHS: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],

  /* Immich dates are ISO strings ("2024-05-03T12:00:00.000Z"). Slice them by
     hand: Date parsing and toLocaleDateString are unreliable on old engines. */
  fmtMonth: function (iso) {
    if (!iso || iso.length < 7) { return ''; }
    return U.MONTHS[parseInt(iso.substr(5, 2), 10) - 1] + ' ' + iso.substr(0, 4);
  },
  fmtDate: function (iso) {
    if (!iso || iso.length < 10) { return ''; }
    return U.MONTHS[parseInt(iso.substr(5, 2), 10) - 1] + ' ' +
      parseInt(iso.substr(8, 2), 10) + ', ' + iso.substr(0, 4);
  }
};

/* localStorage can throw (private mode, quota), so every access is guarded. */
var Store = {
  get: function (k, def) {
    try {
      var v = localStorage.getItem('immichlite.' + k);
      return v === null ? def : v;
    } catch (e) { return def; }
  },
  set: function (k, v) {
    try { localStorage.setItem('immichlite.' + k, v); } catch (e) { /* ignore */ }
  }
};
