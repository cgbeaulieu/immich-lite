/* Settings page and the preferences it stores. */
var Settings = (function () {
  'use strict';

  var OPTIONS = [
    { group: 'Slideshow', key: 'slideSeconds', label: 'Speed', values: ['3', '5', '8', '12', '20', '30', '60'], def: '8',
      text: function (v) { return v === '60' ? '1 minute' : v + ' seconds'; } },
    { group: 'Slideshow', key: 'slideOrder', label: 'Order', values: ['inorder', 'shuffle'], def: 'inorder',
      text: function (v) { return v === 'shuffle' ? 'Shuffle' : 'In order'; } },
    // Only offered when the app has music in it (music.js).
    { group: 'Slideshow', key: 'slideMusic', label: 'Music', values: ['off', 'on'], def: 'off',
      when: function () { return Music.available(); },
      text: function (v) { return v === 'on' ? 'On' : 'Off'; } },
    { group: 'Photos', key: 'groupBy', label: 'Group photos by', values: ['day', 'month', 'off'], def: 'day',
      text: function (v) { return v === 'day' ? 'Day' : (v === 'month' ? 'Month' : 'No grouping'); } },
    { group: 'Photos', key: 'tileSize', label: 'Thumbnail size', values: ['small', 'medium', 'large', 'xlarge'], def: 'medium',
      text: function (v) { return v === 'xlarge' ? 'Extra large' : v.charAt(0).toUpperCase() + v.substr(1); } },
    { group: 'Photos', key: 'showVideos', label: 'Videos in timeline and albums', values: ['show', 'hide'], def: 'show',
      text: function (v) { return v === 'show' ? 'Show' : 'Hide'; } },
    // Read when Photos or the map opens, so a change shows the next time they open.
    { group: 'Photos', key: 'withPartners', label: 'Partner photos in Photos and Map', values: ['on', 'off'], def: 'on',
      text: function (v) { return v === 'on' ? 'On' : 'Off'; } }
  ];

  var box, partnerSlot, rows = [], focus = 0, active = false, handlers = null;

  function option(key) {
    for (var i = 0; i < OPTIONS.length; i++) { if (OPTIONS[i].key === key) { return OPTIONS[i]; } }
    return null;
  }

  function get(key) {
    var o = option(key), v = Store.get(key, o.def);
    return o.values.indexOf(v) === -1 ? o.def : v;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text) { e.textContent = text; }
    return e;
  }

  /* h: {account(cb(lines, user)), stats(cb(lines)), partners(cb(note, list)), changeServer(),
         signOut(), onChange(key), onPointer()} */
  function open(h) {
    var i, group = null, profile;
    handlers = h;
    box = U.$('settings');
    box.innerHTML = '';
    box.scrollTop = 0;
    rows = [];
    focus = 0;

    profile = addProfile();
    h.account(function (lines, user) {
      var name = user && (user.name || user.email) || 'Your account';
      profile.avatar.textContent = name.charAt(0).toUpperCase();
      profile.who.textContent = name;
      profile.account = lines.slice(user && user.name ? 1 : 0);
      drawProfile(profile);
    });
    if (h.stats) {
      h.stats(function (lines) { profile.stats = lines; drawProfile(profile); });
    }

    for (i = 0; i < OPTIONS.length; i++) {
      if (OPTIONS[i].when && !OPTIONS[i].when()) { continue; }
      if (OPTIONS[i].group !== group) {
        group = OPTIONS[i].group;
        box.appendChild(el('div', 'set-section', group));
      }
      addRow(OPTIONS[i].label, OPTIONS[i]);
    }
    partnerSlot = el('div');
    box.appendChild(partnerSlot);
    if (h.partners) { addPartners(h.partners); }
    box.appendChild(el('div', 'set-section', 'Account'));
    addRow('Change server or sign-in', null, h.changeServer);
    addRow('Sign out', null, h.signOut, { cls: 'danger' });

    box.appendChild(el('div', 'about', 'Left and Right change a setting. Back goes to the menu.'));
    draw();
  }

  /* The card at the top: initial, name, then account and library lines. */
  function addProfile() {
    var p = { el: el('div', 'profile'), avatar: el('div', 'avatar', '?'), who: el('div', 'who', 'Loading your account...'),
      lines: el('div', 'lines'), account: [], stats: [] };
    var text = el('div', 'text');
    p.el.appendChild(p.avatar);
    text.appendChild(p.who);
    text.appendChild(p.lines);
    p.el.appendChild(text);
    box.appendChild(p.el);
    return p;
  }

  function drawProfile(p) { p.lines.textContent = p.account.concat(p.stats).join('\n'); }

  /* Partners load after the page opens, so their rows are slotted in between the
     options and the account actions; rows look their position up when used. */
  function addPartners(load) {
    load(function (note, list) {
      var at = rows.length - 2, i;    // before "Change server" and "Sign out"
      partnerSlot.innerHTML = '';
      partnerSlot.appendChild(el('div', 'set-section', 'Partners'));
      partnerSlot.appendChild(el('div', 'set-note', note));
      for (i = 0; i < list.length; i++) {
        addRow(list[i].label, null, null, { partner: list[i], at: at + i, parent: partnerSlot });
      }
      draw();
    });
  }

  /* extra (optional): {partner: {label, on, toggle(cb(err, on))}, at, parent, cls} */
  function addRow(label, opt, action, extra) {
    var row = el('div'), name = el('span', 'name', label), val;
    var entry = { el: row, opt: opt, action: action, partner: extra && extra.partner };
    row.className = 'row' + (opt || entry.partner ? '' : ' action') + (extra && extra.cls ? ' ' + extra.cls : '');
    row.appendChild(name);
    if (opt || entry.partner) {
      val = el('span', 'value');
      val.appendChild(el('span', 'arrow', '‹'));
      entry.text = el('span', 'text');
      val.appendChild(entry.text);
      val.appendChild(el('span', 'arrow', '›'));
      row.appendChild(val);
    }
    row.onmouseover = function () {
      if (handlers.onPointer) { handlers.onPointer(); }
      focus = rows.indexOf(entry);
      draw();
    };
    row.onclick = function () { focus = rows.indexOf(entry); activate(); };
    (extra && extra.parent ? extra.parent : box).appendChild(row);
    if (extra && extra.at !== undefined) {
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
      if (r.opt) { r.text.textContent = r.opt.text(get(r.opt.key)); }
      if (r.partner) {
        r.text.textContent = r.partner.busy ? 'Saving...' :
          (r.partner.error ? 'Error: ' + r.partner.error : (r.partner.on ? 'Shown' : 'Hidden'));
      }
    }
    // Keep the focused row on screen, with its section title when it's near the top.
    r = rows[focus];
    if (active && r) {
      // On the last row, show everything below it too (the hint line).
      if (focus === rows.length - 1) { box.scrollTop = box.scrollHeight; }
      else if (r.el.offsetTop - 90 < box.scrollTop) { box.scrollTop = focus === 0 ? 0 : r.el.offsetTop - 90; }
      else if (r.el.offsetTop + r.el.offsetHeight + 40 > box.scrollTop + box.clientHeight) {
        box.scrollTop = r.el.offsetTop + r.el.offsetHeight + 40 - box.clientHeight;
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

  /* Pick a value directly (the Slideshow page's speed and order pills). */
  function set(key, value) {
    var o = option(key);
    if (o && o.values.indexOf(value) !== -1) { Store.set(key, value); }
  }

  return {
    get: get,
    set: set,
    slideMs: function () { return parseInt(get('slideSeconds'), 10) * 1000; },
    open: open,
    setActive: setActive,
    key: key
  };
})();
