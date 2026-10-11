/* Settings page and the preferences it stores. */
var Settings = (function () {
  'use strict';

  var OPTIONS = [
    { key: 'slideSeconds', label: 'Slideshow speed', values: ['3', '5', '8', '12', '20'], def: '8',
      text: function (v) { return v + ' seconds'; } },
    { key: 'slideOrder', label: 'Slideshow order', values: ['inorder', 'shuffle'], def: 'inorder',
      text: function (v) { return v === 'shuffle' ? 'Shuffle' : 'In order'; } },
    { key: 'tileSize', label: 'Thumbnail size', values: ['small', 'medium', 'large'], def: 'medium',
      text: function (v) { return v.charAt(0).toUpperCase() + v.substr(1); } },
    { key: 'showVideos', label: 'Videos in timeline and albums', values: ['show', 'hide'], def: 'show',
      text: function (v) { return v === 'show' ? 'Show' : 'Hide (they can\'t play yet)'; } }
  ];

  var box, info, rows = [], focus = 0, active = false, handlers = null;

  function option(key) {
    for (var i = 0; i < OPTIONS.length; i++) { if (OPTIONS[i].key === key) { return OPTIONS[i]; } }
    return null;
  }

  function get(key) {
    var o = option(key), v = Store.get(key, o.def);
    return o.values.indexOf(v) === -1 ? o.def : v;
  }

  /* h: {account(cb(lines)), changeServer(), signOut(), onChange(key), onPointer()} */
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

    for (i = 0; i < OPTIONS.length; i++) {
      addRow(OPTIONS[i].label, OPTIONS[i]);
    }
    addRow('Change server or API key', null, h.changeServer);
    addRow('Sign out', null, h.signOut);

    row = document.createElement('div');
    row.className = 'about';
    row.textContent = 'Left and right change a setting. Back returns to the tabs.';
    box.appendChild(row);

    draw();
  }

  function addRow(label, opt, action) {
    var index = rows.length;
    var row = document.createElement('div');
    var name = document.createElement('span');
    row.className = 'row' + (opt ? '' : ' action');
    name.className = 'name';
    name.textContent = label;
    row.appendChild(name);
    if (opt) {
      var val = document.createElement('span');
      val.className = 'value';
      row.appendChild(val);
    }
    row.onmouseover = function () {
      if (handlers.onPointer) { handlers.onPointer(); }
      focus = index;
      draw();
    };
    row.onclick = function () { focus = index; activate(); };
    box.appendChild(row);
    rows.push({ el: row, opt: opt, action: action });
  }

  function draw() {
    var i, r;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      U.toggleClass(r.el, 'focused', active && i === focus);
      if (r.opt) { r.el.lastChild.textContent = '‹  ' + r.opt.text(get(r.opt.key)) + '  ›'; }
    }
  }

  function step(dir) {
    var r = rows[focus], vals, i;
    if (!r.opt) { return; }
    vals = r.opt.values;
    i = (vals.indexOf(get(r.opt.key)) + dir + vals.length) % vals.length;
    Store.set(r.opt.key, vals[i]);
    draw();
    if (handlers.onChange) { handlers.onChange(r.opt.key); }
  }

  function activate() {
    var r = rows[focus];
    if (r.opt) { step(1); } else { r.action(); }
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
