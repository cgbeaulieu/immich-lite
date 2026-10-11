/* Settings page and the preferences it stores. */
var Settings = (function () {
  'use strict';

  var OPTIONS = [
    { key: 'slideSeconds', label: 'Slideshow speed', values: ['3', '5', '8', '12', '20'], def: '8',
      text: function (v) { return v + ' seconds'; } },
    { key: 'slideOrder', label: 'Slideshow order', values: ['inorder', 'shuffle'], def: 'inorder',
      text: function (v) { return v === 'shuffle' ? 'Shuffle' : 'In order'; } },
    { key: 'groupBy', label: 'Group photos by', values: ['day', 'month', 'off'], def: 'day',
      text: function (v) { return v === 'day' ? 'Day' : (v === 'month' ? 'Month' : 'No grouping'); } },
    { key: 'tileSize', label: 'Thumbnail size', values: ['small', 'medium', 'large', 'xlarge'], def: 'medium',
      text: function (v) { return v === 'xlarge' ? 'Extra large' : v.charAt(0).toUpperCase() + v.substr(1); } },
    { key: 'showVideos', label: 'Videos in timeline and albums', values: ['show', 'hide'], def: 'show',
      text: function (v) { return v === 'show' ? 'Show' : 'Hide'; } },
    // Read when Photos or the map opens, so a change shows the next time they open.
    { key: 'withPartners', label: 'Partner photos in Photos and Map', values: ['on', 'off'], def: 'on',
      text: function (v) { return v === 'on' ? 'On' : 'Off'; } }
  ];

  var box, info, partnerSlot, rows = [], focus = 0, active = false, handlers = null;

  function option(key) {
    for (var i = 0; i < OPTIONS.length; i++) { if (OPTIONS[i].key === key) { return OPTIONS[i]; } }
    return null;
  }

  function get(key) {
    var o = option(key), v = Store.get(key, o.def);
    return o.values.indexOf(v) === -1 ? o.def : v;
  }

  /* h: {account(cb(lines)), stats(cb(lines)), partners(cb(note, list)), changeServer(),
         signOut(), onChange(key), onPointer()} */
  function open(h) {
    var i, row;
    handlers = h;
    box = U.$('settings');
    box.innerHTML = '';
    rows = [];
    focus = 0;

    info = document.createElement('div');
    info.className = 'account';
    info.textContent = 'Loading account...';
    box.appendChild(info);
    h.account(function (lines) { info.textContent = lines.join('\n'); });
    if (h.stats) { addStats(h.stats); }

    for (i = 0; i < OPTIONS.length; i++) {
      addRow(OPTIONS[i].label, OPTIONS[i]);
    }
    partnerSlot = document.createElement('div');
    box.appendChild(partnerSlot);
    if (h.partners) { addPartners(h.partners); }
    addRow('Change server or API key', null, h.changeServer);
    addRow('Sign out', null, h.signOut);

    row = document.createElement('div');
    row.className = 'about';
    row.textContent = 'Left and right change a setting. Back returns to the tabs.';
    box.appendChild(row);

    draw();
  }

  /* Library statistics under the account lines. A hook of their own (stats(cb(lines)))
     because they need extra permissions and load separately; no lines hides them. */
  function addStats(load) {
    var el = document.createElement('div');
    el.className = 'account stats';
    el.textContent = 'Loading library statistics...';
    box.appendChild(el);
    load(function (lines) {
      el.textContent = lines.join('\n');
      U.toggleClass(el, 'hidden', !lines.length);
    });
  }

  /* Partners load after the page opens, so their rows are slotted in between the
     options and the account actions; rows look their position up when used. */
  function addPartners(load) {
    load(function (note, list) {
      var at = rows.length - 2, i, el;    // before "Change server" and "Sign out"
      partnerSlot.innerHTML = '';
      el = document.createElement('div');
      el.className = 'account partners';
      el.textContent = note;
      partnerSlot.appendChild(el);
      for (i = 0; i < list.length; i++) {
        addRow(list[i].label, null, null, { partner: list[i], at: at + i, parent: partnerSlot });
      }
      draw();
    });
  }

  /* extra (optional): {partner: {label, on, toggle(cb(err, on))}, at, parent} */
  function addRow(label, opt, action, extra) {
    var row = document.createElement('div');
    var name = document.createElement('span');
    var entry = { el: row, opt: opt, action: action, partner: extra && extra.partner };
    row.className = 'row' + (opt || entry.partner ? '' : ' action');
    name.className = 'name';
    name.textContent = label;
    row.appendChild(name);
    if (opt || entry.partner) {
      var val = document.createElement('span');
      val.className = 'value';
      row.appendChild(val);
    }
    row.onmouseover = function () {
      if (handlers.onPointer) { handlers.onPointer(); }
      focus = rows.indexOf(entry);
      draw();
    };
    row.onclick = function () { focus = rows.indexOf(entry); activate(); };
    (extra && extra.parent ? extra.parent : box).appendChild(row);
    if (extra) {
      if (extra.at <= focus) { focus++; } // keep the focused row focused
      rows.splice(extra.at, 0, entry);
    } else {
      rows.push(entry);
    }
  }

  function togglePartner(r) {
    var p = r.partner;
    if (p.busy) { return; }
    p.busy = true;
    p.error = '';
    draw();
    p.toggle(function (err) {
      p.busy = false;
      if (err) { p.error = err.status === 403 ? 'needs partner.update' : 'could not change'; }
      draw();
    });
  }

  function draw() {
    var i, r;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      U.toggleClass(r.el, 'focused', active && i === focus);
      if (r.opt) { r.el.lastChild.textContent = '‹  ' + r.opt.text(get(r.opt.key)) + '  ›'; }
      if (r.partner) {
        r.el.lastChild.textContent = r.partner.busy ? 'Saving...' :
          (r.partner.error ? 'Error: ' + r.partner.error : '‹  ' + (r.partner.on ? 'Shown' : 'Hidden') + '  ›');
      }
    }
    // Keep the focused row on screen (the list is taller than a 720p screen).
    r = rows[focus];
    if (active && r) {
      if (r.el.offsetTop - 24 < box.scrollTop) { box.scrollTop = focus === 0 ? 0 : r.el.offsetTop - 24; }
      else if (r.el.offsetTop + r.el.offsetHeight + 24 > box.scrollTop + box.clientHeight) {
        box.scrollTop = r.el.offsetTop + r.el.offsetHeight + 24 - box.clientHeight;
      }
    }
  }

  function step(dir) {
    var r = rows[focus], vals, i;
    if (r.partner) { return togglePartner(r); }
    if (!r.opt) { return; }
    vals = r.opt.values;
    i = (vals.indexOf(get(r.opt.key)) + dir + vals.length) % vals.length;
    Store.set(r.opt.key, vals[i]);
    draw();
    if (handlers.onChange) { handlers.onChange(r.opt.key); }
  }

  function activate() {
    var r = rows[focus];
    if (r.opt || r.partner) { step(1); } else { r.action(); }
  }

  function setActive(on) {
    active = on;
    if (box) { draw(); }
  }

  /* Returns true if the key was used. Up from the first row is left to the caller. */
  function key(k) {
    switch (k) {
      case KEY.UP:
        if (focus === 0) { return false; }
        focus--; draw(); return true;
      case KEY.DOWN: if (focus < rows.length - 1) { focus++; draw(); } return true;
      case KEY.LEFT: step(-1); return true;
      case KEY.RIGHT: step(1); return true;
      case KEY.OK: activate(); return true;
    }
    return false;
  }

  return {
    get: get,
    slideMs: function () { return parseInt(get('slideSeconds'), 10) * 1000; },
    open: open,
    setActive: setActive,
    key: key
  };
})();
