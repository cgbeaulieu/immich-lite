/* Immich REST client (checked against server v3.3.1). ES5 + XMLHttpRequest only.

   The API key is sent as the ?apiKey= query parameter, not the x-api-key header.
   A custom header turns every call into a CORS preflight, and <img> tags can't
   send headers at all. Immich accepts either (server/src/services/auth.service.ts).

   Assets are passed around the app as small objects:
   {id, isImage, isFavorite, date: 'YYYY-MM-DD' (local day it was taken)}. */
var Immich = (function () {
  'use strict';

  var PAGE_SIZE = 100;

  function Client(server, apiKey) {
    this.server = String(server || '').replace(/\/+$/, '');
    this.apiKey = apiKey || '';
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
    return this.server + '/api' + path + (q.length ? '?' + q.join('&') : '');
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
  Client.prototype.mapMarkers = function (cb) { this.get('/map/markers', null, cb); };

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
     {visibility: 'timeline'}, {albumIds: [id]}, {personIds: [id]} or {city: 'Banff'}. */
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
    return this.url('/assets/' + encodeURIComponent(id) + '/thumbnail', { size: size || 'thumbnail' });
  };

  Client.prototype.personThumbUrl = function (id) {
    return this.url('/people/' + encodeURIComponent(id) + '/thumbnail');
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
        date: U.localDay(cols.fileCreatedAt ? cols.fileCreatedAt[i] : null, cols.localOffsetHours ? cols.localOffsetHours[i] : 0)
      });
    }
    return out;
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
        date: String(a.localDateTime || a.fileCreatedAt || '').substr(0, 10)
      });
    }
    return out;
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

  return { Client: Client };
})();
