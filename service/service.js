/* immich lite's webOS service: phone sign-in (see pairing.js).

   The app calls it over the webOS service bus:
     luna://com.cgbeaulieu.immichlite.service/start  {server}   -> {code, url, expiresIn}
     luna://com.cgbeaulieu.immichlite.service/poll              -> {state, credentials?}
     luna://com.cgbeaulieu.immichlite.service/report {ok, message}
     luna://com.cgbeaulieu.immichlite.service/stop
   Runs on webOS 3's Node 0.12 with the TV's built-in webos-service module. */
'use strict';

var fs = require('fs');
var path = require('path');
var Service = require('webos-service');
var Pairing = require('./pairing');

var service = new Service('com.cgbeaulieu.immichlite.service');
var pairing = new Pairing({ page: fs.readFileSync(path.join(__dirname, 'phone.html'), 'utf8') });
var keepAlive = null;

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
  if (r.state === 'expired') { pairing.stop(); release(); }
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
  release();
  message.respond({ returnValue: true });
});
