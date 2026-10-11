/* Immich-Lite controller.

   The browse screen shows one "view" at a time:
     assets   - a photo grid fed by a source (timeline, album, person, place, search...)
     cards    - a grid of albums / people / places, or the Explore page
     settings, search, map - their own pages
   Views opened from another view are pushed on a stack; Back pops it. */
(function () {
  'use strict';

  var TABS = ['photos', 'explore', 'map', 'favorites', 'albums', 'search', 'settings'];
  var TAB_PLAY = TABS.length; // the Slideshow button after the tabs
  var SETUP_FIELDS = ['server', 'apikey', 'connect'];
  var SHUFFLE_BATCH = 100;
  var EXPLORE_ROW = 12;       // people / places shown on Explore before "All"

  var client = null;
  var grid = null;
  var screen = 'setup';       // 'setup' | 'browse' | 'viewer'
  var zone = 'panel';         // in browse: 'tabs' | 'panel'
  var tabFocus = 0;
  var stack = [];
  var showToken = 0;
  var autoplayNext = false;   // start a slideshow when the next asset view's first photos arrive

  function view() { return stack[stack.length - 1]; }

  // ---------- sources: where an asset view's photos come from ----------

  /* A timeline (whole library, favorites, an album, a person), a month at a time. */
  function TimelineSource(filter) {
    this.filter = filter;
    this.buckets = null;
    this.next = 0;
    this.busy = false;
    this.done = false;
  }

  TimelineSource.prototype.more = function (cb) {
    var self = this;
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

  /* Paged search results. fetch(page, cb(err, items, nextPage)) */
  function PagedSource(fetch) {
    this.fetch = fetch;
    this.page = 1;
    this.busy = false;
    this.done = false;
  }

  PagedSource.prototype.more = function (cb) {
    var self = this;
    self.busy = true;
    self.fetch(self.page, function (err, items, next) {
      self.busy = false;
      if (err) { return cb(err); }
      if (next) { self.page = next; } else { self.done = true; }
      cb(null, items);
    });
  };

  /* A fixed list (a memory, a map bubble). */
  function StaticSource(items) {
    this.items = items;
    this.busy = false;
    this.done = false;
  }

  StaticSource.prototype.more = function (cb) {
    this.done = true;
    cb(null, this.items);
  };

  // ---------- views ----------

  /* random: a /search/random filter for shuffle, or null to shuffle the loaded photos. */
  function assetView(tab, title, makeSource, random, group, empty) {
    return { kind: 'assets', tab: tab, title: title, makeSource: makeSource, random: random, group: group,
      empty: empty || 'No photos here yet' };
  }

  function photosView() {
    return assetView('photos', '', function () { return new TimelineSource(photosFilter()); },
      { visibility: 'timeline' }, true);
  }

  /* Immich only accepts withPartners on the plain timeline (visibility=timeline, no
     favorite or trash filter), which is what Photos asks for. /search/random has no
     withPartners, so shuffle keeps the filter above. */
  /* withStacked: a stack (burst shots, edits) shows as its primary photo only, with a
     count badge; the viewer steps through the rest with CH+/CH-. Only on Photos:
     Immich hides a stack's other photos under any filter, so in an album, a person,
     favorites or a tag a photo would vanish when its stack's primary isn't there too. */
  function photosFilter() {
    var f = { visibility: 'timeline', order: 'desc', withStacked: true };
    if (Settings.get('withPartners') === 'on') { f.withPartners = true; }
    return f;
  }

  function favoritesView() {
    return assetView('favorites', 'Favorites',
      function () { return new TimelineSource({ isFavorite: true, visibility: 'timeline', order: 'desc' }); },
      { isFavorite: true }, true, 'No favorites yet. In the photo viewer, press ▲ to add one.');
  }

  function albumView(a) {
    return assetView('albums', a.albumName || 'Untitled album',
      function () { return new TimelineSource({ albumId: a.id, order: 'desc' }); },
      { albumIds: [a.id] }, true, 'This album is empty');
  }

  function personView(p) {
    return assetView(view().tab, p.name || 'Unnamed person',
      function () { return new TimelineSource({ personId: p.id, visibility: 'timeline', order: 'desc' }); },
      { personIds: [p.id] }, true);
  }

  function placeView(pl) {
    return assetView(view().tab, pl.city,
      function () { return new PagedSource(function (page, cb) { client.searchMetadata({ city: pl.city }, page, cb); }); },
      { city: pl.city }, true);
  }

  function staticView(tab, title, items) {
    return assetView(tab, title, function () { return new StaticSource(items); }, null, false);
  }

  function searchView(q) {
    return assetView('search', '“' + q + '”',
      function () { return new PagedSource(function (page, cb) { client.searchSmart(q, page, cb); }); },
      null, false, 'Nothing found for “' + q + '”');
  }

  /* load(cb(err, sections)), sections: [{key, title, items}] of card items:
     {kind: 'album' | 'person' | 'place' | 'memory' | 'more', ...} */
  function cardsView(tab, title, load, empty) {
    return { kind: 'cards', tab: tab, title: title, load: load, empty: empty, cache: null };
  }

  function albumsView() {
    return cardsView('albums', '', function (cb) {
      client.albums(function (err, list) {
        if (err) { return cb(err); }
        list.sort(function (a, b) {
          var x = a.lastModifiedAssetTimestamp || a.updatedAt || '', y = b.lastModifiedAssetTimestamp || b.updatedAt || '';
          return x < y ? 1 : (x > y ? -1 : 0);
        });
        cb(null, [{ key: 'albums', items: map(list, function (a) { return { kind: 'album', album: a }; }) }]);
      });
    }, 'No albums yet');
  }

  function peopleView() {
    return cardsView(view().tab, 'People', function (cb) {
      client.people(function (err, list) {
        if (err) { return cb(err); }
        cb(null, [{ key: 'people', items: map(list, function (p) { return { kind: 'person', person: p }; }) }]);
      });
    }, 'No people yet. Immich finds faces after photos are processed.');
  }

  function placesView() {
    return cardsView(view().tab, 'Places', function (cb) {
      client.places(function (err, list) {
        if (err) { return cb(err); }
        cb(null, [{ key: 'places', items: map(list, function (pl) { return { kind: 'place', place: pl }; }) }]);
      });
    }, 'No places yet. Places come from photo locations.');
  }

  function exploreView() {
    return cardsView('explore', '', function (cb) {
      var got = {}, errors = [], pending = 3;
      function done() {
        var sections = [], items;
        if (--pending) { return; }
        if (errors.length === 3) { return cb(errors[0]); }
        if (got.memories && got.memories.length) {
          sections.push({ key: 'memories', title: 'On this day', items: map(got.memories, function (m) {
            return { kind: 'memory', memory: m };
          }) });
        }
        if (got.people && got.people.length) {
          items = map(got.people.slice(0, EXPLORE_ROW), function (p) { return { kind: 'person', person: p }; });
          if (got.people.length > EXPLORE_ROW) { items.push({ kind: 'more', label: 'All people', sub: got.people.length + ' people', open: peopleView }); }
          sections.push({ key: 'people', title: 'People', items: items });
        }
        if (got.places && got.places.length) {
          items = map(got.places.slice(0, EXPLORE_ROW), function (pl) { return { kind: 'place', place: pl }; });
          if (got.places.length > EXPLORE_ROW) { items.push({ kind: 'more', label: 'All places', sub: got.places.length + ' places', open: placesView }); }
          sections.push({ key: 'places', title: 'Places', items: items });
        }
        sections.push({ key: 'library', title: 'Library', items: libraryCards() });
        cb(null, sections);
      }
      client.memories(function (err, list) { if (err) { errors.push(err); } got.memories = list; done(); });
      client.people(function (err, list) { if (err) { errors.push(err); } got.people = list; done(); });
      client.places(function (err, list) { if (err) { errors.push(err); } got.places = list; done(); });
    }, 'Nothing to explore yet. People, places and memories appear once Immich has processed your photos.');
  }

  // ---------- library: archive, folders, tags ----------

  /* The Library row on Explore. Text-only cards (no cover to show). */
  function libraryCards() {
    return [
      { kind: 'archive', label: 'Archive', sub: 'Kept out of Photos' },
      { kind: 'folders', label: 'Folders', sub: 'Browse by folder' },
      { kind: 'tags', label: 'Tags', sub: 'Browse by tag' }
    ];
  }

  function archiveView() {
    return assetView(view().tab, 'Archive',
      function () { return new TimelineSource({ visibility: 'archive', order: 'desc' }); },
      { visibility: 'archive' }, true, 'No archived photos. Photos you archive in Immich show up here instead of in Photos.');
  }

  function tagsView() {
    return cardsView(view().tab, 'Tags', function (cb) {
      client.tags(function (err, list) {
        if (err) { return cb(err); }
        // Sorting by the full value keeps a tag's children ("Places/Canada") right after it.
        list = (list || []).slice().sort(function (a, b) {
          var x = String(a.value || a.name).toLowerCase(), y = String(b.value || b.name).toLowerCase();
          return x < y ? -1 : (x > y ? 1 : 0);
        });
        cb(null, [{ key: 'tags', items: map(list, function (t) { return { kind: 'tag', tag: t }; }) }]);
      });
    }, 'No tags yet. Tags you add in Immich show up here.');
  }

  /* No visibility filter, like an album: a tag's archived photos show too. */
  function tagView(t) {
    return assetView(view().tab, t.value || t.name,
      function () { return new TimelineSource({ tagId: t.id, order: 'desc' }); },
      { tagIds: [t.id] }, true, 'No photos with this tag');
  }

  /* Immich lists every folder that holds photos as a flat list of paths. They become a
     tree of {name, path, children, hasPhotos}. The top folders every path shares
     (e.g. /usr/src/app/upload/library) are skipped, so the first page shows real choices. */
  function folderTree(paths) {
    var root = { name: '', path: '', children: [], byName: {}, hasPhotos: false }, node, segs, i, j;
    for (i = 0; i < paths.length; i++) {
      segs = String(paths[i]).replace(/\/+$/, '').split('/');
      node = root;
      for (j = 0; j < segs.length; j++) {
        if (!segs[j]) { continue; } // the empty part before a leading '/'
        if (!Object.prototype.hasOwnProperty.call(node.byName, segs[j])) {
          node.byName[segs[j]] = { name: segs[j], path: segs.slice(0, j + 1).join('/'), children: [], byName: {}, hasPhotos: false };
          node.children.push(node.byName[segs[j]]);
        }
        node = node.byName[segs[j]];
      }
      node.hasPhotos = true;
    }
    while (root.children.length === 1 && !root.hasPhotos) { root = root.children[0]; }
    sortFolders(root);
    return root;
  }

  function sortFolders(node) {
    var i;
    node.children.sort(function (a, b) {
      var x = a.name.toLowerCase(), y = b.name.toLowerCase();
      return x < y ? -1 : (x > y ? 1 : 0);
    });
    for (i = 0; i < node.children.length; i++) { sortFolders(node.children[i]); }
  }

  function foldersView() {
    return cardsView(view().tab, 'Folders', function (cb) {
      client.folderPaths(function (err, paths) {
        if (err) { return cb(err); }
        if (!paths || !paths.length) { return cb(null, []); }
        folderSections(folderTree(paths), cb);
      });
    }, 'No folders found. Folders come from where your photos are stored on the server.');
  }

  function folderView(node) {
    return cardsView(view().tab, node.name, function (cb) { folderSections(node, cb); }, 'This folder is empty');
  }

  /* A folder's page: its subfolders, led by a "Photos in this folder" card when it
     holds photos itself (fetched now for the cover and count). */
  function folderSections(node, cb) {
    var items = map(node.children, function (n) { return { kind: 'folder', node: n }; });
    if (!node.hasPhotos) { return cb(null, [{ key: 'folders', items: items }]); }
    folderAssets(node, function () { // on error the card still shows; opening it shows the error
      items.unshift({ kind: 'folderPhotos', node: node });
      cb(null, [{ key: 'folders', items: items }]);
    });
  }

  /* Loads a folder's own photos once, newest first (date grouping expects that). */
  function folderAssets(node, cb) {
    if (node.assets) { return cb(null); }
    client.folderAssets(node.path, function (err, list) {
      if (err) { return cb(err); }
      node.assets = list.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
      cb(null);
    });
  }

  /* No random filter for a folder, so shuffle mixes the folder's own photos. */
  function folderPhotosView(node) {
    return assetView(view().tab, node.name || 'Folder', function () {
      return new PagedSource(function (page, cb) {
        folderAssets(node, function (err) { cb(err, node.assets, null); });
      });
    }, null, true, 'No photos in this folder');
  }

  /* Cards that open another page of cards rather than photos. */
  function listForCard(it) {
    switch (it.kind) {
      case 'folders': return foldersView();
      case 'tags': return tagsView();
      case 'folder': return it.node.children.length ? folderView(it.node) : null;
    }
    return null;
  }

  /* The asset view a card opens. */
  function viewForCard(it) {
    switch (it.kind) {
      case 'album': return albumView(it.album);
      case 'person': return personView(it.person);
      case 'place': return placeView(it.place);
      case 'memory': return staticView(view().tab, it.memory.title, it.memory.assets);
      case 'archive': return archiveView();
      case 'tag': return tagView(it.tag);
      case 'folder': return it.node.hasPhotos ? folderPhotosView(it.node) : null; // Play: its own photos
      case 'folderPhotos': return folderPhotosView(it.node);
    }
    return null;
  }

  function rootView(name) {
    switch (name) {
      case 'photos': return photosView();
      case 'explore': return exploreView();
      case 'favorites': return favoritesView();
      case 'albums': return albumsView();
    }
    return { kind: name, tab: name, title: '' }; // map, search, settings
  }

  function map(list, fn) {
    var out = [], i;
    for (i = 0; i < (list || []).length; i++) { out.push(fn(list[i])); }
    return out;
  }

  // ---------- rendering ----------

  function renderAsset(it) {
    var r = { shape: 'photo', thumb: client.thumbUrl(it.id, 'thumbnail'), badge: it.isImage ? (it.isFavorite ? '♥' : '') : videoBadge(it) };
    if (it.stackCount > 1) { r.badge = (r.badge ? r.badge + '  ' : '') + '⧉ ' + it.stackCount; }
    return r;
  }

  function videoBadge(it) {
    return 'VIDEO' + (it.duration ? ' ' + U.fmtDuration(it.duration / 1000) : '');
  }

  function renderCard(it) {
    var a;
    switch (it.kind) {
      case 'album':
        a = it.album;
        return { shape: 'card', thumb: a.albumThumbnailAssetId ? client.thumbUrl(a.albumThumbnailAssetId) : null,
          label: a.albumName || 'Untitled', sub: a.assetCount + (a.assetCount === 1 ? ' item' : ' items') };
      case 'person':
        return { shape: 'person', thumb: client.personThumbUrl(it.person.id), label: it.person.name || ' ' };
      case 'place':
        return { shape: 'card', thumb: client.thumbUrl(it.place.assetId), label: it.place.city, sub: it.place.country };
      case 'memory':
        return { shape: 'card', thumb: client.thumbUrl(it.memory.assets[0].id), label: it.memory.title,
          sub: it.memory.assets.length + (it.memory.assets.length === 1 ? ' photo' : ' photos') };
      case 'tag': // "Places/Canada": the name big, its parents under it
        a = String(it.tag.value || it.tag.name);
        return { shape: 'card more', thumb: null, label: it.tag.name || a,
          sub: a.lastIndexOf('/') > 0 ? a.substr(0, a.lastIndexOf('/')).replace(/\//g, ' / ') : 'Tag' };
      case 'folder':
        return { shape: 'card more', thumb: null, label: it.node.name, sub: folderSub(it.node) };
      case 'folderPhotos':
        a = it.node.assets;
        return { shape: a && a.length ? 'card' : 'card more', thumb: a && a.length ? client.thumbUrl(a[0].id) : null,
          label: 'Photos in this folder', sub: a ? a.length + (a.length === 1 ? ' item' : ' items') : '' };
    }
    return { shape: 'card more', thumb: null, label: it.label, sub: it.sub };
  }

  function folderSub(node) {
    var n = node.children.length;
    if (!n) { return 'Photos'; }
    return n + (n === 1 ? ' folder' : ' folders') + (node.hasPhotos ? ' and photos' : '');
  }

  function setStatus(text) { U.$('status').textContent = text || ''; }

  function drawTabs() {
    var tabs = U.$('tabs').children, v = view(), current = v ? TABS.indexOf(v.tab) : -1, i;
    if (tabFocus > lastTab()) { tabFocus = lastTab(); }
    for (i = 0; i < tabs.length; i++) {
      U.toggleClass(tabs[i], 'current', i === current);
      U.toggleClass(tabs[i], 'focused', zone === 'tabs' && i === tabFocus);
    }
    U.toggleClass(tabs[TAB_PLAY], 'hidden', lastTab() !== TAB_PLAY);
  }

  /* The Slideshow button only shows where there are photos to play. */
  function lastTab() {
    var v = view();
    return v && (v.kind === 'assets' || v.kind === 'cards') ? TAB_PLAY : TAB_PLAY - 1;
  }

  function setZone(z) {
    var v = view(), inPanel = z === 'panel';
    zone = z;
    grid.setActive(inPanel && !!v && (v.kind === 'assets' || v.kind === 'cards'));
    Settings.setActive(inPanel && !!v && v.kind === 'settings');
    Search.setActive(inPanel && !!v && v.kind === 'search');
    if (!inPanel && document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
    drawTabs();
  }

  function showPanel(name) {
    var panels = ['grid', 'settings', 'search', 'map'], i;
    for (i = 0; i < panels.length; i++) { U.toggleClass(U.$(panels[i]), 'hidden', panels[i] !== name); }
  }

  function applyTileSize() {
    var g = U.$('grid'), size = Settings.get('tileSize');
    U.toggleClass(g, 'size-small', size === 'small');
    U.toggleClass(g, 'size-large', size === 'large');
  }

  // ---------- showing views ----------

  function openTab(i) {
    tabFocus = i;
    if (i === TAB_PLAY) { return startSlideshow(); }
    autoplayNext = false;
    stack = [rootView(TABS[i])];
    show(view(), 0);
  }

  function push(v) {
    view().returnFocus = grid.focus;
    stack.push(v);
    show(v, 0);
  }

  function back() {
    if (stack.length < 2) { return false; }
    stack.pop();
    autoplayNext = false;
    show(view(), view().returnFocus || 0);
    return true;
  }

  function show(v, restoreFocus) {
    var token = ++showToken;
    U.$('title').textContent = v.title || '';
    U.$('when').textContent = '';
    setStatus('');
    drawTabs();

    if (v.kind === 'settings') { showPanel('settings'); openSettings(); setZone('panel'); return; }
    if (v.kind === 'search') {
      showPanel('search');
      Search.open({ onSearch: function (q) { push(searchView(q)); }, onPointer: pointer });
      setZone('panel');
      return;
    }
    if (v.kind === 'map') {
      showPanel('map');
      MapView.show({
        load: function (cb) { client.mapMarkers(cb); },
        thumbUrl: function (id) { return client.thumbUrl(id, 'thumbnail'); },
        onOpen: function (ids, label) {
          push(staticView('map', label, map(ids, function (id) { return { id: id, isImage: true, isFavorite: false, date: '' }; })));
        },
        onPointer: pointer
      });
      setZone('panel');
      return;
    }

    showPanel('grid');
    if (v.kind === 'cards') {
      grid.reset(renderCard);
      if (v.cache) { return fillCards(v, v.cache, restoreFocus); }
      setStatus('Loading...');
      v.load(function (err, sections) {
        if (token !== showToken) { return; }
        if (err) { return setStatus(err.message); }
        v.cache = sections;
        fillCards(v, sections, restoreFocus);
      });
      return;
    }

    v.source = v.makeSource();
    grid.reset(renderAsset);
    setStatus('Loading...');
    loadMore();
  }

  function fillCards(v, sections, restoreFocus) {
    var any = false, i;
    for (i = 0; i < sections.length; i++) {
      if (sections[i].items.length) {
        grid.append(sections[i].items, sections[i].key, sections[i].title);
        any = true;
      }
    }
    setStatus(any ? '' : v.empty);
    if (any) {
      setZone('panel');
      grid.setFocus(restoreFocus || 0);
    }
  }

  /* Loads the next batch into the current asset view. cb(gotMore) is optional; the
     viewer uses it to step past the last loaded photo. */
  function loadMore(cb) {
    var v = view(), src = v && v.source;
    if (!v || v.kind !== 'assets' || !src || src.done) { if (cb) { cb(false); } return; }
    if (src.busy) {
      if (cb) { setTimeout(function () { loadMore(cb); }, 300); }
      return;
    }
    src.more(function (err, items) {
      var first;
      if (view() !== v || v.source !== src) { return; } // user moved on meanwhile
      if (err) { setStatus(err.message); if (cb) { cb(false); } return; }
      if (Settings.get('showVideos') === 'hide') {
        items = items.filter(function (it) { return it.isImage; });
      }
      first = grid.items.length === 0;
      appendAssets(v, items);
      if (first && items.length) {
        setStatus('');
        setZone('panel');
        grid.setFocus(0);
        if (autoplayNext) { autoplayNext = false; openViewer(0, true); }
      }
      if (!items.length) {
        if (!src.done) { return loadMore(cb); } // an empty month or page, keep going
        if (first) { setStatus(v.empty); autoplayNext = false; }
      }
      if (cb) { cb(items.length > 0); }
    });
  }

  /* Adds photos, split into day or month sections when the view groups by date. */
  function appendAssets(v, items) {
    var by = v.group ? Settings.get('groupBy') : 'off', start = 0, key, k, i;
    if (by === 'off') { grid.append(items, 'all'); return; }
    for (i = 0; i <= items.length; i++) {
      k = i < items.length ? (by === 'month' ? items[i].date.substr(0, 7) : items[i].date) : null;
      if (i > 0 && k !== key) {
        grid.append(items.slice(start, i), key, by === 'month' ? U.fmtMonthLong(key) : U.fmtDayHeader(key));
        start = i;
      }
      key = k;
    }
  }

  // ---------- settings ----------

  function openSettings() {
    Settings.open({
      account: function (cb) {
        var c = client, v = view();
        // Answers can arrive after the user has left settings or signed out.
        function current() { return view() === v && client === c; }
        c.me(function (err, user) {
          if (!current()) { return; }
          if (err) { return cb(['Could not load your account: ' + err.message, 'Server: ' + c.server]); }
          c.version(function (err2, ver) {
            if (!current()) { return; }
            cb([
              'Signed in as ' + (user.name || '') + (user.email ? ' (' + user.email + ')' : ''),
              'Server: ' + c.server + (err2 || !ver ? '' : '   Immich v' + ver.major + '.' + ver.minor + '.' + ver.patch)
            ]);
          });
        });
      },
      stats: function (cb) {
        var c = client, v = view(), got = {}, pending = 3;
        function current() { return view() === v && client === c; }
        function done() {
          if (--pending || !current()) { return; }
          cb(statsLines(got));
        }
        c.assetStats(function (err, s) { got.statsErr = err; got.stats = s; done(); });
        c.me(function (err, user) { got.user = err ? null : user; done(); });
        c.serverStorage(function (err, s) { got.disk = err ? null : s; done(); });
      },
      changeServer: showSetup,
      signOut: function () {
        Store.set('apiKey', '');
        client = null;
        stack = [];
        grid.reset(renderAsset);
        showSetup();
      },
      onChange: function (key) { if (key === 'tileSize') { applyTileSize(); } },
      onPointer: pointer
    });
  }

  /* Library statistics for Settings. Only endpoints a normal (non-admin) user's key
     can call: /assets/statistics (counts), /users/me (your usage, maybe a quota) and
     /server/storage (the server's disk). A missing permission just drops its line. */
  function statsLines(got) {
    var lines = [], s = got.stats, u = got.user, d = got.disk, used;
    if (s) {
      lines.push('Library: ' + U.fmtCount(s.images) + (s.images === 1 ? ' photo, ' : ' photos, ') +
        U.fmtCount(s.videos) + (s.videos === 1 ? ' video' : ' videos') +
        (s.total > s.images + s.videos ? '   (' + U.fmtCount(s.total) + ' items in all)' : ''));
    } else if (got.statsErr && got.statsErr.status === 403) {
      lines.push('Library counts need the asset.statistics permission on the API key');
    } else if (got.statsErr) {
      lines.push('Could not load library counts: ' + got.statsErr.message);
    }
    if (u && typeof u.quotaUsageInBytes === 'number') {
      used = 'Storage used: ' + U.fmtBytes(u.quotaUsageInBytes);
      if (u.quotaSizeInBytes) {
        used += ' of your ' + U.fmtBytes(u.quotaSizeInBytes) + ' quota (' +
          Math.round(u.quotaUsageInBytes * 100 / u.quotaSizeInBytes) + '%)';
      }
      lines.push(used);
    }
    if (d && d.diskSizeRaw) {
      lines.push('Server disk: ' + U.fmtBytes(d.diskUseRaw) + ' of ' + U.fmtBytes(d.diskSizeRaw) + ' used (' +
        Math.round(d.diskUsagePercentage) + '%)');
    }
    return lines;
  }

  // ---------- viewer and slideshow ----------

  function toggleFavorite(it, cb) {
    client.setFavorite([it.id], !it.isFavorite, function (err) {
      if (!err) { it.isFavorite = !it.isFavorite; }
      cb(err);
    });
  }

  /* A face picked in the viewer's details panel. The viewer has already closed. */
  function openPerson(p) { push(personView(p)); }

  function openViewer(index, autoplay) {
    var v = view();
    screen = 'viewer';
    Viewer.open({
      items: grid.items,
      index: index,
      autoplay: autoplay,
      urlFor: function (it) { return client.thumbUrl(it.id, 'preview'); },
      videoUrlFor: function (it) { return client.videoUrl(it.id); },
      more: loadMore,
      toggleFavorite: toggleFavorite,
      stack: function (it, cb) { client.stack(it.stackId, cb); },
      client: client,
      openPerson: openPerson,
      onClose: function (i) {
        screen = 'browse';
        if (view() === v) { grid.setFocus(i); }
      }
    });
  }

  /* From the Slideshow button or the remote's Play key. In order, it plays from the
     focused photo. Shuffled, it draws random photos from the view. On a card (album,
     person, place, memory) it plays that card's photos. */
  function startSlideshow() {
    var v = view(), shuffle = Settings.get('slideOrder') === 'shuffle', it, target;
    if (!v) { return; }
    if (v.kind === 'cards') {
      it = grid.items[grid.focus];
      target = it && viewForCard(it);
      if (!target) { return; }
      if (shuffle) { return startShuffle(target); }
      autoplayNext = true;
      return push(target);
    }
    if (v.kind !== 'assets') { return; }
    if (shuffle) { return startShuffle(v); }
    if (grid.items.length) { openViewer(grid.focus, true); }
  }

  function startShuffle(target) {
    var c = client, items = [], seen = {}, pool = null;

    function images(list) { return list.filter(function (it) { return it.isImage; }); }

    // Where shuffled photos come from: Immich's random search when the view has a
    // filter for it, otherwise the view's own photos in a random order.
    function batch(cb) {
      if (target.random) { return c.randomPhotos(target.random, SHUFFLE_BATCH, cb); }
      if (pool) { return cb(null, U.shuffled(pool)); }
      if (target === view()) { pool = images(grid.items); return cb(null, U.shuffled(pool)); }
      target.makeSource().more(function (err, list) {
        if (err) { return cb(err); }
        pool = images(list);
        cb(null, U.shuffled(pool));
      });
    }

    // A batch with nothing new means every photo has been shown (a small album), so
    // a fresh round starts. It never runs out, like a photo frame.
    function more(cb) {
      batch(function (err, list) {
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
      if (!got) { setStatus('No photos to show'); return; }
      setStatus('');
      screen = 'viewer';
      Viewer.open({
        items: items,
        index: 0,
        autoplay: true,
        shuffle: true,
        urlFor: function (it) { return c.thumbUrl(it.id, 'preview'); },
        more: more,
        toggleFavorite: toggleFavorite,
        client: c,
        openPerson: openPerson,
        onClose: function () { screen = 'browse'; }
      });
    });
  }

  function select(item, index) {
    var v = view(), list;
    if (v.kind === 'cards') {
      if (item.kind === 'more') { return push(item.open()); }
      list = listForCard(item);
      if (list) { return push(list); }
      return push(viewForCard(item));
    }
    openViewer(index, false);
  }

  // ---------- setup screen ----------

  function defaultServer() {
    // Served by tools/devserver.py, which proxies /api to Immich on the same origin.
    if (/^https?:$/.test(location.protocol)) { return location.protocol + '//' + location.host; }
    return '';
  }

  function showScreen(name) {
    screen = name;
    U.toggleClass(U.$('setup'), 'hidden', name !== 'setup');
    U.toggleClass(U.$('browse'), 'hidden', name === 'setup');
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
    c.me(function (err) {
      if (err) { return setupMsg(err.status === 0 ? err.message + corsHint(server) : err.message, true); }
      Store.set('server', server);
      Store.set('apiKey', key);
      client = c;
      document.activeElement.blur();
      showScreen('browse');
      openTab(0);
    });
  }

  // ---------- keys ----------

  function pointer() { if (zone !== 'panel') { setZone('panel'); } }

  function panelKey(k) {
    var v = view();
    if (!v) { return false; }
    if (v.kind === 'settings') { return Settings.key(k); }
    if (v.kind === 'search') { return Search.key(k); }
    if (v.kind === 'map') { return MapView.key(k); }
    return grid.key(k);
  }

  function setupKey(k) {
    var active = document.activeElement, cur = active ? SETUP_FIELDS.indexOf(active.id) : -1;
    if (k === KEY.DOWN) { U.$(SETUP_FIELDS[Math.min(cur + 1, SETUP_FIELDS.length - 1)]).focus(); return true; }
    if (k === KEY.UP) { U.$(SETUP_FIELDS[Math.max(cur - 1, 0)]).focus(); return true; }
    if (k === KEY.OK && active && active.id === 'connect') { connect(); return true; }
    if ((k === KEY.BACK || k === KEY.ESC) && client && stack.length) { showScreen('browse'); setZone('tabs'); return true; }
    return false;
  }

  function browseKey(k) {
    var isBack = k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE;
    if (k === KEY.PLAY) { startSlideshow(); return true; }
    if (zone === 'tabs') {
      if (k === KEY.LEFT) { tabFocus = Math.max(0, tabFocus - 1); drawTabs(); return true; }
      if (k === KEY.RIGHT) { tabFocus = Math.min(lastTab(), tabFocus + 1); drawTabs(); return true; }
      if (k === KEY.DOWN) { setZone('panel'); return true; }
      if (k === KEY.OK) { openTab(tabFocus); return true; }
      if (isBack) { back(); return true; }
      return false;
    }
    if (isBack) {
      if (!back()) { setZone('tabs'); }
      return true;
    }
    if (panelKey(k)) { return true; }
    if (k === KEY.UP) { setZone('tabs'); return true; } // up from the top of the page
    return false;
  }

  /* While a text box has focus, leave typing keys (letters, Backspace, Left/Right
     for the caret) to it. */
  function typing(k) {
    var a = document.activeElement;
    return a && a.tagName === 'INPUT' &&
      k !== KEY.UP && k !== KEY.DOWN && k !== KEY.OK && k !== KEY.BACK && k !== KEY.ESC;
  }

  function onKey(e) {
    var k = e.keyCode, used;
    if (typing(k)) { return; }
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
      onPointer: pointer,
      onFocus: function (item) {
        var v = view();
        U.$('when').textContent = v && v.kind === 'assets' && item.date ? U.fmtMonth(item.date) : '';
      }
    });

    for (i = 0; i < tabs.length; i++) {
      (function (i) {
        tabs[i].onmouseover = function () { tabFocus = i; setZone('tabs'); };
        tabs[i].onclick = function () { openTab(i); };
      })(i);
    }
    U.$('connect').onclick = connect;
    document.addEventListener('keydown', onKey, false);

    server = Store.get('server', '');
    key = Store.get('apiKey', '');
    if (server && key) {
      client = new Immich.Client(server, key);
      showScreen('browse');
      openTab(0);
    } else {
      showSetup();
    }
  }

  start();
})();
