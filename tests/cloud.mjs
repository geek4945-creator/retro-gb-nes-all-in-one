// Google Drive cloud save sync. Two separate browser profiles act as two devices. Google sign-in (GIS) and the Drive v3 REST API
// are replaced by an in-test fake (no Google account is available headlessly). The fake checks the requested scope, the auth header,
// appDataFolder usage and multipart uploads. A real EmulatorJS boot on device B checks that the downloaded battery save is loaded by the core.
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
mkdirSync('tests/fixtures', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/homebrew-test.gb']);
const PORT = 18000 + Math.floor(Math.random() * 20000), base = `http://localhost:${PORT}/`;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0;
const step = async (n, f) => { total++; try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const CLIENT = '1234-test.apps.googleusercontent.com', TOKEN = 'ya29.fake';

/* ---------- fake Google Drive (appDataFolder only) ---------- */
const files = new Map(); let nextId = 1; const log = []; let scopes = new Set(); let expire = false;
function drive(method, url, headers, b64) {
  const u = new URL(url); log.push(method + ' ' + u.pathname);
  if (expire || headers.authorization !== 'Bearer ' + TOKEN) return { status: 401, text: '{"error":"invalid"}' };
  const body = b64 ? Buffer.from(b64, 'base64') : null;
  if (u.pathname === '/drive/v3/about') return { status: 200, text: JSON.stringify({ user: { emailAddress: 'player@example.com' } }) };
  if (u.pathname === '/drive/v3/files' && method === 'GET') {
    assert(u.searchParams.get('spaces') === 'appDataFolder', 'list must use appDataFolder');
    return { status: 200, text: JSON.stringify({ files: [...files.values()].map(({ id, name, appProperties }) => ({ id, name, appProperties })) }) };
  }
  let m = u.pathname.match(/^\/drive\/v3\/files\/(\w+)$/);
  if (m && u.searchParams.get('alt') === 'media') { const f = files.get(m[1]); return f ? { status: 200, b64: f.data.toString('base64') } : { status: 404, text: 'nf' }; }
  m = u.pathname.match(/^\/upload\/drive\/v3\/files(?:\/(\w+))?$/);
  if (m && u.searchParams.get('uploadType') === 'multipart') {
    const bnd = /boundary=(\S+)/.exec(headers['content-type'])[1], s = body.toString('latin1');
    const parts = s.split('--' + bnd).slice(1, -1).map((p) => { const i = p.indexOf('\r\n\r\n'); return p.slice(i + 4, -2); });
    const meta = JSON.parse(Buffer.from(parts[0], 'latin1').toString('utf8')), data = Buffer.from(parts[1], 'latin1');
    if (method === 'POST') { assert(meta.parents && meta.parents[0] === 'appDataFolder', 'new files must go to appDataFolder'); const id = 'f' + nextId++; files.set(id, { id, name: meta.name, appProperties: meta.appProperties, data }); return { status: 200, text: JSON.stringify({ id }) }; }
    const f = files.get(m[1]); Object.assign(f, { name: meta.name, appProperties: meta.appProperties, data }); return { status: 200, text: JSON.stringify({ id: f.id }) };
  }
  return { status: 400, text: 'unexpected ' + method + ' ' + url };
}

async function device(name) {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage(); page.errs = [];
  page.on('pageerror', (e) => page.errs.push(e.message));
  await page.exposeFunction('__drive', (m, u, h, b) => drive(m, u, h, b));
  await page.exposeFunction('__scope', (s) => { scopes.add(s); });
  await page.evaluateOnNewDocument((TOKEN) => {
    window.google = { accounts: { oauth2: {
      initTokenClient: (cfg) => ({ requestAccessToken: () => { window.__scope(cfg.scope + '|' + cfg.client_id); setTimeout(() => cfg.callback({ access_token: TOKEN, expires_in: 3599, scope: cfg.scope }), 30); } }),
      hasGrantedAllScopes: (r, s) => r.scope === s, revoke: (t, cb) => cb && cb(),
    } } };
    const real = window.fetch.bind(window);
    window.fetch = async (input, opts = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!/^https:\/\/www\.googleapis\.com\//.test(url)) return real(input, opts);
      let b64 = null;
      if (opts.body) { const ab = await new Response(opts.body).arrayBuffer(); let s = ''; const u8 = new Uint8Array(ab); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); b64 = btoa(s); }
      const h = {}; for (const [k, v] of Object.entries(opts.headers || {})) h[k.toLowerCase()] = v;
      const r = await window.__drive(opts.method || 'GET', url, h, b64);
      const bytes = r.b64 ? Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0)) : r.text;
      return new Response(bytes, { status: r.status });
    };
  }, TOKEN);
  await page.setViewport({ width: 420, height: 860 });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  return { browser, page };
}
const bytes = [...readFileSync('tests/fixtures/homebrew-test.gb')];
const SRAM = Array.from({ length: 8192 }, (_, i) => (i * 7 + 3) & 255);
const seedRom = (page) => page.evaluate(async (bytes) => { const db = await import('./js/db.js'); await db.putRom({ id: 'g1', file: 'homebrew-test.gb', title: 'Homebrew Test', system: 'gb', core: 'gambatte', size: bytes.length, added: 1, lastPlayed: 0, data: new Uint8Array(bytes).buffer }); }, bytes);
const openCloud = async (page) => {
  await page.evaluate(() => document.querySelector('dialog[open]')?.close());
  await page.click('#btn-settings'); await page.waitForSelector('#btn-cloud', { visible: true }); await page.click('#btn-cloud'); await page.waitForSelector('#cloud-signin', { visible: true });
};
const syncVia = async (page) => { await page.click('#cloud-signin'); await page.waitForFunction(() => /Last sync/.test(document.querySelector('#cloud-status')?.textContent || '') && !document.querySelector('#cloud-signin').disabled, { timeout: 20000 }); return page.$eval('#cloud-status', (e) => e.textContent); };
const readLocal = (page) => page.evaluate(async () => {
  const db = await import('./js/db.js'); const st = await db.getState('g1');
  const d = await new Promise((res, rej) => { const q = indexedDB.open('/data/saves'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const out = { state: st ? [...new Uint8Array(st.data)].slice(0, 8).join(',') + '|' + st.core + '|' + st.time : null, idbfs: {} };
  if (d.objectStoreNames.contains('FILE_DATA')) {
    const s = d.transaction('FILE_DATA').objectStore('FILE_DATA');
    const keys = await new Promise((r) => { s.getAllKeys().onsuccess = (e) => r(e.target.result); });
    for (const k of keys) { const v = await new Promise((r) => { s.get(k).onsuccess = (e) => r(e.target.result); }); out.idbfs[k] = v.contents ? v.contents.length + ':' + [...v.contents].slice(0, 6).join(',') : 'dir' + v.mode + (v.timestamp instanceof Date ? 'D' : '?'); }
  }
  d.close(); return out;
});

await sleep(800);
const A = await device('A'), B = await device('B');
try {
  await step('device A: Settings → ☁️ Cloud save sync → client ID → Sign in with Google uploads the battery save + auto-resume state', async () => {
    await seedRom(A.page);
    await A.page.evaluate(async (SRAM) => {
      const db = await import('./js/db.js'); await db.putState({ id: 'g1', core: 'gambatte', data: new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]).buffer, time: 1700000000000 });
      const d = await new Promise((res) => { const q = indexedDB.open('/data/saves', 21); q.onupgradeneeded = () => q.result.createObjectStore('FILE_DATA').createIndex('timestamp', 'timestamp'); q.onsuccess = () => res(q.result); });
      const t = d.transaction('FILE_DATA', 'readwrite'); t.objectStore('FILE_DATA').put({ timestamp: new Date(1700000001000), mode: 16872 }, '/data/saves/Gambatte'); t.objectStore('FILE_DATA').put({ timestamp: new Date(1700000001000), mode: 33206, contents: new Uint8Array(SRAM) }, '/data/saves/Gambatte/homebrew-test.srm');
      await new Promise((r) => { t.oncomplete = r; }); d.close();
    }, SRAM);
    await openCloud(A.page);
    await A.page.click('#cloud-signin'); await sleep(500);
    assert(/client ID/i.test(await A.page.$eval('#toast', (e) => e.textContent)), 'no client ID → clear message');
    await A.page.type('#cloud-client', CLIENT); await A.page.$eval('#cloud-client', (e) => e.dispatchEvent(new Event('change')));
    const st = await syncVia(A.page);
    assert(/player@example\.com/.test(st) && /↑2 ↓0/.test(st), st);
    const names = [...files.values()].map((f) => f.name).sort();
    assert(names.join() === 'sram:/data/saves/Gambatte/homebrew-test.srm,state:g1', names.join());
    assert([...scopes].every((s) => s === 'https://www.googleapis.com/auth/drive.appdata|' + CLIENT) && scopes.size === 1, [...scopes].join());
    assert(files.get('f1').data.length + files.get('f2').data.length === 8192 + 9, 'sizes');
    return st + ' · scope drive.appdata only';
  });
  await step('device B (empty) signs in and downloads both; IDBFS layout matches Emscripten (dir entry + Date timestamps)', async () => {
    await seedRom(B.page); await openCloud(B.page);
    await B.page.type('#cloud-client', CLIENT); await B.page.$eval('#cloud-client', (e) => e.dispatchEvent(new Event('change')));
    const st = await syncVia(B.page); assert(/↑0 ↓2/.test(st), st);
    const l = await readLocal(B.page);
    assert(l.state === '9,8,7,6,5,4,3,2|gambatte|1700000000000', JSON.stringify(l));
    assert(l.idbfs['/data/saves/Gambatte/homebrew-test.srm'] === '8192:3,10,17,24,31,38' && l.idbfs['/data/saves/Gambatte'] === 'dir16872D', JSON.stringify(l.idbfs));
    return st;
  });
  await step('device B: EmulatorJS boots the game and its core sees the synced battery save', async () => {
    await B.page.goto(`${base}player.html?id=g1`, { waitUntil: 'domcontentloaded' });
    await B.page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 }); await B.page.click('.ejs_start_button');
    await B.page.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 }); await sleep(1500);
    const r = await B.page.evaluate(() => { const g = EJS_emulator.gameManager, p = g.getSaveFilePath(), f = g.FS.analyzePath(p).exists ? g.FS.readFile(p) : null; return { p, len: f && f.length, head: f && [...f.slice(0, 6)].join(',') }; });
    assert(r.len === 8192 && r.head === '3,10,17,24,31,38', JSON.stringify(r)); return JSON.stringify(r);
  });
  await step('a newer save on B is uploaded; device A then downloads it (newest wins, nothing deleted)', async () => {
    await B.page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
    await B.page.evaluate(async () => { const db = await import('./js/db.js'); await db.putState({ id: 'g1', core: 'gambatte', data: new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1]).buffer, time: Date.now() }); });
    await openCloud(B.page); const sb = await syncVia(B.page); assert(/↑1 ↓0/.test(sb), 'B ' + sb);
    await openCloud(A.page); const sa = await syncVia(A.page); assert(/↑0 ↓1/.test(sa), 'A ' + sa);
    const l = await readLocal(A.page); assert(l.state.startsWith('1,1,1,1,1,1,1,1|gambatte'), l.state);
    assert(files.size === 2, 'files ' + files.size); return `B ${sb.match(/\(.*\)/)[0]} → A ${sa.match(/\(.*\)/)[0]}`;
  });
  await step('automatic sync when the library opens (same app session, no popup)', async () => {
    await A.page.evaluate(async () => { const db = await import('./js/db.js'); await db.putState({ id: 'g1', core: 'gambatte', data: new Uint8Array([2, 2, 2, 2, 2, 2, 2, 2]).buffer, time: Date.now() }); });
    const before = scopes.size, n = log.length;
    await A.page.goto(base + 'index.html', { waitUntil: 'networkidle0' }); await sleep(3000);
    const up = log.slice(n).filter((x) => x.startsWith('PATCH')).length;
    assert(up === 1, 'auto uploads ' + up + ' ' + log.slice(n).join(';'));
    const f = [...files.values()].find((x) => x.name === 'state:g1'); assert(f.data[0] === 2, 'remote not updated');
    return 'uploaded on library open';
  });
  await step('expired sign-in gives a clear message instead of failing silently', async () => {
    expire = true; await openCloud(A.page); await A.page.click('#cloud-signin'); await sleep(1200); expire = false;
    const t = await A.page.$eval('#toast', (e) => e.textContent); assert(/expired/i.test(t), t); return t;
  });
  await step('sign out clears the account', async () => {
    await A.page.click('#cloud-signout'); const s = await A.page.$eval('#cloud-status', (e) => e.textContent); assert(/Not signed in/.test(s), s);
    const tok = await A.page.evaluate(() => sessionStorage.getItem('rp.cloudTok')); assert(!tok, 'token kept'); return s;
  });
  await A.page.screenshot({ path: 'tests/out/cloud.png' });
  await step('no page errors', async () => { const e = [...A.page.errs, ...B.page.errs]; assert(!e.length, e.join(' | ')); });
} finally {
  await A.browser.close(); await B.browser.close(); srv.kill();
}
console.log(`\n${total - failed}/${total} passed`); process.exit(failed ? 1 : 0);
