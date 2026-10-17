// Cross-origin isolation for threaded cores (PPSSPP, DOSBox Pure) on a plain static host (no COOP/COEP headers from the server),
// and proof that it does not disturb the other cores or the library page. Needs network (EmulatorJS CDN, raw.githubusercontent.com).
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
const PORT = Number(process.env.PORT || 18000 + Math.floor(Math.random() * 20000));
const LIVE = process.env.BASE_URL;                      // e.g. https://<user>.github.io/retro-gb-nes-all-in-one/  (test the deployed site)
const base = LIVE ? LIVE.replace(/\/?$/, '/') : `http://localhost:${PORT}/`;
mkdirSync('tests/fixtures/systems', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-system-stubs.py', 'tests/fixtures/systems'], { stdio: 'ignore' });
const man = JSON.parse(readFileSync('tests/fixtures/systems/manifest.json', 'utf8'));
const srv = LIVE ? { kill() {} } : spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });   // python's server sends NO COOP/COEP
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const step = async (n, f) => { try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 300000, timeout: 120000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
try {
  const page = await browser.newPage();
  const failedReqs = [], docHeaders = {}; const errs = [];
  page.on('requestfailed', (r) => failedReqs.push(r.url().slice(0, 90) + ' ' + (r.failure() || {}).errorText));
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('response', (r) => { if (/player\.html/.test(r.url()) && r.request().resourceType() === 'document') docHeaders[r.url()] = r.headers(); });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => navigator.serviceWorker.ready); await sleep(1500);
  const put = (key, core) => page.evaluate(async (key, core, file, b64) => {
    const db = await import('./js/db.js'); const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const id = 'thr-' + key;
    await db.putRom({ id, file, title: key + ' stub', system: key, core, size: bin.length, added: Date.now(), lastPlayed: 0, data: bin.buffer }); return id;
  }, key, core, man[key].file, readFileSync('tests/fixtures/systems/' + man[key].file).toString('base64'));
  const start = async (id) => {
    await page.goto(`${base}player.html?id=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const e = window.EJS_emulator; return !!document.querySelector('.ejs_start_button') && document.querySelector('.ejs_start_button').offsetParent || (e && e.started); }, { timeout: 90000, polling: 400 });
    await page.click('.ejs_start_button').catch(() => {});
    await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, { timeout: 90000, polling: 400 });
    await sleep(2500);
    const a = await page.evaluate(() => window.EJS_emulator.gameManager.getFrameNum()); await sleep(1500);
    const b = await page.evaluate(() => window.EJS_emulator.gameManager.getFrameNum());
    return { a, b };
  };
  for (const [key, core] of [['psp', 'ppsspp'], ['dos', 'dosbox_pure']]) {
    await step(`${key} (${core}): loads isolated, threads on, frames advance`, async () => {
      const id = await put(key, core); const { a, b } = await start(id);
      const s = await page.evaluate(() => ({ iso: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, thr: window.EJS_threads, url: location.search, wasmThreads: !!(window.EJS_emulator.Module && (window.EJS_emulator.Module.PThread || window.EJS_emulator.Module.pthreadPoolSize !== undefined || true)) }));
      assert(s.iso === true && s.sab === 'function' && s.thr === true && /iso=1/.test(s.url), JSON.stringify(s));
      assert(b > a, `frames ${a}->${b}`);
      return JSON.stringify({ iso: s.iso, frames: `${a}->${b}` });
    });
  }
  await step('player document carried COOP/COEP only for the threaded launch', async () => {
    const iso = Object.entries(docHeaders).filter(([u]) => /iso=1/.test(u)); assert(iso.length, 'no iso document seen');
    const h = iso[0][1]; assert(h['cross-origin-opener-policy'] === 'same-origin' && h['cross-origin-embedder-policy'] === 'require-corp', JSON.stringify(h));
  });
  await step('no request was blocked by COEP on the isolated pages', async () => {
    const blocked = failedReqs.filter((x) => /BLOCKED|CORP|COEP/i.test(x)); assert(!blocked.length, blocked.join(' | '));
  });
  await step('a single-threaded core is unaffected (no isolation, no iso param, still boots)', async () => {
    const id = await page.evaluate(async () => { const db = await import('./js/db.js'); const bin = new Uint8Array(0x8000); const r = { id: 'plain-gb', file: 'x.gb', title: 'x', system: 'gb', core: 'gambatte', size: bin.length, added: 1, lastPlayed: 0, data: bin.buffer }; await db.putRom(r); return r.id; }).catch(() => null);
    void id;
    const gid = await put('gb', 'gambatte'); const { a, b } = await start(gid);
    const s = await page.evaluate(() => ({ iso: self.crossOriginIsolated, url: location.search, thr: window.EJS_threads }));
    assert(s.iso === false && !/iso=/.test(s.url) && s.thr === false && b > a, JSON.stringify(s) + ` frames ${a}->${b}`);
  });
  await step('library page after an isolated visit is not isolated and can still read cross-origin art (CORS intact)', async () => {
    await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
    const r = await page.evaluate(async () => { const x = await fetch('https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Game_Boy/master/Named_Boxarts/Tetris%20(World)%20(Rev%201).png'); const b = await x.blob(); return { iso: self.crossOriginIsolated, status: x.status, bytes: b.size }; });
    assert(r.iso === false && (r.status === 200 || r.status === 404) && r.bytes > 0, JSON.stringify(r));   // a readable response (even a 404 body) proves CORS is intact
  });
  // The stub images are not real games, so PPSSPP/DOSBox may log FS/abort errors after loading them; anything else is a bug.
await step('no unexpected JS errors', async () => { const odd = errs.filter((e) => !/memory access|abort|table index|ErrnoError/i.test(e)); console.log('  (ignored stub-image errors:', errs.length - odd.length, ')'); assert(!odd.length, odd.join(' | ')); });
} finally { await browser.close(); srv.kill(); }
console.log(failed ? `${failed} FAILED` : 'thread/isolation tests passed'); process.exit(failed ? 1 : 0);
