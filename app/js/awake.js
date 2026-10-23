/* Keeps the TV's screensaver away while a slideshow plays.

   webOS starts its screensaver after a while without remote presses, and only
   full-screen video holds it off, so a photo slideshow gets covered after half an
   hour or so. There's no public API for this. The TV's power service asks the apps
   that subscribe to registerScreenSaverRequest before it starts the saver ("state":
   "Active"); answering responseScreenSaverRequest with ack:false puts it off until
   the next timeout, when it asks again. Kodi, RetroArch and immich-webos do the same.
   Releasing cancels the subscription, so the saver works as usual everywhere else.
   No-op off the TV (no PalmServiceBridge). */
var Awake = (function () {
  'use strict';

  var POWER = 'luna://com.webos.service.tvpower/power/';
  var CLIENT = 'com.cgbeaulieu.immichlite';
  var sub = null, holding = false, replies = [];

  function hidden() { return !!(document.hidden || document.webkitHidden); }

  function reply(timestamp) {
    var b = new PalmServiceBridge();
    replies.push(b); // keep a reference until it answers, or it can be collected
    b.onservicecallback = function () { replies.splice(replies.indexOf(b), 1); };
    // ack:false holds the saver off; while released (or in the background, after
    // Home) say yes, in case the cancelled subscription still calls back.
    b.call(POWER + 'responseScreenSaverRequest',
      JSON.stringify({ clientName: CLIENT, ack: !(holding && !hidden()), timestamp: timestamp }));
  }

  function hold(on) {
    if (on === holding || typeof PalmServiceBridge === 'undefined') { return; }
    holding = on;
    if (on) {
      sub = new PalmServiceBridge();
      sub.onservicecallback = function (msg) {
        var r;
        try { r = JSON.parse(msg); } catch (e) { return; }
        if (r.state === 'Active') { reply(r.timestamp); }
      };
      sub.call(POWER + 'registerScreenSaverRequest', JSON.stringify({ subscribe: true, clientName: CLIENT }));
    } else if (sub) {
      try { sub.cancel(); } catch (e) {}
      sub = null;
    }
  }

  return { hold: hold };
})();
