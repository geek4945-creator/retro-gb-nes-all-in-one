// Favorites, recents, play time, sorting and collections; play time is counted by the real player (EmulatorJS boots the NES test ROM).
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
mkdirSync('tests/fixtures', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/nes-test.nes']);
const PORT = 18000 + Math.floor(Math.random() * 20000), base = `http://localhost:${PORT}/`;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0;
const step = async (n, f) => { total++; try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const rom = readFileSync('tests/fixtures/nes-test.nes');
await sleep(800);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const names = (p) => p.$$eval('#library .card .name', (e) => e.map((x) => x.textContent));
const chips = (p) => p.$$eval('#chips .chip', (e) => e.map((x) => x.textContent));
try {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Renamed' : undefined));
  await page.setViewport({ width: 420, height: 860 });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async (b) => { const db = await import('./js/db.js'); const mk = (id, title, system, added) => db.putRom({ id, file: title + '.nes', title, system, core: system === 'nes' ? 'nestopia' : 'gambatte', size: b.length, added, lastPlayed: 0, data: new Uint8Array(b).buffer });
    await mk('a', 'Zeta Quest', 'nes', 3); await mk('b', 'alpha Run', 'gb', 2); await mk('c', 'Mega Test', 'nes', 1); localStorage.setItem('rp.hintDismissed', '1'); }, [...rom]);
  await page.reload({ waitUntil: 'networkidle0' });
  await step('no special chips before anything is played/starred; sort A–Z works (case-insensitive)', async () => {
    const c = await chips(page); assert(!c.some((x) => /Favorites|Recent/.test(x)), c.join(','));
    await page.select('#sort', 'az'); const n = await names(page); assert(n.join() === 'alpha Run,Mega Test,Zeta Quest', n.join()); return c.join(',');
  });
  await step('⋯ → ☆ Add to favorites shows a ★ badge and a ★ Favorites chip that filters', async () => {
    const cards = await page.$$('#library .card'); await (await cards[1].$('.more')).evaluate((e) => e.click()); await page.waitForSelector('#sheet-fav', { visible: true });
    assert(/Not played yet/.test(await page.$eval('#sheet-play', (e) => e.textContent)));
    await page.click('#sheet-fav'); assert(/Remove from favorites/.test(await page.$eval('#sheet-fav', (e) => e.textContent)));
    await page.evaluate(() => document.getElementById('sheet').close());
    assert(await page.$eval('#library .card:nth-child(2) .fav', (e) => e.textContent === '★'), 'badge');
    await page.click('#chips .chip[data-f="fav"]'); const n = await names(page); assert(n.join() === 'Mega Test', n.join()); return n.join();
  });
  await step('📁 Collections: create one from the sheet, game is added, chip filters; rename works', async () => {
    await page.click('#chips .chip[data-f="all"]');
    const cards = await page.$$('#library .card'); await (await cards[2].$('.more')).evaluate((e) => e.click()); await page.waitForSelector('#sheet-cols', { visible: true });
    await page.click('#sheet-cols'); await page.type('#col-new', 'Couch co-op'); await page.click('#col-add'); await sleep(200);
    assert(await page.$eval('.col-on', (e) => e.checked), 'not checked');
    await page.click('.col-row button[title="Rename"]'); await sleep(200);
    await page.evaluate(() => document.getElementById('sheet').close());
    const c = await chips(page); assert(c.includes('📁 Renamed'), c.join(','));
    const cid = await page.evaluate(() => JSON.parse(localStorage.getItem('rp.collections'))[0].id);
    await page.click(`#chips .chip[data-f="col:${cid}"]`); const n = await names(page); assert(n.join() === 'Zeta Quest', n.join()); return c.join(',');
  });
  await step('playing a game counts play time + a session (only while running) and adds it to 🕘 Recent', async () => {
    await page.goto(`${base}player.html?id=b`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 }); await page.click('.ejs_start_button');
    await page.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 }); await sleep(3500);
    await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });           // pagehide flushes the tracker
    const m = await page.evaluate(() => JSON.parse(localStorage.getItem('rp.meta')).b);
    assert(m.plays === 1 && m.play >= 2000 && m.play < 30000 && m.last, JSON.stringify(m));
    await page.click('#chips .chip[data-f="recent"]'); const n = await names(page); assert(n.join() === 'alpha Run', n.join()); return JSON.stringify(m);
  });
  await step('“Most played” sort + ⏱ badge for ≥1 min + sheet shows play time', async () => {
    await page.evaluate(async () => { const mt = await import('./js/meta.js'); mt.addPlay('c', 3 * 3600e3 + 5 * 60e3); });
    await page.reload({ waitUntil: 'networkidle0' }); await page.click('#chips .chip[data-f="all"]'); await page.select('#sort', 'played');
    const n = await names(page); assert(n[0] === 'Mega Test' && n[1] === 'alpha Run', n.join());
    const pt = await page.$eval('#library .card .ptime', (e) => e.textContent); assert(pt === '⏱ 3h 5m', pt);
    await (await (await page.$$('#library .card'))[0].$('.more')).evaluate((e) => e.click()); await page.waitForSelector('#sheet-play', { visible: true }); const s = await page.$eval('#sheet-play', (e) => e.textContent); assert(/Played 3h 5m/.test(s), s);
    await page.evaluate(() => document.getElementById('sheet').close()); await page.screenshot({ path: 'tests/out/organize.png' }); return s;
  });
  await step('📝 per-game compatibility note is saved from the sheet and shown again', async () => {
    await (await (await page.$$('#library .card'))[0].$('.more')).evaluate((e) => e.click()); await page.waitForSelector('#sheet-note', { visible: true });
    await page.type('#sheet-note', 'works best on PicoDrive'); await page.$eval('#sheet-note', (e) => e.dispatchEvent(new Event('change')));
    await page.evaluate(() => document.getElementById('sheet').close());
    await (await (await page.$$('#library .card'))[0].$('.more')).evaluate((e) => e.click()); await page.waitForSelector('#sheet-note', { visible: true });
    const v = await page.$eval('#sheet-note', (e) => e.value); await page.evaluate(() => document.getElementById('sheet').close());
    assert(v === 'works best on PicoDrive', v); return v;
  });
  await step('removing a game cleans its favorite/collection entries; meta is in backups', async () => {
    await (await (await page.$$('#library .card'))[0].$('.more')).evaluate((e) => e.click()); await page.waitForSelector('#sheet .row.danger');
    await page.click('#sheet .row.danger'); await sleep(500);
    const r = await page.evaluate(async () => { const bk = await import('./js/backup.js'); const z = await bk.exportBackup({ includeGames: false }); const t = await z.text(); return { m: JSON.parse(localStorage.getItem('rp.meta')), c: JSON.parse(localStorage.getItem('rp.collections')), inBk: t.includes('rp.meta') && t.includes('rp.collections') }; });
    assert(!r.m.c && r.inBk, JSON.stringify(r)); const c = await chips(page); assert(!c.some((x) => /Favorites/.test(x)), c.join(',')); return c.join(',');
  });
  await step('no page errors', async () => { assert(!errs.length, errs.join(' | ')); });
} finally { await browser.close(); srv.kill(); }
console.log(`\n${total - failed}/${total} passed`); process.exit(failed ? 1 : 0);
