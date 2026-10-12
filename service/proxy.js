/* The app's API calls on the TV go through this small relay.

   immich sends no CORS headers, and the TV's web engine won't let a packaged app
   (a file:// page) read the replies of a cross-origin request without them. So the
   app sends its JSON calls here instead, on the TV itself, and this forwards them to
   immich and adds the CORS headers on the way back. Photos and videos don't need it:
   <img> and <video> load from immich directly.

   Listens on 127.0.0.1 only, so nothing else on the network can use it. Runs on
   webOS 3's Node 0.12: ES5, no newer Node APIs. */
'use strict';

var http = require('http');
var https = require('https');
var url = require('url');
var trail = require('./trail');

var FIRST_PORT = 8791;
var PORT_TRIES = 6;
var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, x-api-key, Authorization',
  'Access-Control-Max-Age': '600'
};
// Not passed on: hop-by-hop headers, and the TV page's origin (immich doesn't need it).
var MAP_PREFIX = '/_maptiles/';
var MAP_HOST = 'tiles.immich.cloud';
var MAP_PATH = /^\/v1(\/\d{1,2}\/\d{1,6}\/\d{1,6}\.mvt|\.json)$/;
var DROP = { host: 1, origin: 1, referer: 1, connection: 1, 'keep-alive': 1, 'transfer-encoding': 1, te: 1, upgrade: 1 };

function Proxy(options) {
  this.port = (options && options.port) || FIRST_PORT;
  this.server = null;
  this.target = null;           // url.parse() of the immich address
}

/* Points the relay at an immich server and makes sure it's listening. cb(err, port) */
Proxy.prototype.start = function (target, cb) {
  var self = this, t = url.parse(String(target || ''));
  if (!/^https?:$/.test(t.protocol || '') || !t.hostname) { return cb(new Error('The server address must start with http:// or https://')); }
  self.target = t;
  if (self.server) { return cb(null, self.port); }
  self.listen(self.port, PORT_TRIES, function (err) { cb(err, self.port); });
};

Proxy.prototype.stop = function () {
  if (this.server) {
    try { this.server.close(); } catch (e) { /* already closed */ }
    this.server = null;
  }
};

Proxy.prototype.listen = function (port, tries, cb) {
  var self = this, server = http.createServer(function (req, res) { self.handle(req, res); });
  server.once('error', function (err) {
    if (err.code === 'EADDRINUSE' && tries > 1) { return self.listen(port + 1, tries - 1, cb); }
    cb(err);
  });
  server.listen(port, '127.0.0.1', function () {
    self.server = server;
    self.port = port;
    cb(null);
  });
};

Proxy.prototype.handle = function (req, res) {
  var t = this.target, headers = {}, k, out, base, began = Date.now(), what = req.method + ' ' + trail.path(req.url);
  if (req.method === 'OPTIONS') { // the browser's CORS check
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.url.indexOf(MAP_PREFIX) === 0) { return mapTile(req, res, what, began); }
  if (!t) { return fail(res, 503, 'The relay has no server yet'); }
  for (k in req.headers) {
    if (req.headers.hasOwnProperty(k) && !DROP[k]) { headers[k] = req.headers[k]; }
  }
  headers.host = t.host;
  base = (t.pathname || '/').replace(/\/+$/, ''); // immich behind a sub-path keeps it
  out = (t.protocol === 'https:' ? https : http).request({
    protocol: t.protocol, hostname: t.hostname, port: t.port || (t.protocol === 'https:' ? 443 : 80),
    method: req.method, path: base + req.url, headers: headers
  }, function (up) {
    var h = {}, k2;
    for (k2 in up.headers) {
      if (up.headers.hasOwnProperty(k2) && !DROP[k2] && k2.indexOf('access-control-') !== 0) { h[k2] = up.headers[k2]; }
    }
    for (k2 in CORS) { if (CORS.hasOwnProperty(k2)) { h[k2] = CORS[k2]; } }
    res.writeHead(up.statusCode, h);
    trail.add('relay: ' + what + ' -> ' + up.statusCode + ' in ' + (Date.now() - began) + ' ms');
    up.pipe(res);
  });
  out.setTimeout(60000, function () { out.abort(); });
  out.on('error', function (e) {
    trail.add('relay: ' + what + ' failed after ' + (Date.now() - began) + ' ms: ' + e.message);
    fail(res, 502, reachError(e, t));
  });
  req.pipe(out);
};

/* The map's tiles, from immich's own tile server (what immich's web app uses). The
   TV's packaged page sends "Origin: null", which that server answers with an error, so
   the app asks here instead. Only tile and TileJSON paths on that one host are passed
   on: a web page in the TV's browser can reach 127.0.0.1 too, so this must not become
   a way to fetch anything else. */
function mapTile(req, res, what, began) {
  var path = req.url.substr(MAP_PREFIX.length - 1), out;
  if (req.method !== 'GET' || !MAP_PATH.test(path)) { return fail(res, 404, 'Not a map tile'); }
  out = https.get({
    hostname: MAP_HOST, path: path,
    headers: { 'User-Agent': 'immich-lite (+https://github.com/cgbeaulieu/immich-lite)' }
  }, function (up) {
    var h = {}, k;
    for (k in up.headers) {
      if (up.headers.hasOwnProperty(k) && !DROP[k] && k.indexOf('access-control-') !== 0 && k !== 'set-cookie') {
        h[k] = up.headers[k];
      }
    }
    for (k in CORS) { if (CORS.hasOwnProperty(k)) { h[k] = CORS[k]; } }
    res.writeHead(up.statusCode, h);
    if (up.statusCode !== 200) { trail.add('relay: ' + what + ' -> ' + up.statusCode + ' in ' + (Date.now() - began) + ' ms'); }
    up.pipe(res);
  });
  out.setTimeout(30000, function () { out.abort(); });
  out.on('error', function (e) { fail(res, 502, 'Could not reach the map tiles: ' + e.message); });
}

/* Why the TV couldn't reach immich, in words. */
function reachError(e, t) {
  var host = t.hostname;
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
    return 'The TV can\u2019t find "' + host + '". Use the server\u2019s IP address instead (like http://192.168.1.10:2283)';
  }
  if (e.code === 'ECONNREFUSED') { return host + ' turned the connection down. Is immich running, and is the port right?'; }
  if (e.code === 'ETIMEDOUT' || e.code === 'EHOSTUNREACH' || e.code === 'ECONNRESET') {
    return 'The TV couldn\u2019t reach ' + host + '. Is it on and on the same network?';
  }
  return 'Could not reach immich: ' + e.message;
}

function fail(res, status, message) {
  if (res.headersSent) { return res.end(); }
  var h = { 'Content-Type': 'application/json; charset=utf-8' }, k;
  for (k in CORS) { if (CORS.hasOwnProperty(k)) { h[k] = CORS[k]; } }
  res.writeHead(status, h);
  res.end(JSON.stringify({ message: message, statusCode: status }));
}

module.exports = Proxy;
