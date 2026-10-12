/* Tests the TV's API relay (service/proxy.js) on a PC, against the dev server's mock:

     python tools/devserver.py --mock --port 8012
     node tools/test_proxy.js [http://127.0.0.1:8012]

   ES5 like the service, which runs on webOS 3's Node 0.12. */
'use strict';

var http = require('http');
var path = require('path');
var assert = require('assert');
var Proxy = require(path.join(__dirname, '..', 'service', 'proxy.js'));

var target = process.argv[2] || 'http://127.0.0.1:8012';
var proxy = new Proxy({ port: 18791 });

function request(method, url, body, headers, cb) {
  var data = body ? JSON.stringify(body) : null, h = headers || {};
  if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
  var req = http.request({ host: '127.0.0.1', port: proxy.port, path: url, method: method, headers: h }, function (res) {
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () {
      var text = Buffer.concat(chunks).toString('utf8'), json = null;
      try { json = JSON.parse(text); } catch (e) { json = null; }
      cb(res.statusCode, res.headers, json);
    });
  });
  req.on('error', function (e) { cb(0, {}, String(e)); });
  if (data) { req.write(data); }
  req.end();
}

proxy.start(target, function (err, port) {
  assert.ifError(err);
  console.log('relay on 127.0.0.1:' + port + ' -> ' + target);
  // 1. The browser's CORS check, as the TV's engine sends it for a JSON POST from file://
  request('OPTIONS', '/api/auth/login', null, { Origin: 'null', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type' }, function (s1, h1) {
    assert.equal(s1, 204);
    assert.equal(h1['access-control-allow-origin'], '*');
    assert(/content-type/i.test(h1['access-control-allow-headers']));
    console.log('ok  CORS check answered (204, allow-origin *)');
    // 2. A GET is forwarded and gets the header
    request('GET', '/api/server/version', null, { Origin: 'null' }, function (s2, h2, j2) {
      assert.equal(s2, 200);
      assert.equal(h2['access-control-allow-origin'], '*');
      assert.equal(j2.major, 3);
      console.log('ok  GET forwarded: immich ' + j2.major + '.' + j2.minor + '.' + j2.patch);
      // 3. A JSON POST (sign-in) is forwarded with its body
      request('POST', '/api/auth/login', { email: 'mock@example.test', password: 'mockpass' }, { Origin: 'null' }, function (s3, h3, j3) {
        assert.equal(s3, 200);
        assert(j3 && j3.accessToken, 'token');
        console.log('ok  POST forwarded with its body (signed in)');
        // 4. immich's error codes come through, with the header so the app can read them
        request('GET', '/api/users/me', null, { Origin: 'null' }, function (s4, h4) {
          assert.equal(s4, 401);
          assert.equal(h4['access-control-allow-origin'], '*');
          console.log('ok  errors pass through readable (401)');
          // 5. Only reachable from this machine
          assert.equal(proxy.server.address().address, '127.0.0.1');
          console.log('ok  listens on 127.0.0.1 only');
          proxy.stop();
          console.log('\nAll relay checks passed.');
        });
      });
    });
  });
});
