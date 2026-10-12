/* Phone sign-in for immich lite: the web server the phone talks to.

   While the sign-in screen is up, the TV runs this small server on the home network.
   The QR code on the TV opens it on a phone, already carrying the pairing code. The
   phone sends the immich address and the email + password (or an API key); the app
   collects them by polling and signs in, then reports back so the phone can say
   whether it worked.

   Safety: the server only takes credentials with the code shown on the TV, gives
   up after a few wrong codes, stops by itself after 10 minutes, and keeps the
   credentials in memory only until the app picks them up.

   Runs on webOS 3's Node 0.12, so ES5 only and no newer Node APIs. service.js wires
   it to the webOS service bus; the same object is used by tools/test_pairing.js. */
'use strict';

var http = require('http');
var os = require('os');
var crypto = require('crypto');
var trail = require('./trail');

var FIRST_PORT = 8790;          // immich webOS uses 8788; keep clear of it
var PORT_TRIES = 6;
var LIFETIME_MS = 10 * 60 * 1000;
var MAX_BODY = 8192;
var MAX_WRONG = 8;              // wrong codes before the server stops listening to submits
var ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L

function Pairing(options) {
  this.page = options.page;     // the phone page's HTML
  this.port = options.port || FIRST_PORT;
  this.server = null;
  this.reset();
}

Pairing.prototype.reset = function () {
  this.code = '';
  this.credentials = null;
  this.result = null;           // {ok, message} once the TV has tried them
  this.prefill = '';
  this.expires = 0;
  this.wrong = 0;
};

/* Starts listening (if not already) with a fresh code. cb(err, info) */
Pairing.prototype.start = function (params, cb) {
  var self = this;
  self.reset();
  self.code = newCode();
  trail.add('sign-in screen up: new code');
  self.prefill = params && typeof params.server === 'string' ? params.server : '';
  self.expires = Date.now() + LIFETIME_MS;
  if (self.server) { return cb(null, self.info()); }
  self.listen(self.port, PORT_TRIES, function (err) {
    if (err) { return cb(err); }
    cb(null, self.info());
  });
};

Pairing.prototype.info = function () {
  return {
    code: this.code.substr(0, 4) + '-' + this.code.substr(4),
    url: 'http://' + lanAddress() + ':' + this.port + '/?c=' + this.code,
    expiresIn: Math.max(0, this.expires - Date.now())
  };
};

Pairing.prototype.expired = function () { return !this.code || Date.now() > this.expires; };

/* The app asks for credentials: each set is handed over once. */
Pairing.prototype.poll = function () {
  var c;
  if (this.expired()) { return { state: 'expired' }; }
  if (this.credentials) {
    c = this.credentials;
    trail.add('TV picked up the details');
    this.credentials = null;
    return { state: 'received', credentials: c };
  }
  return { state: 'waiting' };
};

/* The app says whether signing in worked, for the phone to show. */
Pairing.prototype.report = function (ok, message) {
  this.result = { ok: !!ok, message: String(message || '') };
  trail.add('TV reports: ' + (ok ? 'signed in' : 'failed: ' + this.result.message));
};

Pairing.prototype.stop = function () {
  if (this.server) {
    try { this.server.close(); } catch (e) { /* already closed */ }
    this.server = null;
  }
  this.reset();
};

Pairing.prototype.listen = function (port, tries, cb) {
  var self = this, server = http.createServer(function (req, res) { self.handle(req, res); });
  server.once('error', function (err) {
    if (err.code === 'EADDRINUSE' && tries > 1) { return self.listen(port + 1, tries - 1, cb); }
    cb(err);
  });
  server.listen(port, function () {
    self.server = server;
    self.port = port;
    cb(null);
  });
};

// ---------- the phone's side ----------

Pairing.prototype.handle = function (req, res) {
  var self = this, path = req.url.split('?')[0];
  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    return send(res, 200, 'text/html; charset=utf-8', self.page);
  }
  if (req.method === 'GET' && path === '/info') {
    return json(res, 200, { server: self.prefill, expired: self.expired() });
  }
  if (req.method === 'GET' && path === '/log') {
    return json(res, 200, trail.list());
  }
  if (req.method === 'GET' && path === '/status') {
    return json(res, 200, { result: self.result });
  }
  if (req.method === 'POST' && path === '/submit') {
    return readJson(req, function (err, body) {
      if (err) { return json(res, 400, { error: 'That request could not be read' }); }
      self.submit(body, function (status, out) { json(res, status, out); });
    });
  }
  json(res, 404, { error: 'Not found' });
};

Pairing.prototype.submit = function (b, done) {
  var code = String(b.code || '').toUpperCase().replace(/[^0-9A-Z]/g, ''), server = withScheme(b.server);
  if (this.expired()) { return done(410, { error: 'This code has expired. Look at the TV for a new one.' }); }
  if (this.wrong >= MAX_WRONG) { return done(429, { error: 'Too many wrong codes. Restart sign-in on the TV.' }); }
  if (code !== this.code) {
    this.wrong++;
    return done(403, { error: 'That code doesn’t match the one on the TV.' });
  }
  if (!/^https?:\/\/[^\s]+$/i.test(server)) {
    return done(400, { error: 'The server address must start with http:// or https://' });
  }
  server = server.replace(/\/+$/, '');
  if (b.apiKey) {
    this.credentials = { server: server, apiKey: String(b.apiKey).trim() };
    trail.add('phone sent an API key for ' + server);
  } else if (b.email && b.password) {
    this.credentials = { server: server, email: String(b.email).trim(), password: String(b.password) };
    trail.add('phone sent email ' + trail.maskEmail(b.email) + ' and a password for ' + server);
  } else {
    return done(400, { error: 'Enter your email and password, or an API key.' });
  }
  this.result = null; // a fresh attempt
  done(200, { ok: true });
};

// ---------- helpers ----------

/* "mediaserver:2283" -> "http://mediaserver:2283" (most home servers are plain http). */
function withScheme(address) {
  var s = String(address || '').trim();
  return s && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? 'http://' + s : s;
}

function newCode() {
  var bytes = crypto.randomBytes(8), out = '', i;
  for (i = 0; i < 8; i++) { out += ALPHABET.charAt(bytes[i] % ALPHABET.length); }
  return out;
}

/* The TV's address on the home network, for the QR code. */
function lanAddress() {
  var nets = os.networkInterfaces(), names = Object.keys(nets), best = null, i, j, a;
  for (i = 0; i < names.length; i++) {
    for (j = 0; j < nets[names[i]].length; j++) {
      a = nets[names[i]][j];
      if (a.family !== 'IPv4' || a.internal) { continue; }
      if (/^(eth|wlan|wl|en)/.test(names[i])) { return a.address; }
      if (!best) { best = a.address; }
    }
  }
  return best || '127.0.0.1';
}

function readJson(req, cb) {
  var chunks = [], size = 0, failed = false;
  req.on('data', function (c) {
    size += c.length;
    if (size > MAX_BODY && !failed) { failed = true; cb(new Error('too big')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', function () {
    var body;
    if (failed) { return; }
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return cb(e); }
    cb(null, body && typeof body === 'object' ? body : {});
  });
}

function send(res, status, type, text) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(text);
}

function json(res, status, data) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
}

module.exports = Pairing;
