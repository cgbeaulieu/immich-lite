/* Tests the phone sign-in server (service/pairing.js) on a PC: a real HTTP server,
   with this script playing both the phone and the app.

     node tools/test_pairing.js

   Written in ES5 like the service, which runs on webOS 3's Node 0.12. */
'use strict';

var http = require('http');
var path = require('path');
var assert = require('assert');
var Pairing = require(path.join(__dirname, '..', 'service', 'pairing.js'));

var pairing = new Pairing({ page: '<html>phone page</html>', port: 18790 });
var steps = [], passed = 0;

function request(method, url, body, cb) {
  var data = body ? JSON.stringify(body) : null;
  var req = http.request({ host: '127.0.0.1', port: pairing.port, path: url, method: method,
    headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, function (res) {
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () {
      var text = Buffer.concat(chunks).toString('utf8'), json = null;
      try { json = JSON.parse(text); } catch (e) { json = null; }
      cb(res.statusCode, json, text);
    });
  });
  req.on('error', function (e) { cb(0, null, String(e)); });
  if (data) { req.write(data); }
  req.end();
}

function step(name, fn) { steps.push({ name: name, fn: fn }); }

function run(i) {
  if (i >= steps.length) {
    pairing.stop();
    console.log('\nAll ' + passed + ' checks passed.');
    return;
  }
  steps[i].fn(function () {
    passed++;
    console.log('ok  ' + steps[i].name);
    run(i + 1);
  });
}

var info, code;

step('start gives a code and a URL with it', function (next) {
  pairing.start({ server: 'http://192.168.8.145:2283' }, function (err, i) {
    assert.ifError(err);
    info = i;
    code = i.code.replace('-', '');
    assert(/^[23456789A-HJKMNP-Z]{4}-[23456789A-HJKMNP-Z]{4}$/.test(i.code), 'code format: ' + i.code);
    assert(i.url.indexOf(':18790/?c=' + code) > 0, 'url: ' + i.url);
    next();
  });
});

step('the phone page is served', function (next) {
  request('GET', '/?c=' + code, null, function (status, json, text) {
    assert.equal(status, 200);
    assert.equal(text, '<html>phone page</html>');
    next();
  });
});

step('/info pre-fills the server the TV knows', function (next) {
  request('GET', '/info', null, function (status, json) {
    assert.equal(status, 200);
    assert.equal(json.server, 'http://192.168.8.145:2283');
    assert.equal(json.expired, false);
    next();
  });
});

step('the app polls: nothing yet', function (next) {
  assert.equal(pairing.poll().state, 'waiting');
  next();
});

step('a wrong code is refused', function (next) {
  request('POST', '/submit', { code: 'AAAA-AAAA', server: 'http://x:2283', email: 'a@b.c', password: 'p' }, function (status, json) {
    assert.equal(status, 403);
    assert(/match/.test(json.error));
    assert.equal(pairing.poll().state, 'waiting');
    next();
  });
});

step('a bad server address is refused', function (next) {
  request('POST', '/submit', { code: code, server: 'ftp://nope', email: 'a@b.c', password: 'p' }, function (status, json) {
    assert.equal(status, 400);
    next();
  });
});

step('missing password is refused', function (next) {
  request('POST', '/submit', { code: code, server: 'http://x:2283', email: 'a@b.c' }, function (status) {
    assert.equal(status, 400);
    next();
  });
});

step('the right code (lower case, with a dash) is accepted', function (next) {
  var typed = (code.substr(0, 4) + '-' + code.substr(4)).toLowerCase();
  request('POST', '/submit', { code: typed, server: 'http://192.168.8.145:2283/', email: ' me@example.com ', password: 'secret' }, function (status, json) {
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    next();
  });
});

step('the app receives them once, cleaned up', function (next) {
  var r = pairing.poll();
  assert.equal(r.state, 'received');
  assert.deepEqual(r.credentials, { server: 'http://192.168.8.145:2283', email: 'me@example.com', password: 'secret' });
  assert.equal(pairing.poll().state, 'waiting');
  next();
});

step('the phone sees the TV\'s result', function (next) {
  request('GET', '/status', null, function (s1, before) {
    assert.equal(before.result, null);
    pairing.report(false, 'Wrong email or password');
    request('GET', '/status', null, function (s2, after) {
      assert.deepEqual(after.result, { ok: false, message: 'Wrong email or password' });
      next();
    });
  });
});

step('an address without http:// gets it added', function (next) {
  request('POST', '/submit', { code: code, server: 'mediaserver:2283', email: 'a@b.c', password: 'p' }, function (status) {
    assert.equal(status, 200);
    assert.equal(pairing.poll().credentials.server, 'http://mediaserver:2283');
    next();
  });
});

step('an API key works too, and a resend clears the old result', function (next) {
  request('POST', '/submit', { code: code, server: 'https://photos.example.com', apiKey: ' key123 ' }, function (status) {
    assert.equal(status, 200);
    assert.deepEqual(pairing.poll().credentials, { server: 'https://photos.example.com', apiKey: 'key123' });
    request('GET', '/status', null, function (s, json) {
      assert.equal(json.result, null);
      next();
    });
  });
});

step('too many wrong codes locks submitting', function (next) {
  var left = 8;
  (function wrong() {
    request('POST', '/submit', { code: 'ZZZZ-ZZZZ', server: 'http://x', email: 'a', password: 'b' }, function () {
      if (--left > 0) { return wrong(); }
      request('POST', '/submit', { code: code, server: 'http://x:2283', email: 'a', password: 'b' }, function (status) {
        assert.equal(status, 429);
        next();
      });
    });
  })();
});

step('restart gives a new code and unlocks', function (next) {
  pairing.start({}, function (err, i) {
    assert.ifError(err);
    assert.notEqual(i.code.replace('-', ''), code);
    code = i.code.replace('-', '');
    request('POST', '/submit', { code: code, server: 'http://x:2283', email: 'a', password: 'b' }, function (status) {
      assert.equal(status, 200);
      next();
    });
  });
});

step('an expired code is refused and polling says so', function (next) {
  pairing.expires = Date.now() - 1;
  assert.equal(pairing.poll().state, 'expired');
  request('POST', '/submit', { code: code, server: 'http://x:2283', email: 'a', password: 'b' }, function (status) {
    assert.equal(status, 410);
    next();
  });
});

step('an oversized body is rejected', function (next) {
  pairing.expires = Date.now() + 60000;
  request('POST', '/submit', { code: code, server: 'http://x', email: 'a', password: new Array(10000).join('x') }, function (status) {
    assert(status === 400 || status === 0, 'status ' + status);
    next();
  });
});

step('stop closes the server', function (next) {
  pairing.stop();
  request('GET', '/info', null, function (status) {
    assert.equal(status, 0);
    next();
  });
});

run(0);
