/* Slideshow page: a big photo from the focused source over a row of sources to play,
   with the speed and order choices under them. Made for leaving the TV running as a
   photo frame. Focus moves in two rows: sources, then options. */
var Slides = (function () {
  'use strict';

  var SPEEDS = ['5', '8', '12', '20', '30', '60'];
  var box, heroImgs, front = 0, title, sub, strip, rowEl, cards = [], opts = [];
  var row = 0, col = 0, ocol = 0, active = false, handlers = null, sources = [], heroTimer = null, token = 0;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text) { e.textContent = text; }
    return e;
  }

  /* h: {load(cb(sources)), onPointer()}
     source: {name, sub, icon, cover (thumbnail url or null), hero (big url or null),
              loadCover(cb(cover, hero)) optional, play()} */
  function open(h) {
    var hero, text, kicker, bottom;
    handlers = h;
    token++;
    box = U.$('slides');
    box.innerHTML = '';
    cards = [];
    opts = [];
    row = 0;
    col = 0;

    hero = el('div', 'sl-hero');
    heroImgs = [el('img'), el('img')];
    heroImgs[0].onload = heroImgs[1].onload = function () { U.addClass(this, 'in'); };
    hero.appendChild(heroImgs[0]);
    hero.appendChild(heroImgs[1]);
    hero.appendChild(el('div', 'sl-shade'));
    text = el('div', 'sl-text');
    kicker = el('div', 'sl-kicker');
    kicker.innerHTML = Icons.svg('slideshow');
    kicker.appendChild(document.createTextNode('SLIDESHOW'));
    title = el('div', 'sl-title', 'Slideshow');
    sub = el('div', 'sl-sub', 'Loading...');
    text.appendChild(kicker);
    text.appendChild(title);
    text.appendChild(sub);
    hero.appendChild(text);
    box.appendChild(hero);

    bottom = el('div', 'sl-bottom');
    bottom.appendChild(el('div', 'sl-label', 'Choose what to play'));
    rowEl = el('div', 'sl-row');
    strip = el('div', 'sl-strip');
    rowEl.appendChild(strip);
    bottom.appendChild(rowEl);
    bottom.appendChild(optionsRow());
    box.appendChild(bottom);

    var t = token;
    h.load(function (list) {
      if (t !== token) { return; }
      sources = list;
      addCards();
      draw();
    });
    draw();
  }

  function optionsRow() {
    var wrap = el('div', 'sl-options'), i;
    wrap.appendChild(el('span', 'opt-label', 'Speed'));
    for (i = 0; i < SPEEDS.length; i++) {
      addOpt(wrap, SPEEDS[i] === '60' ? '1 min' : SPEEDS[i] + 's', 'slideSeconds', SPEEDS[i]);
    }
    wrap.appendChild(el('span', 'gap'));
    wrap.appendChild(el('span', 'opt-label', 'Order'));
    addOpt(wrap, 'In order', 'slideOrder', 'inorder');
    addOpt(wrap, 'Shuffle', 'slideOrder', 'shuffle', 'shuffle');
    return wrap;
  }

  function addOpt(wrap, label, key, value, icon) {
    var p = el('span', 'pill'), index = opts.length;
    if (icon) { p.innerHTML = Icons.svg(icon); }
    p.appendChild(document.createTextNode(label));
    p.onmouseover = function () { pointer(); row = 1; ocol = index; draw(); };
    p.onclick = function () { row = 1; ocol = index; choose(); };
    wrap.appendChild(p);
    opts.push({ el: p, key: key, value: value });
  }

  function addCards() {
    var i;
    for (i = 0; i < sources.length; i++) {
      (function (s, i) {
        var c = el('div', 'sl-card'), img = el('img'), ic = el('div', 'sl-icon');
        img.src = s.cover || Grid.BLANK;
        c.appendChild(img);
        ic.innerHTML = Icons.svg(s.icon || 'photos');
        c.appendChild(ic);
        c.appendChild(el('div', 'sl-name', s.name));
        c.onmouseover = function () { pointer(); row = 0; col = i; draw(); };
        c.onclick = function () { row = 0; col = i; s.play(); };
        strip.appendChild(c);
        cards.push({ el: c, img: img });
        if (s.loadCover) {
          s.loadCover(function (cover, hero) {
            s.cover = cover;
            s.hero = hero;
            if (cover) { img.src = cover; }
            if (i === col) { showHero(); }
          });
        }
      })(sources[i], i);
    }
  }

  function pointer() { if (handlers && handlers.onPointer) { handlers.onPointer(); } }

  function draw() {
    var i;
    for (i = 0; i < cards.length; i++) { U.toggleClass(cards[i].el, 'focused', active && row === 0 && i === col); }
    for (i = 0; i < opts.length; i++) {
      U.toggleClass(opts[i].el, 'focused', active && row === 1 && i === ocol);
      U.toggleClass(opts[i].el, 'on', Settings.get(opts[i].key) === opts[i].value);
    }
    scrollTo(col);
    // The big photo follows the focused source, a moment after focus settles.
    clearTimeout(heroTimer);
    heroTimer = setTimeout(showHero, 250);
  }

  function scrollTo(i) {
    var c = cards[i] && cards[i].el, w = rowEl.clientWidth, shift = strip.shift || 0;
    if (!c) { return; }
    if (c.offsetLeft - shift < 0) { shift = c.offsetLeft; }
    else if (c.offsetLeft + c.offsetWidth - shift > w - 40) { shift = c.offsetLeft + c.offsetWidth - w + 60; }
    strip.shift = Math.max(0, shift);
    strip.style.webkitTransform = 'translateX(' + -strip.shift + 'px)';
    strip.style.transform = 'translateX(' + -strip.shift + 'px)';
  }

  function showHero() {
    var s = sources[col], next;
    if (!s) { return; }
    title.textContent = s.name;
    sub.textContent = (s.sub ? s.sub + '   ·   ' : '') +
      (Settings.get('slideOrder') === 'shuffle' ? 'Shuffle' : 'In order') + '   ·   ' +
      (Settings.get('slideSeconds') === '60' ? '1 minute' : Settings.get('slideSeconds') + ' seconds') + ' each';
    if (!s.hero || heroImgs[front].getAttribute('src') === s.hero) { return; }
    // Crossfade: load into the hidden image, then swap.
    next = 1 - front;
    U.removeClass(heroImgs[next], 'in');
    heroImgs[next].src = s.hero;
    U.removeClass(heroImgs[front], 'in');
    front = next;
  }

  function choose() {
    var o = opts[ocol];
    Settings.set(o.key, o.value);
    draw();
  }

  function setActive(on) {
    active = on;
    if (box && strip) { draw(); }
  }

  /* Returns true if the key was used; Left at the start of a row goes to the menu. */
  function key(k) {
    switch (k) {
      case KEY.LEFT:
        if (row === 0) { if (col === 0) { return false; } col--; } else { if (ocol === 0) { return false; } ocol--; }
        draw(); return true;
      case KEY.RIGHT:
        if (row === 0) { col = Math.min(cards.length - 1, col + 1); } else { ocol = Math.min(opts.length - 1, ocol + 1); }
        draw(); return true;
      case KEY.DOWN: if (row === 0) { row = 1; draw(); } return true;
      case KEY.UP: if (row === 1) { row = 0; draw(); return true; } return false;
      case KEY.OK:
        if (row === 1) { choose(); return true; }
        if (sources[col]) { sources[col].play(); }
        return true;
    }
    return false;
  }

  function close() { token++; clearTimeout(heroTimer); }

  return { open: open, close: close, setActive: setActive, key: key };
})();
