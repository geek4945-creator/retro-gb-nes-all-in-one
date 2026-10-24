// Close / Back / Save / Done live at the TOP of the screen (inside the safe area) everywhere: library sheets, Settings,
// toasts, EmulatorJS popups and the touch layout editor. Phones' navigation buttons cover the bottom edge.
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
const rom = [...readFileSync('tests/fixtures/nes-test.nes')];
const H = 844;
await sleep(800);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 390, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async (b) => { const db = await import('./js/db.js'); await db.putRom({ id: 'b1', file: 'nes-test.nes', title: 'NES Test', system: 'nes', core: 'nestopia', size: b.length, added: 1, lastPlayed: 0, data: new Uint8Array(b).buffer }); }, rom);
  await page.reload({ waitUntil: 'networkidle0' });
  // every visible action button of an open dialog: where is it?
  const actions = (sel) => page.$eval(sel, (d) => [...d.querySelectorAll('button')].filter((b) => /^(‹\s*)?(close|back|done|cancel|save)\b/i.test(b.textContent.trim()) && b.offsetParent).map((b) => ({ t: b.textContent.trim(), top: Math.round(b.getBoundingClientRect().top), inBar: !!b.closest('.sheet-top') })));

  await step('Settings: Close is in the sticky top bar, not at the bottom', async () => {
    await page.click('#btn-settings'); await page.waitForSelector('#settings .sheet-top', { visible: true });
    const a = await actions('#settings'); assert(a.length && a.every((x) => x.inBar && x.top < 140), JSON.stringify(a));
    await page.evaluate(() => { const d = document.getElementById('settings'); d.scrollTop = d.scrollHeight; }); await sleep(200);
    const after = await actions('#settings'); assert(after.every((x) => x.top < 140), 'top bar must stay visible when scrolled: ' + JSON.stringify(after));
    await page.screenshot({ path: 'tests/out/topbar-settings.png' }); return JSON.stringify(after);
  });
  await step('Settings sub-pages (Performance & device) keep ‹ Back at the top', async () => {
    await page.evaluate(() => document.getElementById('settings').scrollTop = 0); await page.$eval('#btn-perf', (e) => e.click()); await page.waitForSelector('#perf-back');
    await page.waitForSelector('#perf-info', { timeout: 10000 }); const a = await actions('#settings'); assert(a.some((x) => /Back/.test(x.t) && x.inBar && x.top < 140), JSON.stringify(a));
    await page.$eval('#perf-back', (e) => e.click()); await page.waitForSelector('#btn-perf', { visible: true }); await page.evaluate(() => document.getElementById('settings').close()); return JSON.stringify(a);
  });
  await step('game sheet: Close at the top; toasts appear at the top', async () => {
    await page.$eval('#library .card .more', (e) => e.click()); await page.waitForSelector('#sheet-fav', { visible: true });
    const a = await actions('#sheet'); assert(a.length && a.every((x) => x.inBar && x.top < 140), JSON.stringify(a));
    await page.$eval('#sheet-fav', (e) => e.click()); await page.waitForSelector('#toast', { visible: true });
    const t = await page.$eval('#toast', (e) => e.getBoundingClientRect().top); assert(t < H * 0.25, 'toast at ' + t);
    await page.evaluate(() => document.getElementById('sheet').close()); return `toast top ${Math.round(t)}px`;
  });
  await step('stylesheets reserve the top / bottom safe areas (iPhone notch / home indicator, Android nav bar)', async () => {
    const css = readFileSync('www/css/app.css', 'utf8') + readFileSync('www/css/player.css', 'utf8');
    for (const k of ['safe-area-inset-top', 'safe-area-inset-bottom']) assert(css.includes(k), k);
    const cfg = JSON.parse(readFileSync('capacitor.config.json', 'utf8')); assert(cfg.android && cfg.android.adjustMarginsForEdgeToEdge === 'auto', 'Android 15 edge-to-edge margins');
    return 'ok';
  });
  await page.goto(`${base}player.html?id=b1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 }); await page.tap('.ejs_start_button');
  await page.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 }); await sleep(1000);
  await step('EmulatorJS popups: buttons above the content, our ☰ hidden while open, Close works', async () => {
    await page.evaluate(() => { const b = EJS_emulator.createPopup('Test popup', { Save: () => {}, Close: () => EJS_emulator.closePopup() }); b.style.height = '2000px'; }); await sleep(300);
    const r = await page.evaluate(() => { const c = EJS_emulator.currentPopup || document.querySelector('.ejs_popup_container'); const btns = [...c.querySelectorAll('.ejs_button')].map((b) => Math.round(b.getBoundingClientRect().bottom)); const body = c.querySelector('.ejs_popup_body').getBoundingClientRect(); return { btns, bodyTop: Math.round(body.top), menuHidden: getComputedStyle(document.getElementById('menu-btn')).visibility === 'hidden' }; });
    assert(r.btns.length === 2 && r.btns.every((b) => b <= r.bodyTop + 1 && b < 200), JSON.stringify(r)); assert(r.menuHidden, '☰ should hide under popups');
    await page.screenshot({ path: 'tests/out/topbar-popup.png' });
    await page.evaluate(() => [...EJS_emulator.currentPopup.querySelectorAll('.ejs_button')].find((b) => b.textContent === 'Close').click()); await sleep(300);
    const after = await page.evaluate(() => ({ open: [...document.querySelectorAll('.ejs_popup_container')].some((c) => c.getClientRects().length > 0), menu: getComputedStyle(document.getElementById('menu-btn')).visibility }));
    assert(!after.open && after.menu !== 'hidden', JSON.stringify(after) + await page.evaluate(() => [...document.querySelectorAll('.ejs_popup_container')].filter((c) => c.getClientRects().length).map((c) => c.outerHTML.slice(0, 300)).join(' ## '))); return JSON.stringify(r);
  });
  await step('touch layout editor: Hide / Reset / Done are the first row at the top; Hide collapses the panel', async () => {
    await page.tap('#menu-btn'); await sleep(300); await page.tap('#pm-touch'); await page.waitForSelector('#tl-editor');
    const r = await page.evaluate(() => ({ done: document.getElementById('tl-done').getBoundingClientRect().top, reset: document.getElementById('tl-reset').getBoundingClientRect().top, hide: document.getElementById('tl-move').getBoundingClientRect().top }));
    assert(r.done < 160 && r.reset < 160 && r.hide < 160, JSON.stringify(r));
    await page.tap('#tl-move'); await sleep(200);
    const min = await page.evaluate(() => ({ min: document.getElementById('tl-bar').classList.contains('tl-min'), more: getComputedStyle(document.querySelector('#tl-bar .tl-more')).display, label: document.getElementById('tl-move').textContent, done: !!document.getElementById('tl-done').offsetParent }));
    assert(min.min && min.more === 'none' && /Show/.test(min.label) && min.done, JSON.stringify(min));
    await page.tap('#tl-done'); await sleep(300); return JSON.stringify(r);
  });
  await step('no page errors', async () => { assert(!errs.length, errs.join(' | ')); return 'ok'; });
} catch (e) { failed++; console.log('FAIL fatal', e.message); }
await browser.close(); srv.kill();
console.log(`\n${total - failed}/${total} passed`); process.exit(failed ? 1 : 0);
