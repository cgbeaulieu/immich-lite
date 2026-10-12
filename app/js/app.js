/* immich lite controller.

   The browse screen shows one "view" at a time:
     assets   - a photo grid fed by a source (timeline, album, person, place, search...)
     cards    - a grid of albums / people / places, or the Explore page
     settings, search, map - their own pages
   Views opened from another view are pushed on a stack; Back pops it. */
(function () {
  'use strict';

  /* The sidebar. Each entry opens a root view; the bottom two are account actions. */
  var RAIL = [
    { key: 'photos', label: 'Photos', icon: 'photos' },
    { key: 'search', label: 'Search', icon: 'search' },
    { key: 'explore', label: 'Explore', icon: 'explore' },
    { key: 'map', label: 'Map', icon: 'map' },
    { key: 'favorites', label: 'Favorites', icon: 'heart' },
    { key: 'albums', label: 'Albums', icon: 'albums' },
    { key: 'slides', label: 'Slideshow', icon: 'slideshow' },
    // Settings lives under your name at the bottom (the label becomes your name).
    { key: 'settings', label: 'Settings', icon: 'settings', bottom: true },
    { key: 'signout', label: 'Sign out', icon: 'logout', bottom: true }
  ];
  var SHUFFLE_BATCH = 100;
  var EXPLORE_ROW = 12;       // people / places shown on Explore before "All"

  var client = null;
  var grid = null;
  var screen = 'setup';       // 'setup' | 'browse' | 'viewer'
  var zone = 'panel';         // in browse: 'rail' (the sidebar) | 'panel' (the page)
  var railFocus = 0;
  var setupMode = 'login';    // sign in with 'login' (email + password) or 'key' (API key)
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

  /* immich only accepts withPartners on the plain timeline (visibility=timeline, no
     favorite or trash filter), which is what Photos asks for. /search/random has no
     withPartners, so shuffle keeps the filter above. */
  /* withStacked: a stack (burst shots, edits) shows as its primary photo only, with a
     count badge; the viewer steps through the rest with CH+/CH-. Only on Photos:
     immich hides a stack's other photos under any filter, so in an album, a person,
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
    return assetView('search', q,
      function () {
        return new PagedSource(function (page, cb) {
          client.searchSmart(q, page, function (err, items, next) {
            // immich answers 500 while its machine learning is still busy (e.g. a big import).
            if (err && err.status >= 500) {
              err.message = 'Smart search isn’t ready. immich may still be processing your photos; try again later (' + err.status + ')';
            }
            cb(err, items, next);
          });
        });
      },
      null, false, 'Nothing found for “' + q + '”');
  }

  /* load(cb(err, sections)), sections: [{key, title, items}] of card items:
     {kind: 'album' | 'person' | 'place' | 'memory' | 'more', ...} */
  function cardsView(tab, title, load, empty) {
    return { kind: 'cards', tab: tab, title: title, load: load, empty: empty, cache: null };
  }

  function albumsView() {
    return cardsView('albums', 'Albums', function (cb) {
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
    }, 'No people yet. immich finds faces after photos are processed.');
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
    return cardsView('explore', 'Explore', function (cb) {
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
          if (got.people.length > EXPLORE_ROW) { items.push({ kind: 'more', icon: 'people', label: 'All people', sub: got.people.length + ' people', open: peopleView }); }
          sections.push({ key: 'people', title: 'People', items: items });
        }
        if (got.places && got.places.length) {
          items = map(got.places.slice(0, EXPLORE_ROW), function (pl) { return { kind: 'place', place: pl }; });
          if (got.places.length > EXPLORE_ROW) { items.push({ kind: 'more', icon: 'place', label: 'All places', sub: got.places.length + ' places', open: placesView }); }
          sections.push({ key: 'places', title: 'Places', items: items });
        }
        sections.push({ key: 'library', title: 'Library', items: libraryCards() });
        cb(null, sections);
      }
      client.memories(function (err, list) { if (err) { errors.push(err); } got.memories = list; done(); });
      client.people(function (err, list) { if (err) { errors.push(err); } got.people = list; done(); });
      client.places(function (err, list) { if (err) { errors.push(err); } got.places = list; done(); });
    }, 'Nothing to explore yet. People, places and memories appear once immich has processed your photos.');
  }

  // ---------- library: archive, folders, tags ----------

  /* The Library row on Explore. Text-only cards (no cover to show). */
  function libraryCards() {
    return [
      { kind: 'archive', icon: 'archive', label: 'Archive', sub: 'Kept out of Photos' },
      { kind: 'folders', icon: 'folder', label: 'Folders', sub: 'Browse by folder' },
      { kind: 'tags', icon: 'tag', label: 'Tags', sub: 'Browse by tag' }
    ];
  }

  function archiveView() {
    return assetView(view().tab, 'Archive',
      function () { return new TimelineSource({ visibility: 'archive', order: 'desc' }); },
      { visibility: 'archive' }, true, 'No archived photos. Photos you archive in immich show up here instead of in Photos.');
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
    }, 'No tags yet. Tags you add in immich show up here.');
  }

  /* No visibility filter, like an album: a tag's archived photos show too. */
  function tagView(t) {
    return assetView(view().tab, t.value || t.name,
      function () { return new TimelineSource({ tagId: t.id, order: 'desc' }); },
      { tagIds: [t.id] }, true, 'No photos with this tag');
  }

  /* immich lists every folder that holds photos as a flat list of paths. They become a
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
    return { kind: name, tab: name, title: name === 'settings' ? 'Settings' : '' }; // map, search, settings, slides
  }

  function map(list, fn) {
    var out = [], i;
    for (i = 0; i < (list || []).length; i++) { out.push(fn(list[i])); }
    return out;
  }

  // ---------- rendering ----------

  /* Like immich's timeline: the photo at its own shape, "▶ 0:06" or a stack count in
     the top-right corner, a heart bottom-left for favorites. */
  function renderAsset(it) {
    var corner = [];
    if (it.stackCount > 1) { corner.push('⧉ ' + it.stackCount); }
    if (!it.isImage) { corner.push('▶' + (it.duration ? ' ' + U.fmtDuration(it.duration / 1000) : '')); }
    return { shape: 'photo', thumb: client.thumbUrl(it.id, 'thumbnail'), ratio: it.ratio || 1,
      corner: corner.join('   '), heart: it.isFavorite };
  }

  function renderCard(it) {
    var a;
    switch (it.kind) {
      case 'album':
        a = it.album;
        return { shape: 'card', icon: a.albumThumbnailAssetId ? null : 'albums',
          thumb: a.albumThumbnailAssetId ? client.thumbUrl(a.albumThumbnailAssetId) : null,
          label: a.albumName || 'Untitled', sub: a.assetCount + (a.assetCount === 1 ? ' item' : ' items') + (a.shared ? '  ·  shared' : '') };
      case 'person':
        return { shape: 'person', thumb: client.personThumbUrl(it.person.id), label: it.person.name || ' ' };
      case 'place':
        return { shape: 'card overlay', thumb: client.thumbUrl(it.place.assetId), label: it.place.city, sub: it.place.country };
      case 'memory':
        return { shape: 'card overlay', thumb: client.thumbUrl(it.memory.assets[0].id), label: it.memory.title,
          sub: it.memory.assets.length + (it.memory.assets.length === 1 ? ' photo' : ' photos') };
      case 'tag': // "Places/Canada": the name big, its parents under it
        a = String(it.tag.value || it.tag.name);
        return { shape: 'card iconcard', icon: 'tag', thumb: null, label: it.tag.name || a,
          sub: a.lastIndexOf('/') > 0 ? a.substr(0, a.lastIndexOf('/')).replace(/\//g, ' / ') : 'Tag' };
      case 'folder':
        return { shape: 'card iconcard', icon: 'folder', thumb: null, label: it.node.name, sub: folderSub(it.node) };
      case 'folderPhotos':
        a = it.node.assets;
        return { shape: a && a.length ? 'card' : 'card iconcard', icon: 'photos', thumb: a && a.length ? client.thumbUrl(a[0].id) : null,
          label: 'Photos in this folder', sub: a ? a.length + (a.length === 1 ? ' item' : ' items') : '' };
    }
    return { shape: 'card iconcard', icon: it.icon || 'chevron', thumb: null, label: it.label, sub: it.sub };
  }

  function folderSub(node) {
    var n = node.children.length;
    if (!n) { return 'Photos'; }
    return n + (n === 1 ? ' folder' : ' folders') + (node.hasPhotos ? ' and photos' : '');
  }

  /* The middle of the page: a spinner while loading, an icon for empty pages, red for errors. */
  function setStatus(text, mode) {
    var st = U.$('status'), e;
    st.innerHTML = '';
    st.className = mode === 'error' ? 'error' : '';
    if (!text) { return; }
    if (mode === 'loading') {
      e = document.createElement('div');
      e.className = 'spinner';
      st.appendChild(e);
    } else if (mode === 'empty') {
      st.innerHTML = Icons.svg('photos', 'state-icon');
    }
    st.appendChild(document.createTextNode(text));
  }

  /* An expired sign-in goes back to the sign-in page; anything else shows in the page. */
  function showError(err) {
    if (err.status === 401 && client && client.token) { return showSetup('Your sign-in has expired. Please sign in again.'); }
    setStatus(err.message, 'error');
  }

  function buildRail() {
    var tabs = U.$('tabs'), bottom = U.$('rail-bottom'), i;
    tabs.innerHTML = '';
    bottom.innerHTML = '';
    for (i = 0; i < RAIL.length; i++) {
      (function (r, i) {
        var e = document.createElement('div');
        e.className = 'rail-item';
        e.innerHTML = Icons.svg(r.icon) + '<span class="rail-label"></span>';
        e.lastChild.textContent = r.label;
        e.onmouseover = function () { railFocus = i; setZone('rail'); };
        e.onclick = function () { openRail(r.key); };
        (r.bottom ? bottom : tabs).appendChild(e);
        r.el = e;
      })(RAIL[i], i);
    }
  }

  function railIndex(key) {
    for (var i = 0; i < RAIL.length; i++) { if (RAIL[i].key === key) { return i; } }
    return -1;
  }

  /* The sidebar opens (labels showing) while it has focus. */
  function drawRail() {
    var v = view(), current = v ? railIndex(v.tab) : -1, i;
    U.toggleClass(U.$('rail'), 'open', zone === 'rail');
    for (i = 0; i < RAIL.length; i++) {
      U.toggleClass(RAIL[i].el, 'current', i === current);
      U.toggleClass(RAIL[i].el, 'focused', zone === 'rail' && i === railFocus);
    }
  }

  /* Shows your name on the sidebar's account entry. */
  function nameAccount(user) {
    RAIL[railIndex('settings')].el.lastChild.textContent = user && (user.name || user.email) || 'Settings';
  }

  function setZone(z) {
    var v = view(), inPanel = z === 'panel';
    if (z === 'rail' && zone !== 'rail' && v) { railFocus = Math.max(0, railIndex(v.tab)); }
    zone = z;
    grid.setActive(inPanel && !!v && (v.kind === 'assets' || v.kind === 'cards'));
    Settings.setActive(inPanel && !!v && v.kind === 'settings');
    Search.setActive(inPanel && !!v && v.kind === 'search');
    Slides.setActive(inPanel && !!v && v.kind === 'slides');
    if (!inPanel && document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
    drawRail();
  }

  function showPanel(name) {
    var panels = ['grid', 'settings', 'search', 'map', 'slides'], i;
    for (i = 0; i < panels.length; i++) { U.toggleClass(U.$(panels[i]), 'hidden', panels[i] !== name); }
  }

  /* The page heading, with "< Explore" above it on pages opened from another page. */
  function drawHead(v) {
    var prev = stack[stack.length - 2], crumb = U.$('crumb'), heading = v.title || '';
    U.toggleClass(U.$('main'), 'head', !!(heading || prev));
    U.$('title').textContent = heading;
    crumb.innerHTML = '';
    if (prev) {
      crumb.innerHTML = Icons.svg('back');
      crumb.appendChild(document.createTextNode(prev.title || RAIL[railIndex(prev.tab)].label));
    }
  }

  /* Thumbnail size sets the height of the justified photo rows. immich's desktop web
     app uses ~235px; a TV is seen from across the room, so these run larger. */
  var ROW_HEIGHTS = { small: 240, medium: 320, large: 420, xlarge: 540 };

  function rowHeight() { return ROW_HEIGHTS[Settings.get('tileSize')] || ROW_HEIGHTS.medium; }

  // ---------- showing views ----------

  function openRail(key) {
    if (key === 'signout') { return signOut(); }
    autoplayNext = false;
    stack = [rootView(key)];
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
    U.$('when').textContent = '';
    setStatus('');
    Slides.close();
    drawHead(v);
    drawRail();

    if (v.kind === 'slides') {
      showPanel('slides');
      Slides.open({ load: slideSources, onPointer: pointer });
      setZone('panel');
      return;
    }
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
        load: function (cb) { client.mapMarkers(Settings.get('withPartners') === 'on', cb); },
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
      setStatus('Loading', 'loading');
      v.load(function (err, sections) {
        if (token !== showToken) { return; }
        if (err) { return showError(err); }
        v.cache = sections;
        fillCards(v, sections, restoreFocus);
      });
      return;
    }

    v.source = v.makeSource();
    grid.reset(renderAsset);
    setStatus('Loading photos', 'loading');
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
    setStatus(any ? '' : v.empty, 'empty');
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
      if (err) { showError(err); if (cb) { cb(false); } return; }
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
        if (first) { setStatus(v.empty, 'empty'); autoplayNext = false; }
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
          if (err) { return cb(['Could not load your account: ' + err.message, 'Server: ' + c.server], null); }
          c.version(function (err2, ver) {
            if (!current()) { return; }
            cb([
              user.name || '',
              user.email || '',
              c.server + (err2 || !ver ? '' : '   ·   immich ' + ver.major + '.' + ver.minor + '.' + ver.patch) +
                (c.token ? '   ·   signed in' : '   ·   API key')
            ], { name: user.name, email: user.email });
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
      partners: function (cb) {
        var c = client, v = view();
        function current() { return view() === v && client === c; }
        c.partners(function (err, list) {
          if (!current()) { return; }
          if (err) {
            return cb(err.status === 403 ? 'Partners: the API key needs the partner.read permission to list them'
              : 'Could not load partners: ' + err.message, []);
          }
          if (!list || !list.length) {
            return cb('No partners share their photos with you. In immich, they add you under Account Settings > Partner Sharing.', []);
          }
          cb('A hidden partner\'s photos stay out of Photos, Search and the map. This is immich\'s\n' +
            '"Show in timeline" setting, saved to your account.',
            map(list, partnerRow));
        });
        function partnerRow(p) {
          var row = { label: 'Show ' + (p.name || p.email) + '\'s photos', on: !!p.inTimeline };
          row.toggle = function (done) {
            c.setPartnerInTimeline(p.id, !row.on, function (err) {
              if (!err) { row.on = !row.on; MapView.reset(); }
              done(err);
            });
          };
          return row;
        }
      },
      changeServer: function () { showSetup(); },
      signOut: signOut,
      onChange: function (key) {
        if (key === 'withPartners') { MapView.reset(); }
      },
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
      if (!err) {
        it.isFavorite = !it.isFavorite;
        if (grid.items.indexOf(it) !== -1) { grid.refreshMarks(grid.items.indexOf(it)); }
      }
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

    // Where shuffled photos come from: immich's random search when the view has a
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

    playSession(items, more, true);
  }

  /* Plays photos that more(cb(gotMore)) adds to items, full screen from the start. */
  function playSession(items, more, shuffled) {
    var c = client;
    setStatus(shuffled ? 'Shuffling' : 'Starting the slideshow', 'loading');
    more(function (got) {
      if (client !== c || screen !== 'browse') { return; }
      if (!got) { setStatus('No photos to show', 'empty'); return; }
      setStatus('');
      screen = 'viewer';
      Viewer.open({
        items: items,
        index: 0,
        autoplay: true,
        shuffle: shuffled,
        urlFor: function (it) { return c.thumbUrl(it.id, 'preview'); },
        more: more,
        toggleFavorite: toggleFavorite,
        client: c,
        openPerson: openPerson,
        onClose: function () { screen = 'browse'; }
      });
    });
  }

  /* A slideshow of a view's photos in order, without opening the view first (the
     Slideshow page). Videos are left out. */
  function startOrdered(target) {
    var items = [], src = target.makeSource();
    function more(cb) {
      if (src.done) { return cb(false); }
      src.more(function (err, list) {
        var added = 0, i;
        if (err) { showError(err); return cb(false); }
        for (i = 0; i < list.length; i++) { if (list[i].isImage) { items.push(list[i]); added++; } }
        if (!added && !src.done) { return more(cb); }
        cb(added > 0);
      });
    }
    playSession(items, more, false);
  }

  function playSource(target) {
    if (Settings.get('slideOrder') === 'shuffle') { startShuffle(target); } else { startOrdered(target); }
  }

  // ---------- slideshow page ----------

  /* What the Slideshow page offers: everything, favorites, today's memories, named
     people and albums. Each source finds its own cover photo for the big picture. */
  function slideSources(cb) {
    var c = client, got = {}, pending = 3;
    function done() {
      var list = [], i, n = 0, a, m, p;
      if (--pending || client !== c) { return; }
      list.push(source('All photos', 'Your whole library', 'photos', photosView(), randomCover({ visibility: 'timeline' })));
      list.push(source('Favorites', 'Photos you\u2019ve starred', 'heart', favoritesView(), randomCover({ isFavorite: true })));
      for (i = 0; i < got.memories.length; i++) {
        m = got.memories[i];
        list.push(source(m.title, m.assets.length + ' photos', 'memory', staticView('slides', m.title, m.assets), fixedCover(m.assets[0].id)));
      }
      for (i = 0; i < got.people.length && n < 8; i++) {
        p = got.people[i];
        if (!p.name) { continue; }
        n++;
        list.push(source(p.name, 'Person', 'people', personView(p), personCover(p)));
      }
      got.albums.sort(function (x, y) {
        var u = x.lastModifiedAssetTimestamp || x.updatedAt || '', w = y.lastModifiedAssetTimestamp || y.updatedAt || '';
        return u < w ? 1 : (u > w ? -1 : 0);
      });
      for (i = 0; i < got.albums.length; i++) {
        a = got.albums[i];
        if (!a.assetCount) { continue; }
        list.push(source(a.albumName || 'Untitled album', a.assetCount + (a.assetCount === 1 ? ' item' : ' items'), 'albums',
          albumView(a), fixedCover(a.albumThumbnailAssetId)));
      }
      cb(list);
    }
    c.memories(function (err, list) { got.memories = err ? [] : list || []; done(); });
    c.people(function (err, list) { got.people = err ? [] : list || []; done(); });
    c.albums(function (err, list) { got.albums = err ? [] : list || []; done(); });
  }

  function source(name, sub, icon, target, loadCover) {
    return { name: name, sub: sub, icon: icon, loadCover: loadCover, play: function () { playSource(target); } };
  }

  /* Covers: cb(small url for the card, big url for the hero picture). */
  function randomCover(filter) {
    return function (cb) {
      client.randomPhotos(filter, 1, function (err, list) {
        var id = !err && list && list[0] && list[0].id;
        cb(id ? client.thumbUrl(id, 'thumbnail') : null, id ? client.thumbUrl(id, 'preview') : null);
      });
    };
  }

  function fixedCover(id) {
    return function (cb) { cb(id ? client.thumbUrl(id, 'thumbnail') : null, id ? client.thumbUrl(id, 'preview') : null); };
  }

  function personCover(p) {
    return function (cb) {
      client.randomPhotos({ personIds: [p.id] }, 1, function (err, list) {
        var id = !err && list && list[0] && list[0].id;
        cb(client.personThumbUrl(p.id), id ? client.thumbUrl(id, 'preview') : null);
      });
    };
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

  // ---------- setup (sign-in) screen ----------

  function defaultServer() {
    // Served by tools/devserver.py, which proxies /api to immich on the same origin.
    if (/^https?:$/.test(location.protocol)) { return location.protocol + '//' + location.host; }
    return '';
  }

  function showScreen(name) {
    if (screen === 'setup' && name !== 'setup') { Pairing.hide(); } // the TV stops listening for a phone
    screen = name;
    U.toggleClass(U.$('setup'), 'hidden', name !== 'setup');
    U.toggleClass(U.$('browse'), 'hidden', name === 'setup');
  }

  function showSetup(message) {
    var server = Store.get('server', '') || defaultServer();
    U.$('server').value = server;
    U.$('email').value = Store.get('email', '');
    U.$('password').value = '';
    U.$('apikey').value = Store.get('apiKey', '');
    setMode(Store.get('authMode', 'login'));
    setupMsg(message || (client ? 'Press Back to return to your photos.' : ''), !!message);
    showScreen('setup');
    U.$(!server ? 'server' : (setupMode === 'login' ? (U.$('email').value ? 'password' : 'email') : 'apikey')).focus();
    Pairing.show(server, {
      onCredentials: phoneCredentials,
      onUnavailable: function () { U.show(U.$('help-card')); } // e.g. no TV service: keep the typing tips
    });
  }

  /* Details sent from a phone (the QR code): fill the form and sign in as if typed,
     then tell the phone how it went. The password is never stored. */
  function phoneCredentials(c) {
    U.$('server').value = c.server;
    if (c.apiKey) {
      setMode('key');
      U.$('apikey').value = c.apiKey;
    } else {
      setMode('login');
      U.$('email').value = c.email;
      U.$('password').value = c.password;
    }
    connect(function (ok, message) { Pairing.report(ok, message); });
  }

  function setupMsg(text, isError) {
    var m = U.$('setup-msg');
    m.textContent = text || '';
    U.toggleClass(m, 'error', !!isError);
  }

  /* Email + password, or an API key: one of the two field groups shows. */
  function setMode(mode) {
    setupMode = mode === 'key' ? 'key' : 'login';
    U.toggleClass(U.$('login-fields'), 'hidden', setupMode !== 'login');
    U.toggleClass(U.$('key-fields'), 'hidden', setupMode !== 'key');
    U.toggleClass(U.$('mode-login'), 'on', setupMode === 'login');
    U.toggleClass(U.$('mode-key'), 'on', setupMode === 'key');
  }

  /* Focus moves in rows; Left/Right move within the chip and sign-in-method rows. */
  function setupRows() {
    return [['server'], ['chip-http', 'chip-https', 'chip-port'], ['mode-login', 'mode-key']]
      .concat(setupMode === 'login' ? [['email'], ['password']] : [['apikey']])
      .concat([['connect']]);
  }

  /* The address shortcuts: swap the http:// / https:// prefix, or add immich's port. */
  function applyChip(id) {
    var input = U.$('server'), v = input.value.trim(), host;
    if (id === 'chip-port') {
      host = v.replace(/^https?:\/\//i, '');
      if (!/:\d+\/?$/.test(host)) { input.value = v.replace(/\/+$/, '') + ':2283'; }
    } else {
      input.value = (id === 'chip-https' ? 'https://' : 'http://') + v.replace(/^https?:\/\//i, '');
    }
  }

  /* immich sends no CORS headers, so a page served over http can't call it at another
     address. The dev server forwards /api on its own address instead. */
  function corsHint(server) {
    var here = defaultServer();
    if (!here || server.replace(/\/+$/, '').toLowerCase() === here.toLowerCase()) { return ''; }
    return '. immich blocks calls from other addresses, so use this page\'s address, ' + here +
      ', as the server. The dev server passes requests on to immich.';
  }

  /* done(ok, message) is optional: phone sign-in uses it to report back. */
  function connect(done) {
    var server = U.$('server').value.trim().replace(/\/+$/, ''), email, password, key, c;
    if (server && !/^[a-z][a-z0-9+.-]*:\/\//i.test(server)) { server = 'http://' + server; } // "mediaserver:2283" works too
    done = typeof done === 'function' ? done : function () {};
    function failed(err) {
      setupMsg(err.status === 0 ? err.message + corsHint(server) : err.message, true);
      done(false, err.message);
    }
    function refuse(text) { setupMsg(text, true); done(false, text); }
    if (!/^https?:\/\//i.test(server)) { return refuse('The server address must start with http:// or https://'); }

    if (setupMode === 'login') {
      email = U.$('email').value.trim().toLowerCase(); // immich stores emails in lower case
      password = U.$('password').value;
      if (!email || !password) { return refuse('Enter the email and password you use for immich.'); }
      setupMsg('Signing in...');
      Net.via(server, function (apiBase) {
        Immich.login(server, email, password, function (err, res) {
          var signed;
          if (err) { return failed(err); }
          Store.set('email', email);
          done(true, 'Signed in');
          signed = new Immich.Client(server, null, res.accessToken);
          signed.apiBase = apiBase;
          signedIn(signed, server);
        }, apiBase);
      });
      return;
    }

    key = U.$('apikey').value.trim();
    if (!key) { return refuse('Enter an API key. Create one in immich: Account Settings > API Keys.'); }
    c = new Immich.Client(server, key);
    setupMsg('Connecting...');
    Net.via(server, function (apiBase) {
      c.apiBase = apiBase;
      c.me(function (err) {
        if (err) { return failed(err); }
        done(true, 'Signed in');
        signedIn(c, server);
      });
    });
  }

  /* Only the server, the sign-in method and the key or session token are kept;
     never the password. */
  function signedIn(c, server) {
    Store.set('server', server);
    Store.set('authMode', setupMode);
    Store.set('apiKey', c.apiKey);
    Store.set('token', c.token);
    client = c;
    U.$('password').value = '';
    if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
    showScreen('browse');
    openRail('photos');
    loadAccountName();
  }

  function signOut() {
    if (client) { client.logout(); }
    Store.set('apiKey', '');
    Store.set('token', '');
    client = null;
    stack = [];
    grid.reset(renderAsset);
    showSetup();
  }

  function loadAccountName() {
    var c = client;
    c.me(function (err, user) { if (!err && client === c) { nameAccount(user); } });
  }

  // ---------- keys ----------

  function pointer() { if (zone !== 'panel') { setZone('panel'); } }

  function panelKey(k) {
    var v = view();
    if (!v) { return false; }
    if (v.kind === 'settings') { return Settings.key(k); }
    if (v.kind === 'search') { return Search.key(k); }
    if (v.kind === 'map') { return MapView.key(k); }
    if (v.kind === 'slides') { return Slides.key(k); }
    return grid.key(k);
  }

  function setupKey(k) {
    var rows = setupRows(), active = document.activeElement, id = active && active.id, r, c, line;
    for (r = 0; r < rows.length; r++) { c = rows[r].indexOf(id); if (c !== -1) { break; } }
    if (r === rows.length) { r = 0; c = 0; }
    line = rows[r];
    switch (k) {
      case KEY.DOWN: if (r < rows.length - 1) { r++; } break;
      case KEY.UP: if (r > 0) { r--; } break;
      case KEY.LEFT: if (c > 0) { c--; } break;
      case KEY.RIGHT: if (c < line.length - 1) { c++; } break;
      case KEY.OK:
        if (id === 'connect') { connect(); return true; }
        if (/^chip-/.test(id)) { applyChip(id); return true; }
        if (id === 'mode-login' || id === 'mode-key') { setMode(id === 'mode-key' ? 'key' : 'login'); return true; }
        // OK in a filled password or key box signs in (the TV keyboard's Enter sends OK too).
        if ((id === 'password' || id === 'apikey') && active.value) { connect(); return true; }
        return false; // OK on a text box: let the TV open its keyboard
      case KEY.BACK: case KEY.ESC:
        if (client && stack.length) { showScreen('browse'); setZone('rail'); return true; }
        return false;
      default: return false;
    }
    // Moving onto the sign-in-method row lands on the chosen method.
    if (rows[r][0] === 'mode-login' && (k === KEY.UP || k === KEY.DOWN)) { c = setupMode === 'key' ? 1 : 0; }
    U.$(rows[r][Math.min(c, rows[r].length - 1)]).focus();
    return true;
  }

  function browseKey(k) {
    var isBack = k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE;
    if (k === KEY.PLAY) {
      if (view() && view().kind === 'slides') { return Slides.key(KEY.OK); }
      startSlideshow();
      return true;
    }
    if (zone === 'rail') {
      if (k === KEY.UP) { railFocus = Math.max(0, railFocus - 1); drawRail(); return true; }
      if (k === KEY.DOWN) { railFocus = Math.min(RAIL.length - 1, railFocus + 1); drawRail(); return true; }
      if (k === KEY.OK) { openRail(RAIL[railFocus].key); return true; }
      if (k === KEY.RIGHT) { setZone('panel'); return true; }
      if (isBack) { if (back()) { setZone('panel'); } return true; }
      return false;
    }
    if (isBack) {
      if (!back()) { setZone('rail'); }
      return true;
    }
    if (panelKey(k)) { return true; }
    if (k === KEY.LEFT || k === KEY.UP) { setZone('rail'); return true; } // off the edge of the page
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
    var server, key, token;
    U.$('brand-logo').innerHTML = Icons.logo();
    U.$('rail-logo').innerHTML = Icons.logo();
    U.$('mode-login').innerHTML = Icons.svg('user') + 'Email &amp; password';
    U.$('mode-key').innerHTML = Icons.svg('key') + 'API key';
    buildRail();
    Viewer.init();
    grid = new Grid(U.$('grid'), {
      onSelect: select,
      rowHeight: rowHeight,
      onNeedMore: function () { loadMore(); },
      onPointer: pointer,
      onFocus: function (item) {
        var v = view();
        U.$('when').textContent = v && v.kind === 'assets' && item.date ? U.fmtMonthLong(item.date.substr(0, 7)) : '';
      }
    });

    U.$('connect').onclick = function () { connect(); };
    U.$('chip-http').onclick = U.$('chip-https').onclick = U.$('chip-port').onclick = function () { applyChip(this.id); };
    U.$('mode-login').onclick = function () { setMode('login'); };
    U.$('mode-key').onclick = function () { setMode('key'); };
    document.addEventListener('keydown', onKey, false);

    server = Store.get('server', '');
    key = Store.get('apiKey', '');
    token = Store.get('token', '');
    setMode(Store.get('authMode', 'login'));
    if (server && (key || token)) {
      client = new Immich.Client(server, key, token);
      showScreen('browse');
      setStatus('Connecting', 'loading');
      Net.via(server, function (apiBase) {
        client.apiBase = apiBase;
        openRail('photos');
        loadAccountName();
      });
    } else {
      showSetup();
    }
  }

  start();
})();
