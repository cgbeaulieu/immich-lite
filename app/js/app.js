/* Immich-Lite controller: setup screen, browse (timeline / albums / one album), viewer. */
(function () {
  'use strict';

  var TAB_TIMELINE = 0, TAB_ALBUMS = 1, TAB_SETTINGS = 2, TAB_PLAY = 3;
  var SHUFFLE_BATCH = 100;
  var SETUP_FIELDS = ['server', 'apikey', 'connect'];

  var client = null;
  var grid = null;
  var screen = 'setup';     // 'setup' | 'browse' | 'viewer'
  var zone = 'grid';        // in browse: 'tabs' | 'grid'
  var mode = 'timeline';    // 'timeline' | 'albums' | 'album' | 'settings'
  var tabFocus = TAB_TIMELINE;
  var source = null;        // TimelineSource for timeline/album modes
  var albumsRequest = 0;
  var albumReturn = 0;      // album grid index to go back to when leaving an album
  var currentAlbum = null;  // the open album in 'album' mode
  var autoplayNext = false; // start a slideshow as soon as the album's first photos load

  /* Loads a timeline (whole library or one album) a month at a time, newest first. */
  function TimelineSource(filter) {
    this.filter = filter;
    this.buckets = null;
    this.next = 0;
    this.busy = false;
    this.done = false;
  }

  TimelineSource.prototype.more = function (cb) {
    var self = this;
    if (self.busy || self.done) { return; }
    self.busy = true;
    if (!self.buckets) {
      client.buckets(self.filter, function (err, list) {
        self.busy = false;
        if (err) { return cb(err); }
        self.buckets = list || [];
        if (!self.buckets.length) { self.done = true; return cb(null, []); }
        self.more(cb);
      });
      return;
    }
    client.bucket(self.buckets[self.next].timeBucket, self.filter, function (err, items) {
      self.busy = false;
      if (err) { return cb(err); }
      self.next++;
      if (self.next >= self.buckets.length) { self.done = true; }
      cb(null, items);
    });
  };

  // ---------- rendering ----------

  function renderAsset(it) {
    return { thumb: client.thumbUrl(it.id, 'thumbnail'), badge: it.isImage ? '' : 'VIDEO' };
  }

  function renderAlbum(a) {
    return {
      thumb: a.albumThumbnailAssetId ? client.thumbUrl(a.albumThumbnailAssetId, 'thumbnail') : null,
      label: a.albumName || 'Untitled',
      sub: a.assetCount + (a.assetCount === 1 ? ' item' : ' items')
    };
  }

  function setStatus(text) { U.$('status').textContent = text || ''; }
  function setTitle(text) { U.$('title').textContent = text || ''; }

  function drawTabs() {
    var tabs = U.$('tabs').children, i;
    var current = mode === 'settings' ? TAB_SETTINGS : (mode === 'album' || mode === 'albums' ? TAB_ALBUMS : TAB_TIMELINE);
    if (tabFocus > lastTab()) { tabFocus = lastTab(); }
    for (i = 0; i < tabs.length; i++) {
      U.toggleClass(tabs[i], 'current', i === current);
      U.toggleClass(tabs[i], 'focused', zone === 'tabs' && i === tabFocus);
    }
    U.toggleClass(tabs[TAB_PLAY], 'hidden', lastTab() !== TAB_PLAY);
  }

  /* The Slideshow button only shows where there are photos to play. */
  function lastTab() {
    return mode === 'timeline' || mode === 'album' ? TAB_PLAY : TAB_SETTINGS;
  }

  function setZone(z) {
    zone = z;
    grid.setActive(z === 'grid' && mode !== 'settings');
    Settings.setActive(z === 'grid' && mode === 'settings');
    drawTabs();
  }

  /* The browse area shows either the thumbnail grid or the settings page. */
  function showPanel(name) {
    U.toggleClass(U.$('grid'), 'hidden', name !== 'grid');
    U.toggleClass(U.$('settings'), 'hidden', name !== 'settings');
  }

  function applyTileSize() {
    var g = U.$('grid'), size = Settings.get('tileSize');
    U.toggleClass(g, 'size-small', size === 'small');
    U.toggleClass(g, 'size-large', size === 'large');
  }

  // ---------- screens ----------

  function showScreen(name) {
    screen = name;
    U.toggleClass(U.$('setup'), 'hidden', name !== 'setup');
    U.toggleClass(U.$('browse'), 'hidden', name === 'setup');
  }

  function defaultServer() {
    // Served by tools/devserver.py, which proxies /api to Immich on the same origin.
    if (/^https?:$/.test(location.protocol)) { return location.protocol + '//' + location.host; }
    return '';
  }

  function showSetup() {
    var server = Store.get('server', '') || defaultServer();
    U.$('server').value = server;
    U.$('apikey').value = Store.get('apiKey', '');
    setupMsg(client ? 'Press Back to return to your photos.' : '');
    showScreen('setup');
    U.$(server && U.$('apikey').value ? 'connect' : 'server').focus();
  }

  function setupMsg(text, isError) {
    var m = U.$('setup-msg');
    m.textContent = text || '';
    U.toggleClass(m, 'error', !!isError);
  }

  /* Immich sends no CORS headers, so a page served over http can't call it at another
     address. The dev server forwards /api on its own address instead. */
  function corsHint(server) {
    var here = defaultServer();
    if (!here || server.replace(/\/+$/, '').toLowerCase() === here.toLowerCase()) { return ''; }
    return '. Immich blocks calls from other addresses, so use this page\'s address, ' + here +
      ', as the server. The dev server passes requests on to Immich.';
  }

  function connect() {
    var server = U.$('server').value.trim(), key = U.$('apikey').value.trim();
    var c;
    if (!/^https?:\/\//i.test(server)) { return setupMsg('The server address must start with http:// or https://', true); }
    if (!key) { return setupMsg('Enter an API key. Create one in Immich: Account Settings > API Keys.', true); }
    c = new Immich.Client(server, key);
    setupMsg('Connecting...');
    c.me(function (err, user) {
      if (err) { return setupMsg(err.status === 0 ? err.message + corsHint(server) : err.message, true); }
      Store.set('server', server);
      Store.set('apiKey', key);
      client = c;
      document.activeElement.blur();
      showScreen('browse');
      openTimeline();
      setStatus('');
      if (user && user.name) { setTitle('Hi, ' + user.name); }
    });
  }

  // ---------- browse modes ----------

  function openTimeline() {
    mode = 'timeline';
    autoplayNext = false;
    setTitle('');
    startSource({ visibility: 'timeline', order: 'desc' });
  }

  function openAlbum(album, fromIndex) {
    albumReturn = fromIndex;
    currentAlbum = album;
    mode = 'album';
    setTitle(album.albumName);
    startSource({ albumId: album.id, order: 'desc' });
  }

  function startSource(filter) {
    source = new TimelineSource(filter);
    showPanel('grid');
    grid.reset(renderAsset);
    U.$('when').textContent = '';
    setStatus('Loading...');
    drawTabs();
    loadMore();
  }

  /* cb(gotMore) is optional; the viewer uses it to step past the last loaded photo. */
  function loadMore(cb) {
    var src = source;
    if (mode === 'albums' || !src || src.busy || src.done) { if (cb) { cb(false); } return; }
    src.more(function (err, items) {
      var first;
      if (src !== source) { return; } // user switched views meanwhile
      if (err) { setStatus(err.message); if (cb) { cb(false); } return; }
      if (Settings.get('showVideos') === 'hide') {
        items = items.filter(function (it) { return it.isImage; });
      }
      first = grid.items.length === 0;
      grid.append(items);
      if (first && items.length) {
        setStatus('');
        setZone('grid');
        grid.setFocus(0);
        if (autoplayNext) { autoplayNext = false; openViewer(0, true); }
      }
      if (!items.length) {
        if (!src.done) { return loadMore(cb); } // empty month, keep going
        if (first) { setStatus(mode === 'album' ? 'This album is empty' : 'No photos yet'); }
      }
      if (cb) { cb(items.length > 0); }
    });
  }

  function openAlbums(restoreIndex) {
    var req = ++albumsRequest;
    mode = 'albums';
    autoplayNext = false;
    source = null;
    setTitle('');
    U.$('when').textContent = '';
    showPanel('grid');
    grid.reset(renderAlbum);
    setStatus('Loading albums...');
    drawTabs();
    client.albums(function (err, list) {
      if (mode !== 'albums' || req !== albumsRequest) { return; }
      if (err) { return setStatus(err.message); }
      list.sort(function (a, b) {
        var x = a.lastModifiedAssetTimestamp || a.updatedAt || '', y = b.lastModifiedAssetTimestamp || b.updatedAt || '';
        return x < y ? 1 : (x > y ? -1 : 0);
      });
      setStatus(list.length ? '' : 'No albums yet');
      grid.append(list);
      if (list.length) {
        setZone('grid');
        grid.setFocus(restoreIndex || 0);
      }
    });
  }

  function activateTab(i) {
    tabFocus = i;
    if (i === TAB_TIMELINE) { openTimeline(); }
    else if (i === TAB_ALBUMS) { openAlbums(0); }
    else if (i === TAB_SETTINGS) { openSettings(); }
    else { startSlideshow(); }
  }

  // ---------- slideshow ----------

  /* From the Slideshow button or the remote's Play key. In order, it plays from the
     focused photo; shuffled, it draws random photos from the library or album. On the
     album list, Play plays the focused album. */
  function startSlideshow() {
    var shuffle = Settings.get('slideOrder') === 'shuffle', album;
    if (mode === 'albums') {
      album = grid.items[grid.focus];
      if (!album) { return; }
      if (shuffle) { return startShuffle(album.id); }
      autoplayNext = true;
      return openAlbum(album, grid.focus);
    }
    if (mode !== 'timeline' && mode !== 'album') { return; }
    if (shuffle) { return startShuffle(mode === 'album' ? currentAlbum.id : null); }
    if (grid.items.length) { openViewer(grid.focus, true); }
  }

  function startShuffle(albumId) {
    var items = [], seen = {}, c = client;

    // Fetches another batch of random photos. A batch with nothing new means every
    // photo has been shown (small albums), so a fresh round starts.
    function more(cb) {
      c.randomPhotos(albumId, SHUFFLE_BATCH, function (err, list) {
        var added = 0, i;
        if (err) { setStatus(err.message); return cb(false); }
        for (i = 0; i < list.length; i++) {
          if (!seen[list[i].id]) { seen[list[i].id] = true; items.push(list[i]); added++; }
        }
        if (!added && list.length) {
          seen = {};
          for (i = 0; i < list.length; i++) { seen[list[i].id] = true; items.push(list[i]); }
          added = list.length;
        }
        cb(added > 0);
      });
    }

    setStatus('Shuffling...');
    more(function (got) {
      if (client !== c || screen !== 'browse') { return; }
      if (!got) { setStatus(albumId ? 'No photos in this album' : 'No photos to show'); return; }
      setStatus('');
      screen = 'viewer';
      Viewer.open({
        items: items,
        index: 0,
        autoplay: true,
        shuffle: true,
        urlFor: function (it) { return c.thumbUrl(it.id, 'preview'); },
        more: more,
        onClose: function () { screen = 'browse'; }
      });
    });
  }

  function openViewer(index, autoplay) {
    screen = 'viewer';
    Viewer.open({
      items: grid.items,
      index: index,
      autoplay: autoplay,
      urlFor: function (it) { return client.thumbUrl(it.id, 'preview'); },
      more: loadMore,
      onClose: function (i) {
        screen = 'browse';
        grid.setFocus(i);
      }
    });
  }

  function openSettings() {
    mode = 'settings';
    source = null;
    setTitle('');
    setStatus('');
    U.$('when').textContent = '';
    showPanel('settings');
    Settings.open({
      account: function (cb) {
        var c = client;
        // Answers can arrive after the user has left settings or signed out.
        function current() { return mode === 'settings' && client === c; }
        c.me(function (err, user) {
          if (!current()) { return; }
          if (err) { return cb(['Could not load your account: ' + err.message, 'Server: ' + c.server]); }
          c.version(function (err2, v) {
            if (!current()) { return; }
            cb([
              'Signed in as ' + (user.name || '') + (user.email ? ' (' + user.email + ')' : ''),
              'Server: ' + c.server + (err2 || !v ? '' : '   Immich v' + v.major + '.' + v.minor + '.' + v.patch)
            ]);
          });
        });
      },
      changeServer: showSetup,
      signOut: function () {
        Store.set('apiKey', '');
        client = null;
        grid.reset(renderAsset);
        mode = 'timeline';
        showSetup();
      },
      onChange: function (key) { if (key === 'tileSize') { applyTileSize(); } },
      onPointer: function () { if (zone !== 'grid') { setZone('grid'); } }
    });
    setZone('grid');
  }

  function select(item, index) {
    if (mode === 'albums') { return openAlbum(item, index); }
    openViewer(index, false);
  }

  // ---------- keys ----------

  function setupKey(k) {
    var active = document.activeElement, cur = active ? SETUP_FIELDS.indexOf(active.id) : -1;
    if (k === KEY.DOWN) { U.$(SETUP_FIELDS[Math.min(cur + 1, SETUP_FIELDS.length - 1)]).focus(); return true; }
    if (k === KEY.UP) { U.$(SETUP_FIELDS[Math.max(cur - 1, 0)]).focus(); return true; }
    if (k === KEY.OK && active && active.id === 'connect') { connect(); return true; }
    // Backspace is left alone here: it edits the text fields.
    if ((k === KEY.BACK || k === KEY.ESC) && client) { showScreen('browse'); setZone('tabs'); return true; }
    return false;
  }

  function browseKey(k) {
    var back = k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE;
    if (k === KEY.PLAY) { startSlideshow(); return true; }
    if (zone === 'tabs') {
      if (k === KEY.LEFT) { tabFocus = Math.max(0, tabFocus - 1); drawTabs(); return true; }
      if (k === KEY.RIGHT) { tabFocus = Math.min(lastTab(), tabFocus + 1); drawTabs(); return true; }
      if (k === KEY.DOWN) { if (mode === 'settings' || grid.items.length) { setZone('grid'); } return true; }
      if (k === KEY.OK) { activateTab(tabFocus); return true; }
      if (back && mode === 'album') { openAlbums(albumReturn); return true; }
      return false;
    }
    if (back) {
      if (mode === 'album') { openAlbums(albumReturn); } else { setZone('tabs'); }
      return true;
    }
    if (mode === 'settings' ? Settings.key(k) : grid.key(k)) { return true; }
    if (k === KEY.UP) { setZone('tabs'); return true; } // up from the top row
    return false;
  }

  function onKey(e) {
    var k = e.keyCode, used;
    if (screen === 'setup') { used = setupKey(k); }
    else if (screen === 'viewer') { used = Viewer.key(k); }
    else { used = browseKey(k); }
    if (used) { e.preventDefault(); }
  }

  // ---------- start ----------

  function start() {
    var tabs = U.$('tabs').children, server, key, i;
    Viewer.init();
    applyTileSize();
    grid = new Grid(U.$('grid'), {
      onSelect: select,
      onNeedMore: function () { loadMore(); },
      onPointer: function () { if (zone !== 'grid') { setZone('grid'); } },
      onFocus: function (item) {
        if (mode !== 'albums') { U.$('when').textContent = U.fmtMonth(item.date); }
      }
    });

    for (i = 0; i < tabs.length; i++) {
      (function (i) {
        tabs[i].onmouseover = function () { tabFocus = i; setZone('tabs'); };
        tabs[i].onclick = function () { activateTab(i); };
      })(i);
    }
    U.$('connect').onclick = connect;
    document.addEventListener('keydown', onKey, false);

    server = Store.get('server', '');
    key = Store.get('apiKey', '');
    if (server && key) {
      client = new Immich.Client(server, key);
      showScreen('browse');
      openTimeline();
    } else {
      showSetup();
    }
  }

  start();
})();
