/* immich REST client (checked against server v3.3.1). ES5 + XMLHttpRequest only.

   The API key is sent as the ?apiKey= query parameter, not the x-api-key header.
   A custom header turns every call into a CORS preflight, and <img> tags can't
   send headers at all. immich accepts either (server/src/services/auth.service.ts).

   Assets are passed around the app as small objects:
   {id, isImage, isFavorite, date: 'YYYY-MM-DD' (local day it was taken),
    duration: ms (videos; 0 if unknown), ratio: width / height}. */
var Immich = (function () {
  'use strict';

  var PAGE_SIZE = 100;

  /* auth: an API key, or the access token from signing in with email and password
     ({token: '...'}). A token is sent as ?sessionKey=, which immich accepts the same
     way as ?apiKey= (auth.service.ts), so <img> tags keep working. */
  function Client(server, apiKey, token) {
    this.server = String(server || '').replace(/\/+$/, '');
    this.apiKey = apiKey || '';
    this.token = token || '';
  }

  Client.prototype.url = function (path, params) {
    var q = [], k;
    params = params || {};
    for (k in params) {
      if (params.hasOwnProperty(k) && params[k] !== undefined && params[k] !== null && params[k] !== '') {
        q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    }
    if (this.apiKey) { q.push('apiKey=' + encodeURIComponent(this.apiKey)); }
    else if (this.token) { q.push('sessionKey=' + encodeURIComponent(this.token)); }
    return (this.apiBase || this.server) + '/api' + path + (q.length ? '?' + q.join('&') : '');
  };

  /* Photos and videos load straight from the server; only JSON calls take apiBase
     (the TV's relay, see net.js). */
  Client.prototype.mediaUrl = function (path, params) {
    var base = this.apiBase, u;
    this.apiBase = null;
    u = this.url(path, params);
    this.apiBase = base;
    return u;
  };

  Client.prototype.get = function (path, params, cb) { this.request('GET', path, params, null, cb); };
  Client.prototype.post = function (path, body, cb) { this.request('POST', path, null, body, cb); };
  Client.prototype.put = function (path, body, cb) { this.request('PUT', path, null, body, cb); };

  Client.prototype.request = function (method, path, params, body, cb) {
    var xhr = new XMLHttpRequest();
    var finished = false;
    function finish(err, data) {
      if (!finished) { finished = true; cb(err, data); }
    }
    xhr.open(method, this.url(path, params), true);
    xhr.timeout = 30000;
    xhr.onreadystatechange = function () {
      var data = null;
      if (xhr.readyState !== 4) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (xhr.responseText) { // 204 No Content has no body
          try { data = JSON.parse(xhr.responseText); } catch (e) { return finish(fail(xhr.status, 'The server sent something that is not JSON')); }
        }
        finish(null, data);
      } else {
        finish(fail(xhr.status, describe(xhr)));
      }
    };
    xhr.ontimeout = function () { finish(fail(0, 'The server took too long to answer')); };
    if (body) {
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(body));
    } else {
      xhr.send();
    }
  };

  // ---------- account / server ----------

  Client.prototype.me = function (cb) { this.get('/users/me', null, cb); };
  Client.prototype.version = function (cb) { this.get('/server/version', null, cb); };

  /* Your own library: {images, videos, total} (needs asset.statistics). With no
     visibility given, immich counts the timeline and the archive, not the trash. */
  Client.prototype.assetStats = function (cb) { this.get('/assets/statistics', null, cb); };

  /* The server's disk: {diskSizeRaw, diskUseRaw, diskUsagePercentage, ...}
     (needs server.storage; not admin-only). */
  Client.prototype.serverStorage = function (cb) { this.get('/server/storage', null, cb); };

  // ---------- stacks ----------

  /* A stack's members (burst shots, edits) as assets, the primary (the one the
     timeline shows) first. */
  Client.prototype.stack = function (id, cb) {
    this.get('/stacks/' + encodeURIComponent(id), null, function (err, s) {
      var list, i, primary = [], rest = [];
      if (err) { return cb(err); }
      list = (s && s.assets) || [];
      for (i = 0; i < list.length; i++) {
        if (list[i].isTrashed) { continue; }
        (list[i].id === s.primaryAssetId ? primary : rest).push(list[i]);
      }
      cb(null, fromDtos(primary.concat(rest)));
    });
  };

  // ---------- timeline ----------

  /* [{timeBucket: '2024-05-01T00:00:00.000Z', count: 42}, ...] */
  Client.prototype.buckets = function (filter, cb) { this.get('/timeline/buckets', filter, cb); };

  Client.prototype.bucket = function (timeBucket, filter, cb) {
    var p = copy(filter);
    p.timeBucket = timeBucket;
    this.get('/timeline/bucket', p, function (err, cols) {
      if (err) { return cb(err); }
      cb(null, unzip(cols));
    });
  };

  // ---------- collections ----------

  Client.prototype.albums = function (cb) { this.get('/albums', null, cb); };

  Client.prototype.people = function (cb) {
    this.get('/people', { withHidden: false, size: 500 }, function (err, res) {
      cb(err, err ? null : (res && res.people) || []);
    });
  };

  /* One entry per city: {city, country, assetId} (assetId is a cover photo). */
  Client.prototype.places = function (cb) {
    this.get('/search/cities', null, function (err, list) {
      var out = [], i, ex;
      if (err) { return cb(err); }
      for (i = 0; i < (list || []).length; i++) {
        ex = list[i].exifInfo || {};
        if (ex.city) { out.push({ city: ex.city, country: ex.country || '', assetId: list[i].id }); }
      }
      out.sort(function (a, b) { return a.city < b.city ? -1 : (a.city > b.city ? 1 : 0); });
      cb(null, out);
    });
  };

  /* Today's "on this day" memories: [{title, assets: [asset]}] */
  Client.prototype.memories = function (cb) {
    this.get('/memories', { 'for': new Date().toISOString() }, function (err, list) {
      var out = [], i, m, years, assets;
      if (err) { return cb(err); }
      for (i = 0; i < (list || []).length; i++) {
        m = list[i];
        assets = fromDtos(m.assets || []);
        if (!assets.length) { continue; }
        years = m.data && m.data.year ? new Date().getFullYear() - m.data.year : 0;
        out.push({ title: years > 0 ? (years === 1 ? '1 year ago' : years + ' years ago') : 'Memory', assets: assets });
      }
      cb(null, out);
    });
  };

  /* [{id, lat, lon, city}] for every photo with a location. */
  Client.prototype.mapMarkers = function (withPartners, cb) {
    this.get('/map/markers', withPartners ? { withPartners: true } : null, cb);
  };

  /* People who share their library with you: [{id, name, email, inTimeline}]. immich
     only mixes a partner's photos into your timeline (and search, map...) when
     inTimeline is on, the "Show in timeline" switch in immich's partner settings. */
  Client.prototype.partners = function (cb) { this.get('/partners', { direction: 'shared-with' }, cb); };

  Client.prototype.setPartnerInTimeline = function (id, on, cb) {
    this.put('/partners/' + encodeURIComponent(id), { inTimeline: on }, cb);
  };

  // ---------- library: folders and tags ----------

  /* Every folder that directly holds assets, as full paths: ['/photos/2024/Trip', ...]. */
  Client.prototype.folderPaths = function (cb) { this.get('/view/folder/unique-paths', null, cb); };

  /* The assets directly in one folder (not its subfolders), all in one answer. */
  Client.prototype.folderAssets = function (path, cb) {
    this.get('/view/folder', { path: path }, function (err, list) {
      cb(err, err ? null : fromDtos(list || []));
    });
  };

  /* [{id, name: 'Canada', value: 'Places/Canada' (full path), parentId}] */
  Client.prototype.tags = function (cb) { this.get('/tags', null, cb); };

  // ---------- search ----------

  /* Smart (CLIP) search: cb(err, assets, nextPage) */
  Client.prototype.searchSmart = function (query, page, cb) {
    this.post('/search/smart', { query: query, page: page, size: PAGE_SIZE }, searchResult(cb));
  };

  /* Metadata search, e.g. {city: 'Banff'}: cb(err, assets, nextPage) */
  Client.prototype.searchMetadata = function (filter, page, cb) {
    var body = copy(filter);
    body.page = page;
    body.size = PAGE_SIZE;
    body.order = 'desc';
    this.post('/search/metadata', body, searchResult(cb));
  };

  /* Random photos for shuffle. filter is a search filter such as
     {visibility: 'timeline'}, {albumIds: [id]}, {personIds: [id]}, {tagIds: [id]} or {city: 'Banff'}. */
  Client.prototype.randomPhotos = function (filter, count, cb) {
    var body = copy(filter);
    body.size = count;
    body.type = 'IMAGE';
    this.post('/search/random', body, function (err, list) {
      cb(err, err ? null : fromDtos(list || []));
    });
  };

  // ---------- changes ----------

  Client.prototype.setFavorite = function (ids, on, cb) {
    this.put('/assets', { ids: ids, isFavorite: on }, cb);
  };

  /* rating: 1-5, or null to clear it (v3 no longer accepts 0). */
  Client.prototype.setRating = function (ids, rating, cb) {
    this.put('/assets', { ids: ids, rating: rating }, cb);
  };

  /* cb(err, [{id, success, error}]); error 'duplicate' means it was already in the album. */
  Client.prototype.addToAlbum = function (albumId, ids, cb) {
    this.put('/albums/' + encodeURIComponent(albumId) + '/assets', { ids: ids }, cb);
  };

  // ---------- one asset ----------

  /* The full AssetResponseDto: exifInfo (camera, place, rating...) and people. */
  Client.prototype.asset = function (id, cb) { this.get('/assets/' + encodeURIComponent(id), null, cb); };

  // ---------- images ----------

  /* size: 'thumbnail' (small webp, for the grid) or 'preview' (large jpeg, for full screen). */
  Client.prototype.thumbUrl = function (id, size) {
    return this.mediaUrl('/assets/' + encodeURIComponent(id) + '/thumbnail', { size: size || 'thumbnail' });
  };

  Client.prototype.personThumbUrl = function (id) {
    return this.mediaUrl('/people/' + encodeURIComponent(id) + '/thumbnail');
  };

  // ---------- video ----------

  /* The video for a <video> tag. immich serves its transcoded copy here (H.264 MP4 by
     default, which the TV decodes in hardware) and supports range requests for seeking. */
  Client.prototype.videoUrl = function (id) {
    return this.mediaUrl('/assets/' + encodeURIComponent(id) + '/video/playback');
  };

  // ---------- helpers ----------

  function copy(obj) {
    var out = {}, k;
    for (k in obj) { if (obj.hasOwnProperty(k)) { out[k] = obj[k]; } }
    return out;
  }

  /* /timeline/bucket answers with parallel arrays (id[], isImage[], ...).
     Turn them into one object per asset. */
  function unzip(cols) {
    var out = [], ids = (cols && cols.id) || [], i;
    for (i = 0; i < ids.length; i++) {
      out.push({
        id: ids[i],
        isImage: cols.isImage ? cols.isImage[i] : true,
        isFavorite: cols.isFavorite ? !!cols.isFavorite[i] : false,
        date: U.localDay(cols.fileCreatedAt ? cols.fileCreatedAt[i] : null, cols.localOffsetHours ? cols.localOffsetHours[i] : 0),
        duration: cols.duration ? durationMs(cols.duration[i]) : 0,
        ratio: cols.ratio && cols.ratio[i] > 0 ? cols.ratio[i] : 1
      });
    }
    addStacks(cols, out);
    return out;
  }

  /* With withStacked=true the bucket has a stack column: [stackId, count] (count as
     a string) for a stack's primary photo, null otherwise. The other members are
     left out of the timeline. */
  function addStacks(cols, out) {
    var st = (cols && cols.stack) || [], i;
    for (i = 0; i < out.length; i++) {
      out[i].stackId = st[i] ? st[i][0] : null;
      out[i].stackCount = st[i] ? parseInt(st[i][1], 10) || 0 : 0;
    }
  }

  /* Full asset objects (search, random, memories). localDateTime is already the
     local time, written as if it were UTC. */
  function fromDtos(list) {
    var out = [], i, a;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      out.push({
        id: a.id,
        isImage: a.type === 'IMAGE',
        isFavorite: !!a.isFavorite,
        date: String(a.localDateTime || a.fileCreatedAt || '').substr(0, 10),
        duration: durationMs(a.duration),
        ratio: a.width > 0 && a.height > 0 ? a.width / a.height : 1
      });
    }
    return out;
  }

  /* A video's length in ms (0 if unknown). v3 sends milliseconds; older servers
     sent a string like "0:00:12.345000". */
  function durationMs(v) {
    var m;
    if (typeof v === 'number') { return v; }
    m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(v || ''));
    return m ? Math.round(((parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 60 + parseFloat(m[3])) * 1000) : 0;
  }

  function searchResult(cb) {
    return function (err, res) {
      var assets = res && res.assets;
      if (err) { return cb(err); }
      cb(null, fromDtos((assets && assets.items) || []), assets && assets.nextPage ? parseInt(assets.nextPage, 10) : null);
    };
  }

  function fail(status, message) {
    var e = new Error(message);
    e.status = status;
    return e;
  }

  function describe(xhr) {
    var body;
    if (xhr.status === 0) { return 'Could not reach the server (offline, wrong address, or blocked by CORS)'; }
    if (xhr.status === 401) { return 'The server rejected the API key (401)'; }
    if (xhr.status === 403) { return 'The API key is missing a permission this needs (403). Create a key with all permissions.'; }
    try { body = JSON.parse(xhr.responseText); } catch (e) { body = null; }
    return (body && body.message ? body.message + ' ' : 'Server error ') + '(' + xhr.status + ')';
  }

  /* Signs in with email and password: cb(err, {accessToken, name, userEmail, ...}). */
  /* apiBase (optional): where to send the call, see net.js. */
  function login(server, email, password, cb, apiBase) {
    var c = new Client(server);
    c.apiBase = apiBase || null;
    c.post('/auth/login', { email: email, password: password }, function (err, res) {
      if (err && err.status === 401) { err.message = 'Wrong email or password'; }
      if (!err && (!res || !res.accessToken)) { err = fail(0, 'The server did not sign you in'); }
      cb(err, res);
    });
  }

  /* Ends a signed-in session on the server (API keys stay valid until deleted). */
  Client.prototype.logout = function (cb) {
    if (!this.token) { return cb && cb(null); }
    this.post('/auth/logout', {}, function (err) { if (cb) { cb(err); } });
  };

  return { Client: Client, login: login };
})();
