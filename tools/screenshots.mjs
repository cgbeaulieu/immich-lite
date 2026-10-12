// Takes the README screenshots from the dev server's mock library with stock photos.
//
//   python tools/stock_photos.py                                   (once)
//   python tools/devserver.py --mock --photos tools/stock --port 8010
//   node tools/screenshots.mjs [shot ...]                          (all shots, or the named ones)
//
// Drives headless Edge or Chrome over the DevTools protocol, no packages needed (Node 22+
// for the built-in WebSocket). The page gets the app's 1920x1080 canvas (appinfo.json),
// as on the TV. Each shot starts from a fresh load and presses remote keys, as on the
// TV. Saves docs/screenshots/<name>.jpg.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'docs', 'screenshots');
const APP = process.env.APP_URL || 'http://localhost:8010/';
const PORT = 9333;

const KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 27, CH_DOWN: 34, PLAY: 415 };
const RAIL = ['photos', 'search', 'explore', 'map', 'favorites', 'albums', 'slides', 'settings'];

// Signed in to the mock (it takes any token), plus per-shot settings.
const SIGNED_IN = { server: APP.replace(/\/$/, ''), authMode: 'login', token: 'mock-session-token' };

// Each step is a key name, ['rail', key] to open a sidebar entry, ['type', text], or ['wait', ms].
const SHOTS = {
  timeline: { store: { groupBy: 'month' }, steps: [] },
  viewer: { steps: ['RIGHT', 'OK', ['wait', 2500]] },
  details: { steps: ['RIGHT', 'OK', ['wait', 2000], 'DOWN', ['wait', 1500]] },
  explore: { steps: [['rail', 'explore'], 'DOWN', ['wait', 1500]] },
  map: { steps: [['rail', 'map'], ['wait', 4000]] },
  albums: { steps: [['rail', 'albums']] },
  search: { steps: [['rail', 'search'], ['type', 'travel'], 'OK', ['wait', 2500]] },
  slideshow: { steps: [['rail', 'slides']] },
  signin: { store: { token: '', server: 'http://192.168.1.20:2283' }, steps: [] },
};

function findBrowser() {
  const paths = [
    process.env.BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ];
  const found = paths.find((p) => p && existsSync(p));
  if (!found) throw new Error('No Edge or Chrome found; set BROWSER to one');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = pages.find((p) => p.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Browser did not start');
}

function session(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    waiting.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return new Promise((resolve) => { ws.onopen = () => resolve({ send, close: () => ws.close() }); });
}

async function press(cdp, name) {
  const code = KEY[name];
  for (const type of ['rawKeyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  }
  await sleep(250);
}

async function shoot(cdp, name, shot) {
  const store = { ...SIGNED_IN, tileSize: 'medium', ...shot.store };
  const js = Object.entries(store).map(([k, v]) => `localStorage.setItem('immichlite.${k}', ${JSON.stringify(v)});`).join('');
  await cdp.send('Page.navigate', { url: APP });
  await sleep(500);
  await cdp.send('Runtime.evaluate', { expression: 'localStorage.clear();' + js });
  await cdp.send('Page.reload');
  await sleep(2500);
  for (const step of shot.steps) {
    if (typeof step === 'string') {
      await press(cdp, step);
    } else if (step[0] === 'rail') {
      await press(cdp, 'LEFT');
      for (let i = 0; i < RAIL.length; i++) await press(cdp, 'UP');
      for (let i = 0; i < RAIL.indexOf(step[1]); i++) await press(cdp, 'DOWN');
      await press(cdp, 'OK');
      await sleep(2000);
    } else if (step[0] === 'type') {
      await cdp.send('Input.insertText', { text: step[1] });
    } else if (step[0] === 'wait') {
      await sleep(step[1]);
    }
  }
  await sleep(800);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  writeFileSync(join(OUT, name + '.jpg'), Buffer.from(data, 'base64'));
  console.log('saved', name);
}

const wanted = process.argv.slice(2);
const profile = mkdtempSync(join(tmpdir(), 'immich-lite-shots-'));
const browser = spawn(findBrowser(), [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1920,1080', '--hide-scrollbars', '--no-first-run', '--autoplay-policy=no-user-gesture-required',
], { stdio: 'ignore' });
try {
  mkdirSync(OUT, { recursive: true });
  const cdp = await session(await connect());
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  for (const [name, shot] of Object.entries(SHOTS)) {
    if (!wanted.length || wanted.includes(name)) await shoot(cdp, name, shot);
  }
  cdp.close();
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked; it's in temp */ }
}
