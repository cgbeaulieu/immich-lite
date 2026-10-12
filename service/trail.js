/* A short log of what the service did and when, for working out slow or failing
   sign-ins: GET /log on the phone sign-in server shows it.

   Never holds passwords, API keys or session tokens: emails are masked and query
   strings (where the app's apiKey / sessionKey travel) are cut off. Node 0.12, ES5. */
'use strict';

var MAX = 60;
var start = Date.now();
var entries = [];

function add(text) {
  entries.push({ at: Date.now(), text: String(text) });
  if (entries.length > MAX) { entries.shift(); }
}

/* "christian@example.com" -> "ch***@example.com" */
function maskEmail(email) {
  var s = String(email || ''), at = s.indexOf('@');
  return at > 0 ? s.substr(0, Math.min(2, at)) + '***' + s.substr(at) : '***';
}

/* A request path without its query string. */
function path(p) { return String(p || '').split('?')[0]; }

/* Each entry with seconds since the previous one, which is what shows the slow step. */
function list() {
  var out = [], i, prev = entries.length ? entries[0].at : start;
  for (i = 0; i < entries.length; i++) {
    out.push({
      time: new Date(entries[i].at).toISOString().substr(11, 12),
      after: ((entries[i].at - prev) / 1000).toFixed(2) + 's',
      what: entries[i].text
    });
    prev = entries[i].at;
  }
  return out;
}

module.exports = { add: add, list: list, maskEmail: maskEmail, path: path };
