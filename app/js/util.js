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
  MONTHS_LONG: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'],
  WEEKDAYS: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

  pad2: function (n) { return n < 10 ? '0' + n : String(n); },

  /* The local calendar day ("2024-05-03") a photo was taken: Immich gives the UTC
     time plus the offset of the place it was taken. */
  localDay: function (iso, offsetHours) {
    var t = iso ? Date.parse(iso) : NaN, d;
    if (isNaN(t)) { return iso ? String(iso).substr(0, 10) : ''; }
    d = new Date(t + (offsetHours || 0) * 3600000);
    return d.getUTCFullYear() + '-' + U.pad2(d.getUTCMonth() + 1) + '-' + U.pad2(d.getUTCDate());
  },

  /* "2026-09-28" -> "Mon, Sep 28, 2026" */
  fmtDayHeader: function (day) {
    var d;
    if (!day || day.length < 10) { return ''; }
    d = new Date(Date.UTC(parseInt(day.substr(0, 4), 10), parseInt(day.substr(5, 2), 10) - 1, parseInt(day.substr(8, 2), 10)));
    return U.WEEKDAYS[d.getUTCDay()] + ', ' + U.MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  },

  /* "2026-09" -> "September 2026" */
  fmtMonthLong: function (month) {
    if (!month || month.length < 7) { return ''; }
    return U.MONTHS_LONG[parseInt(month.substr(5, 2), 10) - 1] + ' ' + month.substr(0, 4);
  },

  /* A shuffled copy (Fisher-Yates). */
  shuffled: function (list) {
    var a = list.slice(), i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  },

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

/* "12345" -> "12,345". By hand: toLocaleString is unreliable on the old engine. */
U.fmtCount = function (n) {
  var s = String(Math.floor(Math.abs(n || 0))), out = '';
  while (s.length > 3) {
    out = ',' + s.substr(s.length - 3) + out;
    s = s.substr(0, s.length - 3);
  }
  return (n < 0 ? '-' : '') + s + out;
};

/* Bytes -> "52.1 GB" (1024-based, like Immich shows it). */
U.fmtBytes = function (n) {
  var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'], i = 0;
  n = n || 0;
  while (n >= 1024 && i < units.length - 1) { n = n / 1024; i++; }
  return (i === 0 || n >= 100 ? String(Math.round(n)) : n.toFixed(1)) + ' ' + units[i];
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
