// Controller tests with a MOCKED Gamepad API (navigator.getGamepads overridden) in headless Chrome.
// Real Bluetooth/USB hardware, iOS Safari and the Capacitor WebView are NOT covered (see README).
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
mkdirSync('tests/fixtures', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/nes-test.nes']);
const PORT = 18000 + Math.floor(Math.random() * 20000), base = `http://localhost:${PORT}/`;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const step = async (n, f) => { try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 300000, timeout: 120000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const bytes = [...readFileSync('tests/fixtures/nes-test.nes')];
const XBOX = 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', DS4 = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)';

async function newPage() {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    window.__mockPads = [];
    navigator.getGamepads = () => window.__mockPads.slice();
    window.mkPad = (index, id) => ({ id, index, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
    window.setBtn = (pi, b, v) => { const p = window.__mockPads.find((x) => x.index === pi); p.buttons[b] = { pressed: v > 0.5, value: v }; };
  });
  page.errs = []; page.on('pageerror', (e) => page.errs.push(e.message));
  return page;
}
const connect = (page, index, id) => page.evaluate((i, id) => { window.__mockPads.push(window.mkPad(i, id)); window.dispatchEvent(new Event('gamepadconnected')); }, index, id);
const tap = async (page, pi, b, ms = 110) => { await page.evaluate((pi, b) => window.setBtn(pi, b, 1), pi, b); await sleep(ms); try { await page.evaluate((pi, b) => window.setBtn(pi, b, 0), pi, b); } catch { /* page navigated away (A launched a game) */ } await sleep(90); };
async function seed(page, roms) {
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async (roms, bytes) => {
    const db = await import('./js/db.js');
    for (const r of roms) await db.putRom({ id: r.id, file: r.file, title: r.title, system: r.system, core: r.core, size: bytes.length, added: Date.now(), lastPlayed: Date.now() - r.age, data: new Uint8Array(bytes).buffer });
  }, roms, bytes);
  await page.reload({ waitUntil: 'networkidle0' });
}
try {
  /* ---------- library ---------- */
  const lib = await newPage();
  await seed(lib, [
    { id: 'a', file: 'a.gb', title: 'Alpha', system: 'gb', core: 'gambatte', age: 1 }, { id: 'b', file: 'b.gb', title: 'Bravo', system: 'gb', core: 'gambatte', age: 2 },
    { id: 'c', file: 'c.nes', title: 'Charlie', system: 'nes', core: 'nestopia', age: 3 }, { id: 'd', file: 'd.nes', title: 'Delta', system: 'nes', core: 'nestopia', age: 4 }]);
  await lib.waitForSelector('.card');
  await step('connect toast on controller connect (library)', async () => {
    await connect(lib, 0, XBOX);
    await lib.waitForFunction(() => /connected/.test(document.querySelector('#toast').textContent) && !document.querySelector('#toast').hidden, { timeout: 4000 });
    return await lib.$eval('#toast', (e) => e.textContent);
  });
  const focusName = () => lib.evaluate(() => (document.activeElement.querySelector && document.activeElement.querySelector('.name') || {}).textContent);
  await step('d-pad moves focus between games; A launches', async () => {
    await tap(lib, 0, 15); const a = await focusName();            // first press focuses first card
    await tap(lib, 0, 15); const b = await focusName();            // right -> next card
    assert(a && b && a !== b, `focus ${a} -> ${b}`);
    await tap(lib, 0, 13); const c = await focusName();            // down -> next row
    await tap(lib, 0, 1);                                         // A (right face button, Nintendo layout)
    await lib.waitForFunction(() => location.pathname.endsWith('player.html'), { timeout: 8000 });
    return `${a} -> ${b} -> ${c} -> player`;
  });
  await step('shoulder buttons switch system filter; Start opens game menu; B closes it; Select opens settings', async () => {
    await lib.goto(base + 'index.html', { waitUntil: 'networkidle0' }); await lib.waitForSelector('.card'); await connect(lib, 0, XBOX); await sleep(900);
    const on0 = await lib.$eval('#chips .chip.on', (e) => e.textContent);
    await tap(lib, 0, 5); const on1 = await lib.$eval('#chips .chip.on', (e) => e.textContent); assert(on0 !== on1, `${on0} ${on1}`);
    await tap(lib, 0, 15); await tap(lib, 0, 9); await lib.waitForSelector('#sheet[open]', { timeout: 3000 });
    await tap(lib, 0, 0); await lib.waitForFunction(() => !document.querySelector('#sheet[open]'), { timeout: 3000 });
    await tap(lib, 0, 8); await lib.waitForSelector('#settings[open]', { timeout: 3000 });
    return `${on0} -> ${on1}`;
  });
  await step('Settings > Controllers lists the pad, shows live input, and has no About tab', async () => {
    await lib.click('#btn-controllers'); await lib.waitForSelector('#pads[open] .pad-item', { timeout: 3000 });
    await lib.evaluate(() => window.setBtn(0, 3, 1)); await sleep(400);
    const t = await lib.$eval('.pad-live', (e) => e.textContent); await lib.evaluate(() => window.setBtn(0, 3, 0));
    assert(/Face ↑/.test(t), t);
    const about = await lib.evaluate(() => /about|credits/i.test(document.body.innerText)); assert(!about, 'about text found');
    await lib.screenshot({ path: 'tests/out/controllers.png' }); return t.slice(0, 60);
  });
  await step('remap A to a different pad button via capture; layout + deadzone + player assignment persist', async () => {
    await lib.click('.map-pad[data-i="8"]'); await sleep(200);
    await tap(lib, 0, 2);                                          // press "Face ←" (BUTTON_3)
    await lib.waitForFunction(() => /Face ←/.test(document.querySelector('.map-pad[data-i="8"]').textContent), { timeout: 3000 });
    await lib.$eval('#pad-dz', (e) => { e.value = 0.3; e.dispatchEvent(new Event('input')); });
    await lib.select('#pad-layout', 'xbox');
    await lib.select('.pad-item select', '1');
    const cfg = await lib.evaluate(() => JSON.parse(localStorage.getItem('rp.pad')));
    assert(cfg.map['0']['8'].pad === 'BUTTON_3' && cfg.deadzone === 0.3 && cfg.layout === 'xbox' && cfg.assign[Object.keys(cfg.assign)[0]] === 1, JSON.stringify(cfg));
    return JSON.stringify(cfg);
  });
  await step('keyboard remap capture', async () => {
    await lib.click('.map-key[data-i="0"]'); await lib.keyboard.press('KeyK'); await sleep(200);
    const cfg = await lib.evaluate(() => JSON.parse(localStorage.getItem('rp.pad'))); assert(cfg.map['0']['0'].key === 'k', JSON.stringify(cfg.map));
  });
  await step('disconnect toast (library)', async () => {
    await lib.evaluate(() => { window.__mockPads.length = 0; }); await lib.waitForFunction(() => /disconnected/.test(document.querySelector('#toast').textContent), { timeout: 4000 });
  });
  await lib.close();

  /* ---------- player ---------- */
  const p = await newPage();
  await seed(p, [{ id: 'n', file: 'nes-test.nes', title: 'nes test', system: 'nes', core: 'nestopia', age: 0 }]);
  await p.goto(base + 'player.html?id=n', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.ejs_start_button', { visible: true, timeout: 90000 });
  await connect(p, 0, XBOX);
  await p.click('.ejs_start_button');
  await p.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, { timeout: 90000 });
  await sleep(1500);
  await p.evaluate(() => { const gm = window.EJS_emulator.gameManager; window.__calls = []; const o = gm.simulateInput.bind(gm); gm.simulateInput = (...a) => { window.__calls.push(a); return o(...a); }; window.__qs = 0; window.__ql = 0; gm.quickSave = (...a) => { window.__qs++; return true; }; gm.quickLoad = (...a) => { window.__ql++; }; });
  const calls = () => p.evaluate(() => window.__calls.splice(0));
  await step('EJS_defaultControls covers 4 players with pad bindings (incl. P2-P4)', async () => {
    const c = await p.evaluate(() => ({ p1: window.EJS_defaultControls[0][8], p2: window.EJS_defaultControls[1][8], p4: window.EJS_defaultControls[3][3], kb: window.EJS_defaultControls[0][3] }));
    assert(c.p1.value2 === 'BUTTON_2' && c.p2.value2 === 'BUTTON_2' && c.p4.value2 === 'START' && c.kb.value === 'enter', JSON.stringify(c)); return JSON.stringify(c);
  });
  await step('connected pad -> player 1, on-screen pad hidden', async () => {
    const r = await p.evaluate(() => ({ sel: window.EJS_emulator.gamepadSelection.slice(), hidden: getComputedStyle(document.querySelector('.ejs_virtualGamepad_parent')).display }));
    assert(r.sel[0] && r.hidden === 'none', JSON.stringify(r)); return JSON.stringify(r);
  });
  await step('button press reaches the core as RetroPad A (Nintendo layout: right face = A)', async () => {
    await calls(); await tap(p, 0, 1); const c = await calls();
    assert(c.some((x) => x[0] === 0 && x[1] === 8 && x[2] === 1), JSON.stringify(c)); return JSON.stringify(c.slice(0, 2));
  });
  await step('deadzone: small stick motion ignored, large motion = D-pad right', async () => {
    await calls(); await p.evaluate(() => { window.__mockPads[0].axes[0] = 0.1; }); await sleep(300); const small = await calls();
    await p.evaluate(() => { window.__mockPads[0].axes[0] = 0.9; }); await sleep(300); const big = await calls(); await p.evaluate(() => { window.__mockPads[0].axes[0] = 0; }); await sleep(200);
    assert(!small.some((x) => x[1] === 7 && x[2]) && big.some((x) => x[1] === 7 && x[2] === 1), JSON.stringify({ small, big }));
  });
  await step('analog trigger (value 0.6, pressed=false) acts as R2 button', async () => {
    await calls(); await p.evaluate(() => window.setBtn(0, 7, 0.6)); await p.evaluate(() => { window.__mockPads[0].buttons[7].pressed = false; }); await sleep(300); const c = await calls(); await p.evaluate(() => window.setBtn(0, 7, 0)); await sleep(150);
    assert(c.some((x) => x[1] === 13 && x[2] === 1), JSON.stringify(c));
  });
  await step('second controller becomes player 2 and drives P2 inputs', async () => {
    await connect(p, 1, DS4); await p.waitForFunction(() => window.EJS_emulator.gamepadSelection[1], { timeout: 4000 }); await sleep(500);   // EmulatorJS registers a new pad on its next poll
    await calls(); await tap(p, 1, 1); const c = await calls(); assert(c.some((x) => x[0] === 1 && x[1] === 8 && x[2] === 1), JSON.stringify(c));
    return `P2 = ${await p.evaluate(() => window.EJS_emulator.gamepadSelection[1].slice(0, 30))}`;
  });
  await step('touch re-shows the on-screen pad; controller input hides it again', async () => {
    await p.touchscreen.tap(200, 700); await sleep(300);
    const shown = await p.evaluate(() => getComputedStyle(document.querySelector('.ejs_virtualGamepad_parent')).display); assert(shown !== 'none', 'display ' + shown);
    await tap(p, 0, 0); await sleep(300);
    const hidden = await p.evaluate(() => getComputedStyle(document.querySelector('.ejs_virtualGamepad_parent')).display); assert(hidden === 'none', 'display ' + hidden);
  });
  await step('hotkeys: Select+R1 quick-save, Select+L1 quick-load; Start/R1 masked from the game while Select held', async () => {
    await calls();
    await p.evaluate(() => window.setBtn(0, 8, 1)); await sleep(200);
    await tap(p, 0, 5); await tap(p, 0, 4);
    await p.evaluate(() => window.setBtn(0, 8, 0)); await sleep(150);
    const r = await p.evaluate(() => ({ qs: window.__qs, ql: window.__ql })); const c = await calls();
    assert(r.qs === 1 && r.ql === 1, JSON.stringify(r)); assert(!c.some((x) => x[1] === 11 && x[2] === 1), 'R1 leaked to the game: ' + JSON.stringify(c));
  });
  await step('hotkey Select+Start (hold) opens the pause menu; confirm on Resume continues', async () => {
    await p.evaluate(() => { window.setBtn(0, 8, 1); window.setBtn(0, 9, 1); }); await sleep(800);
    await p.evaluate(() => { window.setBtn(0, 8, 0); window.setBtn(0, 9, 0); }); await sleep(200);
    await p.waitForSelector('#pmenu', { visible: true, timeout: 2000 });
    assert(await p.evaluate(() => window.EJS_emulator.paused), 'not paused');
    await p.screenshot({ path: 'tests/out/pause-menu.png' });
    await tap(p, 0, 13); await tap(p, 0, 12);                       // focus moves down/up inside the menu
    await tap(p, 0, 1); await tap(p, 0, 1);                         // first A focuses Resume (or confirms it), second confirms
    await p.waitForFunction(() => document.querySelector('#pmenu').hidden, { timeout: 3000 });
    assert(!(await p.evaluate(() => window.EJS_emulator.paused)), 'still paused');
  });
  await step('disconnect shows the touch pad again + toast', async () => {
    await p.evaluate(() => { window.__mockPads.length = 0; }); await sleep(1200);
    const r = await p.evaluate(() => ({ d: getComputedStyle(document.querySelector('.ejs_virtualGamepad_parent')).display, t: document.querySelector('#ptoast').textContent }));
    assert(r.d !== 'none' && /disconnected/.test(r.t), JSON.stringify(r));
  });
  await step('no uncaught JS errors', async () => assert(!p.errs.length, p.errs.join(' | ')));
  await p.close();

  /* ---------- saved remap + player assignment are applied in game ---------- */
  const q = await newPage();
  await q.evaluateOnNewDocument((x) => { if (!localStorage.getItem('rp.pad')) localStorage.setItem('rp.pad', JSON.stringify({ map: { 0: { 8: { pad: 'BUTTON_3' } } }, assign: { [x]: 1 } })); }, XBOX);
  await seed(q, [{ id: 'n', file: 'nes-test.nes', title: 'nes test', system: 'nes', core: 'nestopia', age: 0 }]);
  await q.goto(base + 'player.html?id=n', { waitUntil: 'domcontentloaded' });
  await q.waitForSelector('.ejs_start_button', { visible: true, timeout: 90000 });
  await connect(q, 0, XBOX); await connect(q, 1, DS4);
  await q.click('.ejs_start_button');
  await q.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, { timeout: 90000 }); await sleep(1500);
  await q.evaluate(() => { const gm = window.EJS_emulator.gameManager; window.__calls = []; const o = gm.simulateInput.bind(gm); gm.simulateInput = (...a) => { window.__calls.push(a); return o(...a); }; });
  await step('saved remap (P1 A -> face-left) and assignment (Xbox pad = Player 2, DS4 = Player 1) apply in game', async () => {
    const sel = await q.evaluate(() => window.EJS_emulator.gamepadSelection.map((x) => x.slice(0, 12)));
    assert(/^Wireless/.test(sel[0]) && /^Xbox/.test(sel[1]), JSON.stringify(sel));
    await q.evaluate(() => window.__calls.splice(0)); await tap(q, 1, 2); const c = await q.evaluate(() => window.__calls.splice(0));       // DS4 = Player 1, whose A is remapped to face-left
    assert(c.some((x) => x[0] === 0 && x[1] === 8 && x[2] === 1), JSON.stringify(c));
    await tap(q, 0, 2); const c2 = await q.evaluate(() => window.__calls.splice(0));       // Xbox pad = Player 2, default layout: face-left = Y
    assert(c2.some((x) => x[0] === 1 && x[1] === 1 && x[2] === 1), JSON.stringify(c2)); return JSON.stringify(sel);
  });
  await q.close();
} finally { await browser.close(); srv.kill(); }
process.exit(failed ? 1 : 0);
