/* immich lite's webOS service: phone sign-in (see pairing.js).

   The app calls it over the webOS service bus:
     luna://com.cgbeaulieu.immichlite.service/start  {server}   -> {code, url, expiresIn}
     luna://com.cgbeaulieu.immichlite.service/poll              -> {state, credentials?}
     luna://com.cgbeaulieu.immichlite.service/report {ok, message}
     luna://com.cgbeaulieu.immichlite.service/stop
     luna://com.cgbeaulieu.immichlite.service/proxy  {target, subscribe} -> {port}  (proxy.js)
   Runs on webOS 3's Node 0.12 with the TV's built-in webos-service module. */
'use strict';

var fs = require('fs');
var path = require('path');
var Service = require('webos-service');
var Pairing = require('./pairing');
var Proxy = require('./proxy');
var trail = require('./trail');

var service = new Service('com.cgbeaulieu.immichlite.service');
var pairing = new Pairing({ page: fs.readFileSync(path.join(__dirname, 'phone.html'), 'utf8') });
var proxy = new Proxy();
var keepAlive = null;
var proxyUsers = {};            // the app's open 'proxy' subscriptions, by token

/* webOS stops an idle service after a few seconds; an activity keeps the phone's
   web server up while the sign-in screen waits. The app's polling also keeps it up. */
function hold() {
  if (keepAlive) { return; }
  try {
    service.activityManager.create('immichlite-pairing', function (activity) { keepAlive = activity; });
  } catch (e) { /* polling still keeps the service alive */ }
}

function release() {
  if (!keepAlive) { return; }
  try { service.activityManager.complete(keepAlive, function () {}); } catch (e) { /* ignore */ }
  keepAlive = null;
}

service.register('start', function (message) {
  pairing.start(message.payload || {}, function (err, info) {
    if (err) {
      return message.respond({ returnValue: false, errorText: 'Phone sign-in could not start: ' + (err.message || err) });
    }
    hold();
    info.returnValue = true;
    message.respond(info);
  });
});

service.register('poll', function (message) {
  var r = pairing.poll();
  if (r.state === 'expired') { pairing.stop(); if (!hasProxyUsers()) { release(); } }
  r.returnValue = true;
  message.respond(r);
});

service.register('report', function (message) {
  var p = message.payload || {};
  pairing.report(p.ok, p.message);
  message.respond({ returnValue: true });
});

service.register('stop', function (message) {
  pairing.stop();
  if (!hasProxyUsers()) { release(); }
  message.respond({ returnValue: true });
});

/* The API relay (proxy.js): {target, subscribe: true} -> {port}. The app keeps the
   subscription open while it runs, which keeps this service (and the relay) alive;
   when the app closes, webOS cancels it and the relay stops. */
service.register('proxy', function (message) {
  var p = message.payload || {};
  proxy.start(p.target, function (err, port) {
    if (err) { return message.respond({ returnValue: false, errorText: err.message || String(err) }); }
    if (message.isSubscription) {
      proxyUsers[message.uniqueToken] = message;
      trail.add('app opened the relay to ' + p.target);
      hold();
    }
    message.respond({ returnValue: true, port: port, subscribed: !!message.isSubscription });
  });
}, function (message) {
  delete proxyUsers[message.uniqueToken];
  trail.add('app closed the relay');
  if (!hasProxyUsers()) {
    proxy.stop();
    if (!pairing.server) { release(); }
  }
});

function hasProxyUsers() {
  for (var k in proxyUsers) { if (proxyUsers.hasOwnProperty(k)) { return true; } }
  return false;
}
