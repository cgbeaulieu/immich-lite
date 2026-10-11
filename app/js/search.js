/* Search page: a text box (Immich smart search), a Search button and recent searches. */
var Search = (function () {
  'use strict';

  var MAX_RECENT = 8;
  var box, input, rows = [], focus = 0, active = false, handlers = null;

  function recent() {
    try { return JSON.parse(Store.get('recentSearches', '[]')) || []; } catch (e) { return []; }
  }

  function remember(q) {
    var list = recent(), i = list.indexOf(q);
    if (i !== -1) { list.splice(i, 1); }
    list.unshift(q);
    Store.set('recentSearches', JSON.stringify(list.slice(0, MAX_RECENT)));
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text) { e.textContent = text; }
    return e;
  }

  /* h: {onSearch(query), onPointer()} */
  function open(h) {
    var list = recent(), i;
    handlers = h;
    box = U.$('search');
    box.innerHTML = '';
    rows = [];
    focus = 0;

    box.appendChild(el('div', 'search-hint',
      'Search by what is in the photo: "beach", "dog in the snow", "birthday cake". Press OK on the box to type.'));
    input = el('input', 'search-box');
    input.type = 'text';
    input.placeholder = 'Search photos';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    box.appendChild(input);
    rows.push({ el: input });

    addRow('row action', 'Search', function () { submit(input.value); });
    if (list.length) {
      box.appendChild(el('div', 'search-sub', 'Recent searches'));
      for (i = 0; i < list.length; i++) {
        (function (q) { addRow('row', q, function () { submit(q); }); })(list[i]);
      }
    }
    draw();
  }

  function addRow(cls, text, run) {
    var index = rows.length, row = el('div', cls, text);
    row.onmouseover = function () {
      if (handlers.onPointer) { handlers.onPointer(); }
      focus = index;
      draw();
    };
    row.onclick = function () { focus = index; run(); };
    box.appendChild(row);
    rows.push({ el: row, run: run });
  }

  function submit(q) {
    q = (q || '').trim();
    if (!q) { focus = 0; draw(); return; }
    remember(q);
    handlers.onSearch(q);
  }

  function draw() {
    var i;
    for (i = 1; i < rows.length; i++) { U.toggleClass(rows[i].el, 'focused', active && i === focus); }
    if (active && focus === 0) { input.focus(); } else if (document.activeElement === input) { input.blur(); }
  }

  function setActive(on) {
    active = on;
    if (box && input) { draw(); }
  }

  /* Returns true if the key was used. Anything else (typing) is left to the text box. */
  function key(k) {
    switch (k) {
      case KEY.UP:
        if (focus === 0) { return false; }
        focus--; draw(); return true;
      case KEY.DOWN: if (focus < rows.length - 1) { focus++; draw(); } return true;
      case KEY.OK:
        if (focus === 0) {
          // An empty box: let OK through so the TV opens its on-screen keyboard.
          if (!input.value.trim()) { return false; }
          submit(input.value);
          return true;
        }
        rows[focus].run();
        return true;
    }
    return false;
  }

  return { open: open, setActive: setActive, key: key };
})();
