/* Where the app's API calls go.

   On the TV the app is a file:// page, and immich sends no CORS headers, so the TV's
   web engine blocks reading immich's replies. There the calls go through a small relay
   in the app's own webOS service (service/proxy.js) on 127.0.0.1, which adds the
   headers. Photos and videos still load from immich directly.

   In a desktop browser the dev server already serves the API on the page's own origin,
   so calls go straight to the server. */
var Net = (function () {
  'use strict';

  var SERVICE = 'luna://com.cgbeaulieu.immichlite.service/proxy';
  var bridge = null, target = null, base = null, waiting = [];

  /* cb(apiBase): the address to send the server's API calls to. */
  function via(server, cb) {
    server = String(server || '').replace(/\/+$/, '');
    if (typeof PalmServiceBridge === 'undefined') { return cb(server); }
    if (server === target && base) { return cb(base); }
    waiting.push(cb);
    if (server === target && bridge) { return; } // already asking
    open(server);
  }

  /* The subscription stays open while the app runs: it keeps the service, and so the
     relay, alive. webOS cancels it when the app closes. */
  function open(server) {
    var b = new PalmServiceBridge();
    if (bridge) { try { bridge.cancel(); } catch (e) { /* already gone */ } }
    bridge = b;
    target = server;
    base = null;
    b.onservicecallback = function (msg) {
      var r;
      if (b !== bridge) { return; } // replaced by a newer server
      try { r = JSON.parse(msg); } catch (e) { r = { returnValue: false }; }
      if (r.returnValue !== false && r.port) {
        base = 'http://127.0.0.1:' + r.port;
        return flush(base);
      }
      // No relay (e.g. the service couldn't start): try the server directly, so the
      // error the user sees is immich's, not ours. A later call asks again.
      bridge = null;
      base = null;
      flush(server);
    };
    b.call(SERVICE, JSON.stringify({ target: server, subscribe: true }));
  }

  function flush(address) {
    var list = waiting;
    waiting = [];
    for (var i = 0; i < list.length; i++) { list[i](address); }
  }

  return { via: via };
})();
