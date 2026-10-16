// Cover art + cover picker tests with REAL network access (libretro thumbnails via GitHub, Wikipedia, Commons, Internet Archive).
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('tests/fixtures', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/Super Mario Bros. (World).nes']);
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/Tetris (World).gb']);
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/ds-test.nds']);
// a local test image for the upload path
execFileSync('python3', ['-c', "from PIL import Image; Image.new('RGB',(500,300),(200,40,60)).save('tests/fixtures/upload.png')"]);
const PORT = 18000 + Math.floor(Math.random() * 20000), base = `http://localhost:${PORT}/`;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const step = async (n, f) => { try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 300000, timeout: 120000, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  const artOf = (title) => page.evaluate(async (title) => { const db = await import('./js/db.js'); const r = (await db.allRoms()).find((x) => x.title.startsWith(title)); const a = r && await db.getArt(r.id); return a ? { status: a.status, source: a.source, name: a.name, bytes: a.data ? a.data.byteLength : 0, custom: !!a.custom, via: a.via } : null; }, title);

  await step('auto box art on add: "Super Mario Bros. (World).nes" + "Tetris (World).gb" (real network)', async () => {
    await (await page.$('#file-input')).uploadFile('tests/fixtures/Super Mario Bros. (World).nes', 'tests/fixtures/Tetris (World).gb');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 2, { timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll('.card img.cover').length === 2, { timeout: 90000 });
    const a = await artOf('Super Mario'), b = await artOf('Tetris');
    assert(a.status === 'ok' && a.bytes > 2000 && b.status === 'ok' && b.bytes > 2000, JSON.stringify([a, b]));
    return JSON.stringify([a.name, b.name]);
  });
  await step('art cached in IndexedDB works offline (reload with network blocked)', async () => {
    await page.setOfflineMode(true); await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.card img.cover').length === 2, { timeout: 10000 });
    await page.screenshot({ path: 'tests/out/library-art.png' }); await page.setOfflineMode(false);
  });
  await step('thumbnails.libretro.com CORS check (documented finding)', async () => {
    const r = await page.evaluate(async () => { try { await fetch('https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/Tetris%20(World)%20(Rev%201).png'); return 'fetch allowed'; } catch (e) { return 'fetch blocked: ' + e.message; } });
    return r;
  });
  await step('DS ROM is detected as Nintendo DS', async () => {
    await (await page.$('#file-input')).uploadFile('tests/fixtures/ds-test.nds');
    await page.waitForFunction(() => [...document.querySelectorAll('.badge')].some((b) => b.textContent === 'DS'), { timeout: 8000 });
  });
  const open = async (title) => {
    await page.evaluate((t) => { [...document.querySelectorAll('.card')].find((c) => c.querySelector('.name').textContent.startsWith(t)).querySelector('.more').click(); }, title);
    await page.waitForSelector('#sheet[open]');
    await page.evaluate(() => [...document.querySelectorAll('#sheet .row')].find((b) => b.textContent.includes('Change cover')).click());
    await page.waitForSelector('#cover[open] #cover-q');
  };
  await step('picker prefilled + real searches return results (Super Mario Bros NES)', async () => {
    await open('Super Mario');
    const q = await page.$eval('#cover-q', (e) => e.value); assert(/Super Mario Bros/.test(q) && /NES/.test(q), q);
    await page.$eval('#cover-q', (e) => (e.value = 'Super Mario Bros NES')); await page.click('#cover-go');
    await page.waitForFunction(() => document.querySelectorAll('.cv-src.pending').length === 0, { timeout: 60000 });
    const res = await page.evaluate(() => [...document.querySelectorAll('.cv-src')].map((c) => c.textContent + (c.title ? ` (${c.title})` : '')));
    console.log('   sources:', JSON.stringify(res));
    await sleep(2500); await page.screenshot({ path: 'tests/out/picker.png' });
    const n = await page.$$eval('.cv-tile', (t) => t.length); assert(n > 3, 'tiles ' + n);
    return res.join(' | ');
  });
  await step('select a Wikipedia/libretro result -> preview -> save as custom cover', async () => {
    await page.evaluate(() => { const t = [...document.querySelectorAll('.cv-tile')].find((x) => /Wikipedia/.test(x.title)) || document.querySelector('.cv-tile'); t.click(); });
    await page.waitForSelector('#cover-canvas', { timeout: 40000 });
    await page.screenshot({ path: 'tests/out/picker-edit.png' });
    await page.click('#cover-save'); await page.waitForFunction(() => !document.querySelector('#cover[open]'), { timeout: 10000 });
    const a = await artOf('Super Mario'); assert(a.custom && a.status === 'ok' && a.source === 'custom', JSON.stringify(a)); return JSON.stringify(a);
  });
  await step('upload an image from device, crop/fit, save', async () => {
    await open('Tetris'); await (await page.$('#cover-file')).uploadFile('tests/fixtures/upload.png');
    await page.waitForSelector('#cover-canvas', { timeout: 10000 });
    await page.$eval('#cover-zoom', (e) => { e.value = 1.5; e.dispatchEvent(new Event('input')); });
    await page.click('#cover-save'); await page.waitForFunction(() => !document.querySelector('#cover[open]'), { timeout: 10000 });
    const a = await artOf('Tetris'); assert(a.custom && a.via === 'file', JSON.stringify(a));
  });
  await step('paste an image URL (Wikimedia, CORS ok) and save', async () => {
    await open('Tetris');
    await page.type('#cover-url', 'https://upload.wikimedia.org/wikipedia/en/0/03/Super_Mario_Bros._box.png'); await page.click('#cover-url-go');
    await page.waitForFunction(() => document.querySelector('.cv-head h3')?.textContent === 'Preview');
    await page.waitForSelector('#cover-canvas', { timeout: 40000 }); await page.click('#cover-save');
    await page.waitForFunction(() => !document.querySelector('#cover[open]'), { timeout: 10000 });
    const a = await artOf('Tetris'); assert(a.custom && a.via === 'direct' && a.name === 'Pasted URL', JSON.stringify(a)); return a.via;
  });
  await step('paste a NON-CORS image URL -> proxy or link-only fallback (no crash)', async () => {
    await open('Tetris');
    await page.type('#cover-url', 'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/Tetris%20(World)%20(Rev%201).png'); await page.click('#cover-url-go');
    await page.waitForSelector('#cover-canvas, .cv-remote, .cv-src.err', { timeout: 60000 });
    const kind0 = await page.evaluate(() => document.querySelector('.cv-head h3')?.textContent); const kind = await page.evaluate(() => document.querySelector('#cover-canvas') ? 'canvas (via proxy)' : document.querySelector('.cv-remote') ? 'link-only' : 'error shown');
    if (kind !== 'error shown') { await page.click('#cover-save'); await page.waitForFunction(() => !document.querySelector('#cover[open]'), { timeout: 10000 }); }
    const a = await artOf('Tetris'); assert(a.name === 'Pasted URL' || kind === 'error shown', JSON.stringify(a)); return kind + ' -> ' + JSON.stringify(a);
  });
  await step('Reset to automatic restores libretro art', async () => {
    await open('Tetris'); await page.click('#cover-reset');
    await page.waitForFunction(async () => { const db = await import('./js/db.js'); const r = (await db.allRoms()).find((x) => x.title.startsWith('Tetris')); const a = await db.getArt(r.id); return a && a.status === 'ok' && !a.custom; }, { timeout: 60000 });
  });
  await step('no uncaught JS errors', async () => assert(!errs.length, errs.join(' | ')));
} finally { await browser.close(); srv.kill(); }
process.exit(failed ? 1 : 0);
