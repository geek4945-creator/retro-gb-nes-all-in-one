// ROM folders, headless Chrome. Three back-ends:
//  * Chrome File System Access: showDirectoryPicker() is replaced by a REAL directory handle from the Origin Private File System
//    (structured-cloneable, stored in IndexedDB exactly like a picked folder), so add / scan / rescan / auto-scan on launch run for real.
//  * iPhone (UA = iOS Safari): "Scan Downloads" multi-file picker and the webkitdirectory "Import folder" picker (real file uploads).
//  * Android APK: window.Capacitor + the native RomFolders plugin are mocked at the bridge level (nativePromise) to check the JS contract.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
const PORT = Number(process.env.PORT || 18000 + Math.floor(Math.random() * 20000)), base = `http://localhost:${PORT}/`;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0;
const step = async (n, f) => { total++; try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

// ---- fixture folder ----
const root = mkdtempSync(join(tmpdir(), 'rp-folder-')), roms = join(root, 'roms');
const F = 'tests/fixtures/systems/';
const put = (p, data) => { mkdirSync(join(roms, p, '..'), { recursive: true }); writeFileSync(join(roms, p), data); };
put('gb.gb', readFileSync(F + 'gb.gb')); put('gba.gba', readFileSync(F + 'gba.gba')); put('nes.nes', readFileSync(F + 'nes.nes'));
put('sub/gbc.gbc', readFileSync(F + 'gbc.gbc'));
const bin = Buffer.alloc(300000); bin.write('SEGADISCSYSTEM  SEGA', 16); put('disc/Game (USA).bin', bin);
put('disc/Game (USA).cue', 'FILE "Game (USA).bin" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\n');
const myst = Buffer.alloc(70000); for (let i = 0; i < myst.length; i++) myst[i] = (i * 7919) & 255; put('mystery.bin', myst);
put('readme.txt', 'hello'); put('cover.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])); put('.hidden.gb', readFileSync(F + 'gb.gb')); put('save.sav', Buffer.alloc(8192));
const walk = (d) => readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]);
const allFiles = walk(roms);
const asJson = () => allFiles.map((p) => ({ path: relative(roms, p), b64: readFileSync(p).toString('base64') }));

await sleep(700);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox'] });
const libCount = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('retro-pocket'); r.onsuccess = () => { const t = r.result.transaction('roms').objectStore('roms').getAll(); t.onsuccess = () => { res(t.result.map((x) => x.system + ':' + x.title).sort()); r.result.close(); }; }; }));
const toastText = (page) => page.$eval('#toast', (e) => e.textContent);
const waitIdle = (page) => page.waitForFunction(() => document.getElementById('scan-progress').hidden, { timeout: 30000 }).catch(async (e) => { throw new Error(e.message + ' progress=' + await page.$eval('#scan-progress', (x) => x.textContent)); });
try {
  // ================= Chrome: File System Access =================
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); if (process.env.DEBUG) page.on('console', (m) => console.log('  [page]', m.text()));
  await page.evaluateOnNewDocument(() => { window.showDirectoryPicker = async () => { const r = await navigator.storage.getDirectory(); return r.getDirectoryHandle('roms', { create: true }); }; });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  const writeOpfs = (files) => page.evaluate(async (files) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('roms', { create: true });
    for (const f of files) {
      const parts = f.path.split('/'); let d = root; for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable(); await w.write(Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))); await w.close();
    }
  }, files);
  await writeOpfs(asJson());

  await step('library shows "Scan for new ROMs" + "ROM folders" (Chrome = persistent folders)', async () => {
    const t = await page.$eval('#btn-scan', (e) => e.textContent); assert(/Scan for new ROMs/.test(t), t); assert(await page.$eval('#scan-howto', (e) => e.hidden), 'no iOS how-to');
  });
  await step('first scan with no folder: picks a folder, adds every ROM (zip/cue+bin bundled), skips non-ROM files, asks nothing', async () => {
    await page.click('#btn-scan'); await sleep(300); await waitIdle(page);
    const lib = await libCount(page);
    assert(lib.length === 5, 'lib ' + JSON.stringify(lib)); assert(lib.some((x) => x.startsWith('scd:Game')), 'cue+bin -> one Sega CD game');
    assert(!lib.some((x) => /readme|cover|save|hidden|mystery/i.test(x)), 'junk skipped');
    const t = await toastText(page); assert(/Added 5/.test(t) && /1 need a system choice/.test(t), t);
    assert(!(await page.$('#sheet[open]')), 'no "which system" prompt during a scan');
    return t;
  });
  await step('rescan finds nothing new (seen index + name/size + hash de-dupe)', async () => {
    await page.click('#btn-scan'); await sleep(300); await waitIdle(page);
    assert((await libCount(page)).length === 5, 'still 5'); const t = await toastText(page); assert(/No new games|need a system choice/.test(t) && !/Added/.test(t), t); return t;
  });
  await step('a new file in the folder: rescan adds only that one', async () => {
    await writeOpfs([{ path: 'more/sms.sms', b64: readFileSync(F + 'sms.sms').toString('base64') }]);
    await page.click('#btn-scan'); await sleep(300); await waitIdle(page);
    const lib = await libCount(page); assert(lib.length === 6 && lib.some((x) => x.startsWith('sms:')), JSON.stringify(lib)); assert(/Added 1 game/.test(await toastText(page)), await toastText(page));
  });
  await step('Settings → ROM folders lists the folder with file count + last scanned; Rescan works', async () => {
    await page.click('#btn-settings'); await page.waitForSelector('#btn-folders-settings'); await page.click('#btn-folders-settings'); await page.waitForSelector('#folders[open] .folder-row');
    const t = await page.$eval('#folders .folder-row', (e) => e.textContent); assert(/roms/.test(t) && /8 ROM files/.test(t) && /last scanned just now/.test(t), t);
    assert(await page.$('#fd-add') && await page.$('#fd-scanall'), 'add + scan all');
    await page.screenshot({ path: 'tests/out/folders-chrome.png' });
    const btn = await page.$('#folders .folder-row .folder-btns button'); await btn.click(); await sleep(300); await waitIdle(page);
    return t.replace(/\s+/g, ' ').slice(0, 90);
  });
  await step('auto-scan on launch: a file added while the app was closed appears after reopening (permission persisted)', async () => {
    await page.keyboard.press('Escape');
    await writeOpfs([{ path: 'snes.sfc', b64: readFileSync(F + 'snes.sfc').toString('base64') }]);
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(1500); await waitIdle(page);
    const lib = await libCount(page); assert(lib.length === 7 && lib.some((x) => x.startsWith('snes:')), JSON.stringify(lib));
  });
  await step('Remove forgets the folder but keeps the games', async () => {
    page.on('dialog', (d) => d.accept());
    await page.click('#btn-folders'); await page.waitForSelector('#folders[open] .folder-row');
    const btns = await page.$$('#folders .folder-row .folder-btns button'); await btns[1].click(); await sleep(500);
    assert(!(await page.$('#folders .folder-row')), 'row gone'); assert((await libCount(page)).length === 7, 'games kept');
  });
  await step('no page errors (Chrome)', async () => assert(!errs.length, errs.join(' | ')));
  await ctx.close();

  // ================= iPhone Safari: Scan Downloads =================
  const ictx = await browser.createBrowserContext(); const ip = await ictx.newPage();
  const ierrs = []; ip.on('pageerror', (e) => ierrs.push(e.message));
  await ip.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  await ip.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ip.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await step('iOS: prominent "Scan Downloads" button + how-to (Browse → Downloads → Select All)', async () => {
    const t = await ip.$eval('#btn-scan', (e) => e.textContent), h = await ip.$eval('#scan-howto', (e) => e.hidden ? '' : e.textContent);
    assert(/Scan Downloads/.test(t), t); assert(/Browse.*Downloads.*Select All/.test(h), h);
    await ip.screenshot({ path: 'tests/out/folders-ios.png' }); return h;
  });
  await step('iOS: picking everything in Downloads adds the ROMs and ignores pictures/text/saves', async () => {
    const input = await ip.$('#pick-downloads'); await input.uploadFile(...allFiles); await sleep(400); await waitIdle(ip);
    const lib = await libCount(ip); assert(lib.length === 5, JSON.stringify(lib)); const t = await toastText(ip); assert(/non-game files? ignored/.test(t) && /Added 5/.test(t), t); return t;
  });
  await step('iOS: picking the same files again adds nothing (dedupe); a new ROM in the selection is added alone; last import time remembered', async () => {
    await (await ip.$('#pick-downloads')).uploadFile(...allFiles); await sleep(400); await waitIdle(ip);
    assert((await libCount(ip)).length === 5, 'no dupes'); assert(!/Added/.test(await toastText(ip)), await toastText(ip));
    await (await ip.$('#pick-downloads')).uploadFile(...allFiles, F + 'gg.gg'); await sleep(400); await waitIdle(ip);
    assert((await libCount(ip)).length === 6, 'gg added');
    await ip.click('#btn-folders'); await ip.waitForSelector('#folders[open]');
    const t = await ip.$eval('#folders', (e) => e.textContent); assert(/Downloads/.test(t) && /last scanned just now/.test(t) && /Scan Downloads/.test(t), t.slice(0, 200));
    await ip.keyboard.press('Escape');
  });
  await step('iOS/Firefox: webkitdirectory "Import a whole folder" (directory upload) de-dupes against the library', async () => {
    writeFileSync(join(roms, 'ws.ws'), readFileSync(F + 'ws.ws')); await (await ip.$('#pick-dir')).uploadFile(roms); await sleep(400); await waitIdle(ip);
    const lib = await libCount(ip); assert(lib.length === 7 && lib.some((x) => x.startsWith('ws:')), JSON.stringify(lib));
  });
  await step('no page errors (iOS)', async () => assert(!ierrs.length, ierrs.join(' | ')));
  await ictx.close();

  // ================= Android APK: SAF plugin (bridge mocked) =================
  const actx = await browser.createBrowserContext(); const ap = await actx.newPage();
  const aerrs = []; ap.on('pageerror', (e) => aerrs.push(e.message)); if (process.env.DEBUG) ap.on('console', (m) => console.log('  [apk]', m.text()));
  await ap.evaluateOnNewDocument((files) => {
    const calls = window.__safCalls = [];
    let held = JSON.parse(localStorage.getItem('saf.held') || '[]');
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', nativePromise: async (plugin, method, o) => {
      calls.push(plugin + '.' + method + (o && o.initial ? ':' + o.initial : ''));
      if (plugin !== 'RomFolders') throw new Error('no plugin');
      const uri = 'content://com.android.externalstorage.documents/tree/primary%3ADownload';
      if (method === 'pick') { held = [uri]; localStorage.setItem('saf.held', JSON.stringify(held)); return { uri, name: 'Download' }; }
      if (method === 'check') return { ok: held.includes(o.uri) };
      if (method === 'release') { held = []; localStorage.setItem('saf.held', '[]'); return {}; }
      if (method === 'list') return { files: files.map((f) => ({ id: 'doc:' + f.path, path: f.path, name: f.path.split('/').pop(), size: atob(f.b64).length, mtime: 1 })) };
      if (method === 'read') { const f = files.find((x) => 'doc:' + x.path === o.id), s = atob(f.b64), part = s.slice(o.offset, o.offset + o.length); return { data: btoa(part), eof: o.offset + part.length >= s.length }; }
    } };
  }, asJson());
  await ap.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await step('APK: Scan → SAF folder picker opened at Download/, persisted URI, ROMs read through the plugin and added', async () => {
    await ap.click('#btn-scan'); await sleep(400); await waitIdle(ap);
    const calls = await ap.evaluate(() => window.__safCalls); assert(calls.includes('RomFolders.pick:Download'), calls.join(','));
    assert(calls.includes('RomFolders.list') && calls.includes('RomFolders.read'), calls.join(','));
    const lib = await libCount(ap); assert(lib.length === 5, JSON.stringify(lib)); return [...new Set(calls)].join(' ');
  });
  await step('APK: auto-scan on launch uses the persisted permission (check → list), nothing new → nothing added', async () => {
    await ap.reload({ waitUntil: 'networkidle0' }); await sleep(1500); await waitIdle(ap);
    const calls = await ap.evaluate(() => window.__safCalls); assert(calls.includes('RomFolders.check') && calls.includes('RomFolders.list'), calls.join(','));
    assert((await libCount(ap)).length === 5, 'still 5');
  });
  await step('APK: Remove releases the persisted permission', async () => {
    ap.on('dialog', (d) => d.accept());
    await ap.click('#btn-folders'); await ap.waitForSelector('#folders[open] .folder-row');
    const t = await ap.$eval('#folders', (e) => e.textContent); assert(/Android folder/.test(t) && /Download\//.test(t), t.slice(0, 200));
    const btns = await ap.$$('#folders .folder-row .folder-btns button'); await btns[1].click(); await sleep(400);
    assert((await ap.evaluate(() => window.__safCalls)).includes('RomFolders.release'), 'release');
  });
  await step('no page errors (APK)', async () => assert(!aerrs.length, aerrs.join(' | ')));
} finally {
  await browser.close(); srv.kill();
}
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
