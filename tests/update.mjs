// Updates + backup, headless Chrome, no CDN needed: a COPY of www is served and re-"deployed" with a higher build number to check that
// (1) the service worker never serves stale files while online, (2) a newer build shows "Update available — Reload" and Reload really switches
// to the new version, (3) offline still works, (4) the APK variant offers the APK download instead, (5) backup export -> wipe -> import restores
// games / states / art / BIOS byte-for-byte and settings (but never the API keys).
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, rmSync, mkdtempSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'rp-www-')), www = join(dir, 'www'); cpSync('www', www, { recursive: true });
const stamp = (b) => execFileSync(process.execPath, ['scripts/stamp-build.mjs'], { env: { ...process.env, WWW_DIR: www, RP_BUILD: String(b), GITHUB_ENV: '' } });
stamp(100);
const PORT = Number(process.env.PORT || 18000 + Math.floor(Math.random() * 20000)), base = `http://localhost:${PORT}/`;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', www], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0;
const step = async (n, f) => { total++; try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox'] });
try {
  const page = await (await browser.createBrowserContext()).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); if (process.env.DEBUG) page.on('console', (m) => console.log('  [page]', m.text()));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const sw = () => page.evaluate(() => new Promise(async (res) => { const reg = await navigator.serviceWorker.getRegistration(); const w = reg && reg.active; if (!w) return res(null); navigator.serviceWorker.addEventListener('message', (e) => e.data && e.data.type === 'version' && res(e.data.version)); w.postMessage('get-version'); setTimeout(() => res('timeout'), 3000); }));
  const openSettings = async () => { await page.click('#btn-settings'); await page.waitForSelector('#btn-update'); };
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload({ waitUntil: 'networkidle0' }); await sleep(500);

  await step('build 100 is running: the service worker has the stamped version and the Settings button shows the version', async () => {
    assert(await sw() === 'b100', 'sw version ' + await sw()); await openSettings(); const t = await page.$eval('#btn-update', (e) => e.textContent); assert(/1\.0\.100/.test(t), t);
  });
  await step('Check for updates: when current it says "up to date" and no banner appears', async () => {
    await page.click('#btn-update'); await page.waitForFunction(() => /up to date/.test(document.getElementById('toast').textContent), { timeout: 8000 }); assert(!(await page.$('#update-banner:not([hidden])')), 'no banner');
  });
  // ---- "deploy" build 101 (+ a changed stylesheet) ----
  stamp(101); appendFileSync(join(www, 'css/app.css'), '\n/* build-101-marker */\n');
  await step('no stale files: after a deployment the page gets the NEW stylesheet immediately (network-first), service worker not yet switched', async () => {
    const t = await page.evaluate(async () => (await fetch('css/app.css')).text()); assert(t.includes('build-101-marker'), 'stale css served');
    assert(await sw() === 'b100', 'old worker still active until the user reloads');
  });
  await step('Check for updates after a deployment: banner "Update available — Reload", a worker is waiting (not auto-activated)', async () => {
    await page.click('#btn-update'); await page.waitForFunction(() => /Update available/.test(document.getElementById('toast').textContent), { timeout: 15000 });
    await page.waitForSelector('#update-banner:not([hidden])'); const txt = await page.$eval('#update-banner', (e) => e.textContent); assert(/1\.0\.101/.test(txt) || /ready/.test(txt), txt);
    assert(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), 'waiting worker');
    await page.screenshot({ path: 'tests/out/update-banner.png' });
  });
  await step('Reload applies the update: the new worker (b101) takes over and the page reloads once on the new build', async () => {
    await page.keyboard.press('Escape'); await sleep(300);
    const nav = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => null);
    await page.click('#update-go'); await nav; await sleep(1500);
    if (process.env.DEBUG) console.log(await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return JSON.stringify({ a: r.active && r.active.state, w: r.waiting && r.waiting.state, i: r.installing && r.installing.state, ctrl: !!navigator.serviceWorker.controller, url: location.href }); }));
    assert(await sw() === 'b101', 'sw ' + await sw()); await openSettings(); assert(/1\.0\.101/.test(await page.$eval('#btn-update', (e) => e.textContent)), 'ui version'); assert(!(await page.$('#update-banner:not([hidden])')), 'banner gone');
    await page.click('#btn-update'); await page.waitForFunction(() => /up to date/.test(document.getElementById('toast').textContent), { timeout: 8000 });
  });
  await step('offline: the app shell still opens from the cache (airplane mode)', async () => {
    await page.keyboard.press('Escape'); await page.setOfflineMode(true); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#btn-settings', { timeout: 8000 });
    assert((await page.title()).length > 0, 'title'); await page.setOfflineMode(false);
  });
  await step('Android APK: a newer build offers "Download APK" (bundled web files cannot self-update)', async () => {
    const p2 = await (await browser.createBrowserContext()).newPage(); await p2.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await p2.evaluateOnNewDocument(() => { window.Capacitor = { isNativePlatform: () => true }; });
    await (await p2.createCDPSession()).send('Network.setBypassServiceWorker', { bypass: true });
    await p2.setRequestInterception(true);
    p2.on('request', (r) => { const u = r.url(); if (u.startsWith('https://geek4945-creator.github.io/')) r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: readBuild() }); else r.continue(); });
    await p2.goto(base + 'index.html', { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('#update-banner:not([hidden])', { timeout: 15000 }); const t = await p2.$eval('#update-banner', (e) => e.textContent); assert(/Download APK/.test(t) && /1\.0\.103/.test(t), t); await p2.close();
  });
  function readBuild() { return JSON.stringify({ build: 103, version: '1.0.103', sha: 'abc', date: '' }); }

  // ---- backup ----
  await step('Backup: export → wipe storage → import restores games, states, art, BIOS byte-for-byte + settings (not API keys)', async () => {
    const r = await page.evaluate(async () => {
      const db = await import('./js/db.js'), bk = await import('./js/backup.js');
      const rnd = (n, s) => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 31 + s) & 255; return u; };
      const rom = rnd(70000, 1), st = rnd(5000, 2), art = rnd(3000, 3), bios = rnd(2048, 4);
      await db.putRom({ id: 'r1', file: 'a b.nes', title: 'Alpha', system: 'nes', core: 'nestopia', size: rom.length, added: 5, lastPlayed: 6, data: rom.buffer.slice(0) });
      await db.putState({ id: 'r1', core: 'nestopia', time: 7, data: st.buffer.slice(0) });
      await db.putArt({ id: 'r1', blob: new Blob([art], { type: 'image/png' }), src: 'x' });
      await db.putBios({ id: 'gba/gba_bios.bin', system: 'gba', name: 'gba_bios.bin', size: 2048, md5: 'z', data: bios.buffer.slice(0) });
      localStorage.setItem('rp.ui', '{"pos":"left","autohide":false}'); localStorage.setItem('rp.keys', '{"rawg":"SECRET"}');
      const blob = await bk.exportBackup({ includeGames: true }), text = await new Response(blob).text();
      const leak = text.includes('SECRET');
      for (const id of await db.keysRaw('roms')) await db.deleteRom(id); for (const id of await db.keysRaw('states')) await db.deleteState(id); for (const id of await db.keysRaw('art')) await db.deleteArt(id); for (const id of await db.keysRaw('bios')) await db.deleteBios(id);
      localStorage.removeItem('rp.ui'); const gone = (await db.allRoms()).length;
      const counts = await bk.importBackup(new File([blob], 'b.zip'));
      const R = await db.getRom('r1'), S = await db.getState('r1'), A = await db.getArt('r1'), B = (await db.allBios())[0];
      const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      const artBytes = new Uint8Array(await A.blob.arrayBuffer());
      return { gone, counts, leak, rom: eq(new Uint8Array(R.data), rom) && R.title === 'Alpha' && R.file === 'a b.nes' && R.lastPlayed === 6, st: eq(new Uint8Array(S.data), st) && S.core === 'nestopia', art: eq(artBytes, art) && A.blob.type === 'image/png', bios: eq(new Uint8Array(B.data), bios) && B.id === 'gba/gba_bios.bin', ui: localStorage.getItem('rp.ui'), keys: localStorage.getItem('rp.keys'), size: blob.size };
    });
    assert(r.gone === 0 && r.counts.roms === 1 && r.counts.states === 1 && r.counts.art === 1 && r.counts.bios === 1, JSON.stringify(r)); assert(r.rom && r.st && r.art && r.bios, JSON.stringify(r)); assert(!r.leak && r.ui === '{"pos":"left","autohide":false}', 'settings/keys ' + JSON.stringify(r)); return `${r.size} bytes`;
  });
  await step('Backup UI: Settings → Backup & restore → export button and import of a backup file', async () => {
    await page.reload({ waitUntil: 'networkidle0' }); await page.click('#btn-settings'); await page.waitForSelector('#btn-backup'); await page.click('#btn-backup'); await page.waitForSelector('#bk-export'); await page.waitForSelector('#bk-import');
    const b64 = await page.evaluate(async () => { const bk = await import('./js/backup.js'); const buf = new Uint8Array(await (await bk.exportBackup({ includeGames: false })).arrayBuffer()); let s = ''; for (const c of buf) s += String.fromCharCode(c); return btoa(s); });
    const f = join(dir, 'backup.zip'); writeFileSync(f, Buffer.from(b64, 'base64'));
    await (await page.$('#bk-file')).uploadFile(f); await page.waitForFunction(() => /Restored|failed/.test(document.getElementById('bk-status').textContent), { timeout: 10000 });
    const t = await page.$eval('#bk-status', (e) => e.textContent); assert(/Restored/.test(t), t);
    await page.evaluate(() => { document.getElementById('bk-file').value = ''; }); await page.screenshot({ path: 'tests/out/backup.png' });
  });
  await step('no uncaught JS errors', async () => assert(!errs.length, errs.join(' | ')));
} finally { await browser.close(); srv.kill(); rmSync(dir, { recursive: true, force: true }); }
console.log(failed ? `update: ${failed}/${total} FAILED` : `update: all ${total} checks passed`); process.exit(failed ? 1 : 0);
