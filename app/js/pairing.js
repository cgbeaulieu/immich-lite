/* Phone sign-in: the QR card on the sign-in screen.

   The TV runs a small web server (service/pairing.js, inside the app's webOS service).
   The QR code opens it on a phone, which sends the immich address and email +
   password (or an API key). This card polls for them and hands them to the app,
   then tells the phone whether signing in worked.

   On the TV the service is reached over the webOS service bus (PalmServiceBridge).
   In a desktop browser, tools/devserver.py offers the same calls under /pair/, so
   the whole flow can be tried from a PC and a phone. */
var Pairing = (function () {
  'use strict';

  var SERVICE = 'luna://com.cgbeaulieu.immichlite.service/';
  var POLL_MS = 2000;
  var card, qrBox, urlEl, codeEl, stateEl, timer = null, token = 0, handlers = null, bridges = [];

  // ---------- transport ----------

  function luna(method, params, cb) {
    var bridge = new PalmServiceBridge();
    bridges.push(bridge); // keep a reference until it answers, or it can be collected
    bridge.onservicecallback = function (msg) {
      var r;
      bridges.splice(bridges.indexOf(bridge), 1);
      try { r = JSON.parse(msg); } catch (e) { r = { returnValue: false, errorText: 'Bad answer from the TV service' }; }
      cb(r.returnValue === false ? new Error(r.errorText || 'The TV service failed') : null, r);
    };
    bridge.call(SERVICE + method, JSON.stringify(params || {}));
  }

  function http(method, params, cb) {
    var x = new XMLHttpRequest();
    x.open('POST', '/pair/' + method, true);
    x.timeout = 10000;
    x.onreadystatechange = function () {
      var r = null;
      if (x.readyState !== 4) { return; }
      try { r = JSON.parse(x.responseText); } catch (e) { r = null; }
      cb(x.status === 200 && r ? null : new Error('Phone sign-in is not available'), r);
    };
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify(params || {}));
  }

  function call(method, params, cb) {
    if (typeof PalmServiceBridge !== 'undefined') { return luna(method, params, cb); }
    if (/^https?:$/.test(location.protocol)) { return http(method, params, cb); }
    cb(new Error('Phone sign-in is not available here'));
  }

  // ---------- the card ----------

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text) { e.textContent = text; }
    return e;
  }

  function build() {
    var head;
    card = U.$('qr-card');
    card.innerHTML = '';
    head = el('div', 'qr-title', 'Sign in with your phone');
    card.appendChild(head);
    qrBox = el('div', 'qr-box');
    card.appendChild(qrBox);
    card.appendChild(el('div', 'qr-line', 'Scan with your phone’s camera, or go to'));
    urlEl = el('div', 'qr-url');
    card.appendChild(urlEl);
    card.appendChild(el('div', 'qr-line', 'Code'));
    codeEl = el('div', 'qr-code');
    card.appendChild(codeEl);
    stateEl = el('div', 'qr-state');
    card.appendChild(stateEl);
  }

  /* A crisp QR image: whole pixels per module, from qrcode-generator (app/lib). */
  function drawQr(text) {
    var qr = qrcode(0, 'M'), n, cell, img = el('img');
    qr.addData(text);
    qr.make();
    n = qr.getModuleCount();
    cell = Math.max(4, Math.floor(340 / n));
    img.src = qr.createDataURL(cell, 0);
    img.width = img.height = n * cell;
    qrBox.innerHTML = '';
    qrBox.appendChild(img);
  }

  /* h: {onCredentials(creds), onUnavailable()}. server pre-fills the phone's form. */
  function show(server, h) {
    var t = ++token;
    handlers = h;
    if (!card) { build(); }
    stateEl.textContent = '';
    call('start', { server: server || '' }, function (err, info) {
      if (t !== token) { return; }
      if (err) { return handlers.onUnavailable(); }
      U.hide(U.$('help-card')); // the QR code replaces the typing tips
      U.show(card);
      drawQr(info.url);
      urlEl.textContent = info.url.replace(/^http:\/\//, '').replace(/\?.*$/, '');
      codeEl.textContent = info.code;
      poll(t);
    });
  }

  function poll(t) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      call('poll', {}, function (err, r) {
        if (t !== token) { return; }
        if (!err && r.state === 'received' && r.credentials) {
          stateEl.textContent = 'Signing in with the details from your phone...';
          handlers.onCredentials(r.credentials);
        } else if (!err && r.state === 'expired') {
          return show(null, handlers); // a fresh code
        }
        poll(t);
      });
    }, POLL_MS);
  }

  /* Tells the phone how signing in went (it shows the message). */
  function report(ok, message) {
    if (!ok && stateEl) { stateEl.textContent = message + '. Try again from your phone.'; }
    call('report', { ok: ok, message: message || '' }, function () {});
  }

  /* Leaving the sign-in screen: the TV stops listening. The report has a moment to
     reach the phone first. */
  function hide() {
    var t = ++token;
    clearTimeout(timer);
    if (card) { U.hide(card); }
    // ...unless the sign-in screen came back meanwhile and started a new code.
    setTimeout(function () { if (t === token) { call('stop', {}, function () {}); } }, 4000);
  }

  return { show: show, hide: hide, report: report };
})();
