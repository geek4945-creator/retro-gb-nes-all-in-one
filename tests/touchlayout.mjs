// Touch layout editor: drag/resize controls, opacity, presets, skins, saved per system; the moved + resized d-pad still maps touches correctly.
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
try {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async (b) => { const db = await import('./js/db.js'); await db.putRom({ id: 't1', file: 'nes-test.nes', title: 'NES Test', system: 'nes', core: 'nestopia', size: b.length, added: 1, lastPlayed: 0, data: new Uint8Array(b).buffer }); }, [...rom]);
  const boot = async () => {
    await page.goto(`${base}player.html?id=t1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 }); await page.tap('.ejs_start_button');
    await page.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 }); await sleep(1200);
  };
  const rect = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; });
  await boot();
  let a0, d0;
  await step('☰ → 🎮 Touch layout opens the editor over the game (paused)', async () => {
    a0 = await rect('.ejs_virtualGamepad_button.b_a'); d0 = await rect('.b_dpad .ejs_dpad_main');
    await page.tap('#menu-btn'); await sleep(300); await page.tap('#pm-touch'); await page.waitForSelector('#tl-editor');
    assert(await page.evaluate(() => EJS_emulator.paused), 'not paused'); return JSON.stringify({ a0, d0 });
  });
  await step('drag A by (-120, -60) px moves it; tap → Size 150% scales it', async () => {
    await page.mouse.move(a0.x, a0.y); await page.mouse.down(); await page.mouse.move(a0.x - 60, a0.y - 30, { steps: 4 }); await page.mouse.move(a0.x - 120, a0.y - 60, { steps: 4 }); await page.mouse.up();
    await page.$eval('#tl-size', (e) => { e.value = 150; e.dispatchEvent(new Event('input')); });
    const a1 = await rect('.ejs_virtualGamepad_button.b_a');
    assert(Math.abs(a1.x - (a0.x - 120)) < 3 && Math.abs(a1.y - (a0.y - 60)) < 3 && Math.abs(a1.w - a0.w * 1.5) < 2, JSON.stringify(a1));
    assert(/Selected: A/.test(await page.$eval('#tl-sel', (e) => e.textContent))); return JSON.stringify(a1);
  });
  await step('drag + resize the d-pad (130%)', async () => {
    await page.mouse.move(d0.x, d0.y); await page.mouse.down(); await page.mouse.move(d0.x + 80, d0.y - 40, { steps: 6 }); await page.mouse.up();
    await page.$eval('#tl-size', (e) => { e.value = 130; e.dispatchEvent(new Event('input')); });
    const d1 = await rect('.b_dpad .ejs_dpad_main'); assert(Math.abs(d1.x - (d0.x + 80)) < 3 && Math.abs(d1.y - (d0.y - 40)) < 3 && Math.abs(d1.w - d0.w * 1.3) < 2, JSON.stringify(d1)); return JSON.stringify(d1);
  });
  await step('opacity 40% + Neon skin + Done saves the layout for NES', async () => {
    await page.$eval('#tl-opacity', (e) => { e.value = 40; e.dispatchEvent(new Event('input')); }); await page.select('#tl-skin', 'neon');
    await page.screenshot({ path: 'tests/out/touchlayout-editor.png' });
    await page.tap('#tl-done'); await sleep(400);
    const r = await page.evaluate(() => ({ ed: !!document.getElementById('tl-editor'), paused: EJS_emulator.paused, saved: JSON.parse(localStorage.getItem('rp.touch')).nes, op: getComputedStyle(document.querySelector('.ejs_virtualGamepad_left')).opacity, shadow: getComputedStyle(document.querySelector('.ejs_virtualGamepad_button.b_a')).boxShadow }));
    assert(!r.ed && !r.paused && r.saved.skin === 'neon' && r.saved.opacity === 0.4 && r.saved.ctrls.a.s === 1.5 && r.saved.ctrls.dpad.s === 1.3, JSON.stringify(r)); assert(r.op === '0.4' && /rgba?\(25, 230, 255/.test(r.shadow), JSON.stringify(r)); return JSON.stringify(r.saved);
  });
  await step('touching the moved + resized d-pad at its right edge presses RIGHT (and only right); A sends A', async () => {
    await page.evaluate(() => { window.__in = []; const g = EJS_emulator.gameManager, s = g.simulateInput.bind(g); g.simulateInput = (p, i, v) => { window.__in.push(`${i}=${v}`); return s(p, i, v); }; });
    const d = await rect('.b_dpad .ejs_dpad_main'), cdp = await page.createCDPSession();
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', d.x + d.w * 0.4, d.y); await sleep(100);
    const right = await page.evaluate(() => window.__in.slice()); await touch('touchEnd'); await sleep(100);
    await page.evaluate(() => { window.__in = []; }); const a = await rect('.ejs_virtualGamepad_button.b_a'); await touch('touchStart', a.x, a.y); await sleep(50); await touch('touchEnd'); await sleep(100);
    const av = await page.evaluate(() => window.__in.slice());
    assert(right.join() === '4=0,5=0,6=0,7=1', 'dpad ' + right.join()); assert(av[0] === '8=1', 'A ' + av.join()); return right.join() + ' | ' + av.join();
  });
  await step('layout is re-applied after restarting the game', async () => {
    const before = await rect('.ejs_virtualGamepad_button.b_a'); await boot(); const after = await rect('.ejs_virtualGamepad_button.b_a');
    assert(Math.abs(before.x - after.x) < 3 && Math.abs(before.w - after.w) < 2, JSON.stringify({ before, after }));
    assert(await page.evaluate(() => EJS_emulator.virtualGamepad.dataset.rpSkin === 'neon')); await page.screenshot({ path: 'tests/out/touchlayout.png' }); return JSON.stringify(after);
  });
  await step('presets: Left-handed swaps sides, Large scales all; Reset restores defaults', async () => {
    await page.tap('#menu-btn'); await sleep(300); await page.tap('#pm-touch'); await page.waitForSelector('#tl-editor');
    await page.select('#tl-preset', 'lefty'); const dl = await rect('.b_dpad .ejs_dpad_main'); assert(dl.x > 844 / 2, 'dpad not on right ' + dl.x);
    await page.select('#tl-preset', 'large'); const al = await rect('.ejs_virtualGamepad_button.b_a'); assert(Math.abs(al.w - a0.w * 1.25) < 2, 'large ' + al.w);
    await page.tap('#tl-reset'); const ar = await rect('.ejs_virtualGamepad_button.b_a'); assert(Math.abs(ar.x - a0.x) < 3 && Math.abs(ar.w - a0.w) < 2, 'reset ' + JSON.stringify(ar));
    await page.tap('#tl-done'); const st = await page.evaluate(() => JSON.parse(localStorage.getItem('rp.touch')).nes); assert(st && !Object.keys(st.ctrls).length && st.skin === 'classic', JSON.stringify(st)); return 'ok';
  });
  await step('no page errors', async () => { assert(!errs.length, errs.join(' | ')); });
} finally { await browser.close(); srv.kill(); }
console.log(`\n${total - failed}/${total} passed`); process.exit(failed ? 1 : 0);
