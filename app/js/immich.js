/* Immich REST client (checked against server v3.3.1). ES5 + XMLHttpRequest only.

   The API key is sent as the ?apiKey= query parameter, not the x-api-key header.
   A custom header turns every call into a CORS preflight, and <img> tags can't
   send headers at all. Immich accepts either (server/src/services/auth.service.ts). */
var Immich = (function () {
  'use strict';

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

  Client.prototype.request = function (method, path, params, body, cb) {
    var xhr = new XMLHttpRequest();
    var finished = false;
    function finish(err, data) {
      if (!finished) { finished = true; cb(err, data); }
    }
    xhr.open(method, this.url(path, params), true);
    xhr.timeout = 20000;
    xhr.onreadystatechange = function () {
      var data;
      if (xhr.readyState !== 4) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { data = JSON.parse(xhr.responseText); } catch (e) { return finish(fail(xhr.status, 'The server sent something that is not JSON')); }
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

  Client.prototype.ping = function (cb) { this.get('/server/ping', null, cb); };
  Client.prototype.me = function (cb) { this.get('/users/me', null, cb); };
  Client.prototype.version = function (cb) { this.get('/server/version', null, cb); };
  Client.prototype.albums = function (cb) { this.get('/albums', null, cb); };

  /* [{timeBucket: '2024-05-01T00:00:00.000Z', count: 42}, ...] */
  Client.prototype.buckets = function (filter, cb) { this.get('/timeline/buckets', filter, cb); };

  Client.prototype.bucket = function (timeBucket, filter, cb) {
    var p = {}, k;
    for (k in filter) { if (filter.hasOwnProperty(k)) { p[k] = filter[k]; } }
    p.timeBucket = timeBucket;
    this.get('/timeline/bucket', p, function (err, cols) {
      if (err) { return cb(err); }
      cb(null, unzip(cols));
    });
  };

  /* Random photos for shuffle, as asset objects shaped like unzip()'s.
     albumId is optional; without it the whole timeline is used. */
  Client.prototype.randomPhotos = function (albumId, count, cb) {
    var body = { size: count, type: 'IMAGE' };
    if (albumId) { body.albumIds = [albumId]; } else { body.visibility = 'timeline'; }
    this.post('/search/random', body, function (err, list) {
      var out = [], i;
      if (err) { return cb(err); }
      for (i = 0; i < (list || []).length; i++) {
        out.push({ id: list[i].id, isImage: list[i].type === 'IMAGE', ratio: 1, date: list[i].localDateTime || list[i].fileCreatedAt });
      }
      cb(null, out);
    });
  };

  /* size: 'thumbnail' (small webp, for the grid) or 'preview' (large jpeg, for full screen). */
  Client.prototype.thumbUrl = function (id, size) {
    return this.url('/assets/' + encodeURIComponent(id) + '/thumbnail', { size: size || 'thumbnail' });
  };

  /* /timeline/bucket answers with parallel arrays (id[], isImage[], ...).
     Turn them into one object per asset. */
  function unzip(cols) {
    var out = [], ids = (cols && cols.id) || [], i;
    for (i = 0; i < ids.length; i++) {
      out.push({
        id: ids[i],
        isImage: cols.isImage ? cols.isImage[i] : true,
        ratio: cols.ratio ? cols.ratio[i] : 1,
        date: cols.fileCreatedAt ? cols.fileCreatedAt[i] : null
      });
    }
    return out;
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
    if (xhr.status === 403) { return 'The API key is missing a permission this needs (403)'; }
    try { body = JSON.parse(xhr.responseText); } catch (e) { body = null; }
    return (body && body.message ? body.message + ' ' : 'Server error ') + '(' + xhr.status + ')';
  }

  return { Client: Client };
})();
