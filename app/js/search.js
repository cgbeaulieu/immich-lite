/* Search page: a search bar (immich smart search), recent searches and ideas as pills.
   Focus moves in rows: the bar, then each row of pills (Left/Right within a row). */
var Search = (function () {
  'use strict';

  var MAX_RECENT = 8;
  var IDEAS = ['Beach', 'Sunset', 'Snow', 'Dog', 'Birthday cake', 'Mountains', 'Swimming', 'Christmas tree', 'Food'];
  var box, bar, input, lines = [], row = 0, col = 0, active = false, handlers = null;

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
    var list = recent();
    handlers = h;
    box = U.$('search');
    box.innerHTML = '';
    lines = [];
    row = 0;
    col = 0;

    bar = el('div', 'search-bar');
    bar.innerHTML = Icons.svg('search');
    input = el('input');
    input.type = 'text';
    input.placeholder = 'Search your photos';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    bar.appendChild(input);
    box.appendChild(bar);
    box.appendChild(el('div', 'search-hint',
      'Describe what’s in the photo. Press OK on the bar to type, then OK again to search.'));
    lines.push([{ el: bar, input: true }]);

    if (list.length) { addPills('Recent searches', list, 'clock'); }
    addPills('Try searching for', IDEAS, 'search');
    draw();
  }

  function addPills(title, words, icon) {
    var line = [], wrap = el('div'), i;
    box.appendChild(el('div', 'search-sub', title));
    for (i = 0; i < words.length; i++) {
      (function (q, i) {
        var p = el('span', 'pill');
        p.innerHTML = Icons.svg(icon);
        p.appendChild(document.createTextNode(q));
        p.onmouseover = function () {
          if (handlers.onPointer) { handlers.onPointer(); }
          row = lines.indexOf(line);
          col = i;
          draw();
        };
        p.onclick = function () { submit(q); };
        wrap.appendChild(p);
        line.push({ el: p, query: q });
      })(words[i], i);
    }
    box.appendChild(wrap);
    lines.push(line);
  }

  function submit(q) {
    q = (q || '').trim();
    if (!q) { row = 0; col = 0; draw(); return; }
    remember(q);
    handlers.onSearch(q);
  }

  function draw() {
    var r, c;
    for (r = 0; r < lines.length; r++) {
      for (c = 0; c < lines[r].length; c++) {
        U.toggleClass(lines[r][c].el, 'focused', active && r === row && c === col);
      }
    }
    if (active && row === 0) { input.focus(); } else if (document.activeElement === input) { input.blur(); }
  }

  function setActive(on) {
    active = on;
    if (box && input) { draw(); }
  }

  /* Returns true if the key was used. Anything else (typing) is left to the text box. */
  function key(k) {
    var line = lines[row];
    switch (k) {
      case KEY.UP:
        if (row === 0) { return false; }
        row--; col = Math.min(col, lines[row].length - 1); draw(); return true;
      case KEY.DOWN:
        if (row < lines.length - 1) { row++; col = Math.min(col, lines[row].length - 1); draw(); }
        return true;
      case KEY.LEFT:
        if (row === 0 || col === 0) { return false; } // the bar's caret, or out to the menu
        col--; draw(); return true;
      case KEY.RIGHT:
        if (row > 0 && col < line.length - 1) { col++; draw(); }
        return true;
      case KEY.OK:
        if (row === 0) {
          // An empty bar: let OK through so the TV opens its on-screen keyboard.
          if (!input.value.trim()) { return false; }
          submit(input.value);
          return true;
        }
        submit(line[col].query);
        return true;
    }
    return false;
  }

  return { open: open, setActive: setActive, key: key };
})();
