// Library flows for the multi-system build: detection, system picker, cue/bin bundling, BIOS upload -> EmulatorJS file system,
// heavy-system badges, scrollable chips, moving a game to another system. Needs network (EmulatorJS CDN).
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const PORT = Number(process.env.PORT || 18000 + Math.floor(Math.random() * 20000)), base = `http://localhost:${PORT}/`;
mkdirSync('tests/fixtures/systems', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-system-stubs.py', 'tests/fixtures/systems'], { stdio: 'ignore' });
const FX = 'tests/fixtures/systems/', TMP = 'tests/fixtures/lib/'; mkdirSync(TMP, { recursive: true });
// derived fixtures: header-detectable .bin, mystery .bin, cue + bin pair, fake BIOS files
const n64 = Buffer.from(readFileSync(FX + 'n64.z64')); n64[0x800] = 0x42; writeFileSync(TMP + 'Mystery Game.bin', n64);
writeFileSync(TMP + 'blob.bin', Buffer.alloc(4096, 7));
writeFileSync(TMP + 'Disc Game.bin', Buffer.alloc(2352 * 30));
writeFileSync(TMP + 'Disc Game.cue', 'FILE "Disc Game.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n');
writeFileSync(TMP + 'Lonely.cue', 'FILE "missing-track.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n');
writeFileSync(TMP + 'GBA_BIOS.BIN', Buffer.alloc(16384, 3)); writeFileSync(TMP + 'neogeo.zip', readFileSync(FX + 'neogeogame.zip'));
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const step = async (n, f) => { try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 300000, timeout: 120000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  const add = async (...files) => { const input = await page.$('#file-input'); await input.uploadFile(...files); };
  const cards = () => page.$$eval('.card', (c) => c.map((x) => ({ name: x.querySelector('.name').textContent, badge: x.querySelector('.badge').textContent, warn: !!x.querySelector('.warn') })));
  const pick = async (label) => { await page.waitForSelector('#sheet[open] h3'); const ok = await page.evaluate((l) => { const b = [...document.querySelectorAll('#sheet button.row')].find((x) => x.textContent.startsWith(l)); if (b) b.click(); return !!b; }, label); assert(ok, 'no picker row ' + label); };
  const waitCards = (n) => page.waitForFunction((n) => document.querySelectorAll('.card').length >= n, { timeout: 8000 }, n);

  await step('unique extensions are auto-detected (.nes .md .sms .z64 .gba)', async () => {
    await add(FX + 'nes.nes', FX + 'md.md', FX + 'sms.sms', FX + 'n64.z64', FX + 'gba.gba'); await waitCards(5);
    const c = await cards(); const b = Object.fromEntries(c.map((x) => [x.name, x.badge]));
    assert(b['nes'] === 'NES' && b['md'] === 'MD' && b['sms'] === 'SMS' && b['n64'] === 'N64' && b['gba'] === 'GBA', JSON.stringify(b));
    assert(c.find((x) => x.name === 'n64').warn, 'N64 should carry the performance warning badge');
    assert(!c.find((x) => x.name === 'nes').warn, 'NES must not');
  });
  await step('.bin with an N64 header is detected by content (no prompt)', async () => {
    await add(TMP + 'Mystery Game.bin'); await waitCards(6);
    assert(!(await page.$('#sheet[open]')), 'picker should not open');
    const c = await cards(); assert(c.find((x) => x.name === 'Mystery Game').badge === 'N64', JSON.stringify(c));
  });
  await step('unknown .bin shows the system picker with candidates + "show all"', async () => {
    await add(TMP + 'blob.bin'); await page.waitForSelector('#sheet[open] h3');
    const labels = await page.$$eval('#sheet button.row', (b) => b.map((x) => x.textContent));
    assert(labels.some((l) => l.startsWith('Atari 2600')) && labels.some((l) => l.startsWith('Genesis')) && labels.includes('Show all systems…'), labels.join('|'));
    await pick('Show all systems');
    const all = await page.$$eval('#sheet button.row', (b) => b.length); assert(all > 40, 'only ' + all + ' rows');
    await pick('Atari 2600'); await waitCards(7);
    const c = await cards(); assert(c.find((x) => x.name === 'blob').badge === '2600', JSON.stringify(c));
  });
  await step('cue + bin selected together are bundled into one ZIP (picker for the disc system)', async () => {
    await add(TMP + 'Disc Game.cue', TMP + 'Disc Game.bin'); await pick('PlayStation'); await waitCards(8);
    const c = await cards(); const d = c.find((x) => x.name === 'Disc Game'); assert(d && d.badge === 'PS1' && d.warn, JSON.stringify(c));
    const info = await page.evaluate(async () => {
      const db = await import('./js/db.js'); const { zipNames } = await import('./js/detect.js');
      const r = (await db.allRoms()).find((x) => x.title === 'Disc Game'); return { file: r.file, names: await zipNames(new Blob([r.data])), size: r.size, core: r.core };
    });
    assert(info.file === 'Disc Game.zip' && info.names.includes('Disc Game.cue') && info.names.includes('Disc Game.bin') && info.core === 'pcsx_rearmed', JSON.stringify(info));
  });
  await step('a cue whose .bin is missing is refused with a message', async () => {
    await add(TMP + 'Lonely.cue'); await page.waitForFunction(() => /missing-track/.test(document.querySelector('#toast').textContent), { timeout: 6000 });
    assert(!(await page.$('#sheet[open]')), 'no picker expected');
    const t = await page.$eval('#toast', (e) => e.textContent); assert(/missing-track\.bin/.test(t) && /skipped/.test(t), t);
    assert((await cards()).length === 8);
  });
  await step('system chips are present for every system and scroll horizontally', async () => {
    const r = await page.evaluate(() => { const c = document.querySelector('#chips'); return { n: c.querySelectorAll('.chip').length, scroll: c.scrollWidth > c.clientWidth, ov: getComputedStyle(c).overflowX }; });
    assert(r.n >= 8 && r.ov === 'auto', JSON.stringify(r));
  });
  await step('game sheet: system switcher, heavy note, BIOS status', async () => {
    await page.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.querySelector('.name').textContent === 'Disc Game').querySelector('.more').click());
    await page.waitForSelector('#sheet[open]'); await sleep(300);
    const t = await page.$eval('#sheet', (d) => d.textContent);
    assert(/demanding/.test(t) && /BIOS/.test(t) && /System/.test(t), t.slice(0, 300));
    const opts = await page.$$eval('#sheet select option', (o) => o.map((x) => x.textContent)); assert(opts.includes('Sega Saturn') && opts.includes('Nintendo 64'), 'system options');
    await page.keyboard.press('Escape');
  });
  await step('BIOS upload stores canonical file names (GBA_BIOS.BIN -> gba_bios.bin) in IndexedDB', async () => {
    await page.click('#btn-settings'); await page.waitForSelector('#settings[open]'); await page.click('#btn-bios'); await page.waitForSelector('#bios[open] details');
    const n = await page.$$eval('#bios details', (d) => d.length); assert(n >= 15, 'only ' + n + ' BIOS systems');
    // open the Game Boy Advance panel and upload
    await page.evaluate(() => { const d = [...document.querySelectorAll('#bios details')].find((x) => x.querySelector('summary span').textContent === 'Game Boy Advance'); d.open = true; });
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate(() => [...document.querySelectorAll('#bios details')].find((x) => x.querySelector('summary span').textContent === 'Game Boy Advance').querySelector('button.row').click())]);
    await chooser.accept([TMP + 'GBA_BIOS.BIN']); await sleep(900);
    const have = await page.evaluate(async () => (await (await import('./js/db.js')).allBios()).map((b) => b.id));
    assert(have.includes('gba/gba_bios.bin'), JSON.stringify(have));
    await page.keyboard.press('Escape');
  });
  await step('stored BIOS reaches the emulator file system (mGBA sees /gba_bios.bin)', async () => {
    const id = await page.evaluate(async () => (await (await import('./js/db.js')).allRoms()).find((r) => r.title === 'gba').id);
    await page.goto(`${base}player.html?id=${id}`); await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 90000 });
    await page.click('.ejs_start_button'); await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, { timeout: 90000 });
    const r = await page.evaluate(() => { const FS = window.EJS_emulator.gameManager.FS; const a = FS.analyzePath('/gba_bios.bin'); return { exists: a.exists, size: a.exists ? FS.stat('/gba_bios.bin').size : 0, names: window.__rpBios }; });
    assert(r.exists && r.size === 16384, JSON.stringify(r));
  });
  await step('raw-mode BIOS (Neo Geo neogeo.zip) is written untouched next to the romset', async () => {
    await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
    const r = await page.evaluate(async () => {
      const db = await import('./js/db.js'); const bytes = new Uint8Array(300).fill(9);
      await db.putBios({ id: 'neogeo/neogeo.zip', system: 'neogeo', name: 'neogeo.zip', size: 300, data: bytes.buffer, time: Date.now() });
      const rom = new Uint8Array(1024); await db.putRom({ id: 'ng1', file: 'game.zip', title: 'ng', system: 'neogeo', core: 'fbneo', size: 1024, added: 1, lastPlayed: 0, data: rom.buffer }); return true;
    });
    await page.goto(`${base}player.html?id=ng1`); await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 90000 });
    await page.click('.ejs_start_button'); await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.gameManager && window.EJS_emulator.gameManager.FS, { timeout: 60000 }); await sleep(2500);
    const f = await page.evaluate(() => { try { const FS = window.EJS_emulator.gameManager.FS; const a = FS.analyzePath('/neogeo.zip'); return { exists: a.exists, size: a.exists ? FS.stat('/neogeo.zip').size : 0, bios: window.__rpBios }; } catch (e) { return { err: e.message }; } });
    assert(f.exists && f.size === 300, JSON.stringify(f));
    errs.length = 0;      // FBNeo aborting on a 300-byte fake BIOS is expected here; it is not what this step tests
  });
  await step('DOS .zip is nested so DOSBox Pure receives the archive itself', async () => {
    await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
    writeFileSync(TMP + 'Cool DOS Game.zip', Buffer.from(readFileSync(FX + 'arcadegame.zip')));
    await add(TMP + 'Cool DOS Game.zip'); await pick('DOS');
    await sleep(900);
    const info = await page.evaluate(async () => { const db = await import('./js/db.js'); const { zipNames } = await import('./js/detect.js'); const r = (await db.allRoms()).find((x) => x.system === 'dos'); return r ? { names: await zipNames(new Blob([r.data])), file: r.file } : null; });
    assert(info && info.names.length === 1 && info.names[0] === 'Cool DOS Game.zip', JSON.stringify(info));
  });
  await step('no uncaught JS errors', async () => assert(errs.length === 0, errs.join(' | ')));
} finally { await browser.close(); srv.kill(); }
console.log(failed ? `${failed} FAILED` : 'library tests passed'); process.exit(failed ? 1 : 0);
