// Physical controller → core, end to end, with a MOCKED Gamepad API (navigator.getGamepads) in headless Chrome.
// Checked at the last JS hop before the emulator core (gameManager.functions.simulateInput = the wasm export):
//   * a standard pad pushed RIGHT (axes[0] = +1) reaches the core as analog "stick right" (index 16 = 0x7fff), left as 17;
//   * "Invert ←→" in Settings → Controllers really flips a physical controller;
//   * stick-direction remaps from Settings → Controllers work (EmulatorJS alone ignores the +/- of a stick binding);
//   * button remaps work; changes made in the in-game EmulatorJS Control Settings take effect at once and survive a reload;
//   * the Controllers screen has stick-direction rows and a live "Test controller" view (raw axes/buttons → mapped control).
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
const PAD = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)';
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const logs = []; page.on('console', (m) => logs.push(m.text()));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument((id) => {
    const pad = { id, index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__pad = pad; navigator.getGamepads = () => [pad, null, null, null];
    window.setAxis = (a, v) => { pad.axes[a] = v; pad.timestamp++; };
    window.setBtn = (b, v) => { pad.buttons[b] = { pressed: v > 0.5, touched: v > 0, value: v }; pad.timestamp++; };
  }, PAD);
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });

  await step('inputsFor: stick bindings keep their direction (+1 / −1), analog 0..0x7fff, digital past half travel, buttons by label', async () => {
    const r = await page.evaluate(async () => {
      const { inputsFor, axisBinding } = await import('./js/padinput.js');
      const c = { 16: { value2: 'LEFT_STICK_X:+1' }, 17: { value2: 'LEFT_STICK_X:-1' }, 4: { value2: 'LEFT_STICK_Y:-1' }, 8: { value2: 'BUTTON_2' } };
      const sw = { 16: { value2: 'LEFT_STICK_X:-1' }, 17: { value2: 'LEFT_STICK_X:+1' } };
      const ax = (axis, value) => ({ type: 'axischanged', axis, value });
      return {
        right: inputsFor(c, ax('LEFT_STICK_X', 1)), half: inputsFor(c, ax('LEFT_STICK_X', -0.5)), up: inputsFor(c, ax('LEFT_STICK_Y', -0.9)),
        swapped: inputsFor(sw, ax('LEFT_STICK_X', 1)), btn: inputsFor(c, { type: 'buttondown', label: 'BUTTON_2', index: 1 }), up2: inputsFor(c, { type: 'buttonup', label: 'BUTTON_2', index: 1 }),
        parse: [axisBinding('RIGHT_STICK_Y:-1'), axisBinding('BUTTON_1'), axisBinding('LEFT_STICK_X')],
      };
    });
    assert(JSON.stringify(r.right) === '[[16,32767],[17,0]]', 'right ' + JSON.stringify(r.right));
    assert(JSON.stringify(r.half) === '[[16,0],[17,16384]]', 'half ' + JSON.stringify(r.half));
    assert(JSON.stringify(r.up) === '[[4,1]]', 'up ' + JSON.stringify(r.up));
    assert(JSON.stringify(r.swapped) === '[[16,0],[17,32767]]', 'swapped ' + JSON.stringify(r.swapped));
    assert(JSON.stringify(r.btn) === '[[8,1]]' && JSON.stringify(r.up2) === '[[8,0]]', 'buttons');
    assert(JSON.stringify(r.parse) === '[{"axis":"RIGHT_STICK_Y","dir":-1},null,{"axis":"LEFT_STICK_X","dir":1}]', JSON.stringify(r.parse)); return 'ok';
  });
  await step('per-game override diff / merge', async () => {
    const r = await page.evaluate(async () => {
      const { diffControls, buildControls, loadPad } = await import('./js/pads.js');
      const g = buildControls(loadPad()), c = JSON.parse(JSON.stringify(g)); c[0][16].value2 = 'LEFT_STICK_X:-1'; c[1][0].value = 'q';
      const d = diffControls(g, c), b = buildControls(loadPad(), d);
      return { d, ok: b[0][16].value2 === 'LEFT_STICK_X:-1' && b[1][0].value === 'q' && b[0][17].value2 === g[0][17].value2 };
    });
    assert(JSON.stringify(r.d) === '{"0":{"16":{"pad":"LEFT_STICK_X:-1"}},"1":{"0":{"key":"q"}}}' && r.ok, JSON.stringify(r)); return 'ok';
  });

  // An analog-stick system so the left stick is passed through as an axis (on NES/GB/SNES it is a D-pad); the tiny NES ROM keeps it fast.
  await page.evaluate(async (b) => { const db = await import('./js/db.js'); await db.putRom({ id: 'g1', file: 'nes-test.nes', title: 'Pad Test', system: 'n64', core: 'nestopia', size: b.length, added: 1, lastPlayed: 0, data: new Uint8Array(b).buffer }); }, rom);
  const boot = async () => {
    await page.goto(`${base}player.html?id=g1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 }); await page.tap('.ejs_start_button');
    await page.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 }); await sleep(1000);
    await page.evaluate(() => { window.__in = []; const f = EJS_emulator.gameManager.functions, o = f.simulateInput; f.simulateInput = (p, i, v) => { window.__in.push([p, i, Math.round(v)]); return o(p, i, v); }; });
  };
  const push = async (a, v) => { await page.evaluate(() => { window.__in = []; }); await page.evaluate((a, v) => window.setAxis(a, v), a, v); await sleep(150); const r = await page.evaluate(() => window.__in.filter((x) => x[1] >= 16 && x[1] <= 23)); await page.evaluate((a) => window.setAxis(a, 0), a); await sleep(150); return r; };
  const press = async (b) => { await page.evaluate(() => { window.__in = []; }); await page.evaluate((b) => window.setBtn(b, 1), b); await sleep(150); const r = await page.evaluate(() => window.__in.filter((x) => x[2] > 0)); await page.evaluate((b) => window.setBtn(b, 0), b); await sleep(150); return r; };
  const val = (calls, i) => { const c = calls.filter((x) => x[1] === i); return c.length ? c[c.length - 1][2] : null; };

  await boot();
  await step('the pad is assigned to Player 1 and its id/mapping is known; EmulatorJS gamepad events go through our handler', async () => {
    const r = await page.evaluate(() => ({ sel: EJS_emulator.gamepadSelection[0], taken: !!EJS_emulator.__rpPadTaken }));
    assert(r.sel && r.sel.startsWith('Wireless Controller') && r.taken, JSON.stringify(r)); return r.sel;
  });
  await step('default: standard pad pushed RIGHT (axes[0] = +1) → core gets stick right (16 = 0x7fff, 17 = 0); LEFT → 17', async () => {
    const r = await push(0, 1), l = await push(0, -1), u = await push(1, -1), d = await push(1, 1);
    assert(val(r, 16) === 0x7fff && val(r, 17) === 0, 'right ' + JSON.stringify(r)); assert(val(l, 17) === 0x7fff && !(r.some((x) => x[1] === 17 && x[2] > 0)), 'left ' + JSON.stringify(l));
    assert(val(u, 19) === 0x7fff && val(d, 18) === 0x7fff, 'up/down ' + JSON.stringify({ u, d }));
    assert(!r.some((x) => x[1] === 17 && x[2] > 0) && !l.some((x) => x[1] === 16 && x[2] > 0), 'opposite direction must not fire');
    return JSON.stringify(r);
  });
  await step('half push gives a proportional analog value (not on/off)', async () => {
    const r = await push(0, 0.5); const v = val(r.filter((x) => x[2] > 0), 16); assert(v > 0x2000 && v < 0x6000, JSON.stringify(r)); return v;
  });
  await step('Invert ←→ (Settings → Controllers) flips a PHYSICAL controller: right → 17', async () => {
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('rp.pad') || '{}'); s.invert = { n64: { x: true, y: false } }; localStorage.setItem('rp.pad', JSON.stringify(s)); });
    await boot(); const r = await push(0, 1), u = await push(1, -1);
    assert(val(r, 17) === 0x7fff && !r.some((x) => x[1] === 16 && x[2] > 0), JSON.stringify(r)); assert(val(u, 19) === 0x7fff, 'Y untouched ' + JSON.stringify(u));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('rp.pad')); delete s.invert; localStorage.setItem('rp.pad', JSON.stringify(s)); }); return 'ok';
  });
  await step('stick-direction remap in Settings → Controllers (16 ← X−, 17 ← X+) swaps the direction at the core; button remap A ← button 3', async () => {
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('rp.pad') || '{}'); s.map = { 0: { 16: { pad: 'LEFT_STICK_X:-1' }, 17: { pad: 'LEFT_STICK_X:+1' }, 8: { pad: 'BUTTON_4' } } }; localStorage.setItem('rp.pad', JSON.stringify(s)); });
    await boot(); const r = await push(0, 1), b = await press(3);
    assert(val(r, 17) === 0x7fff && !r.some((x) => x[1] === 16 && x[2] > 0), 'stick ' + JSON.stringify(r));
    assert(b.some((x) => x[1] === 8 && x[2] === 1), 'button 3 → A(8) ' + JSON.stringify(b));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('rp.pad')); s.map = {}; localStorage.setItem('rp.pad', JSON.stringify(s)); }); return 'ok';
  });
  await step('in-game Control Settings remap takes effect immediately, is stored for this game and survives a reload', async () => {
    await boot();
    await page.evaluate(() => { const c = EJS_emulator.controls[0]; c[16].value2 = 'LEFT_STICK_X:-1'; c[17].value2 = 'LEFT_STICK_X:+1'; c[0].value2 = 'BUTTON_4'; EJS_emulator.saveSettings(); EJS_emulator.checkGamepadInputs(); });
    const now = await push(0, 1); assert(val(now, 17) === 0x7fff, 'immediately ' + JSON.stringify(now));
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rp.pad.game.g1') || 'null'));
    assert(stored && stored[0][16].pad === 'LEFT_STICK_X:-1' && stored[0][0].pad === 'BUTTON_4', 'stored ' + JSON.stringify(stored));
    assert(JSON.stringify(stored) === '{"0":{"0":{"pad":"BUTTON_4"},"16":{"pad":"LEFT_STICK_X:-1"},"17":{"pad":"LEFT_STICK_X:+1"}}}', 'only the changed bindings are stored ' + JSON.stringify(stored));
    await boot(); const after = await push(0, 1), b = await press(3);
    const c = await page.evaluate(() => [EJS_emulator.controls[0][16].value2, EJS_emulator.controls[0][0].value2]);
    assert(c[0] === 'LEFT_STICK_X:-1' && c[1] === 'BUTTON_4', 'controls after reload ' + c); assert(val(after, 17) === 0x7fff, 'after reload ' + JSON.stringify(after)); assert(b.some((x) => x[1] === 0 && x[2] === 1), 'button ' + JSON.stringify(b));
    await page.evaluate(() => localStorage.removeItem('rp.pad.game.g1')); return JSON.stringify(stored);
  });
  await step('while EmulatorJS menus are open the pad does not drive the game', async () => {
    await boot(); await page.evaluate(() => { EJS_emulator.settingsMenu.style.display = ''; });
    const r = await push(0, 1); await page.evaluate(() => { EJS_emulator.settingsMenu.style.display = 'none'; });
    assert(!r.some((x) => x[2] > 0), JSON.stringify(r)); return 'ok';
  });

  await step('Controllers screen: stick-direction rows + live Test controller (id, mapping, axis 0 +1.00 → Left stick → right, button → control)', async () => {
    await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
    await page.click('#btn-settings'); await page.waitForSelector('#btn-controllers', { visible: true }); await page.$eval('#btn-controllers', (e) => e.click());
    await page.waitForSelector('#pad-test-btn', { timeout: 8000 });
    const rows = await page.$$eval('.map-row', (a) => a.map((e) => e.textContent)); assert(rows.some((t) => /Left stick → right/.test(t)) && rows.some((t) => /Right stick ↑/.test(t)), 'stick rows');
    await page.click('#pad-test-btn'); await page.evaluate(() => { window.setAxis(0, 1); window.setBtn(1, 1); }); await sleep(500);
    const t = await page.$eval('#pad-test', (e) => e.innerText);
    assert(/mapping: standard/.test(t) && /054c/.test(t), 'id/mapping ' + t); assert(/\+1\.00\s*→ Left stick → right/.test(t), 'axis ' + t); assert(/Buttons: 1 .*→/.test(t), 'button ' + t);
    assert(logs.some((l) => /\[Retro Pocket\] controller .*"mapping":"standard"/.test(l)), 'console log of id/mapping');
    assert(await page.$eval('#pads', (d) => d.open), 'pad presses must not navigate / close the dialog while testing');
    await page.screenshot({ path: 'tests/out/gamepad-test.png' }); await page.evaluate(() => { window.setAxis(0, 0); window.setBtn(1, 0); window.setBtn(8, 1); window.setBtn(9, 1); }); await sleep(400);
    assert(await page.$eval('#pad-test', (e) => e.hidden), 'Select + Start stops the test'); await page.evaluate(() => { window.setBtn(8, 0); window.setBtn(9, 0); }); return t.split('\n').slice(0, 4).join(' | ');
  });
  await step('no page errors', async () => { assert(!errs.length, errs.join(' | ')); return 'ok'; });
} catch (e) { failed++; console.log('FAIL fatal', e.message); }
await browser.close(); srv.kill();
console.log(`\n${total - failed}/${total} passed`); process.exit(failed ? 1 : 0);
