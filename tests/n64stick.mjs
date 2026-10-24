// Analog stick direction (N64 / PlayStation / PSP): per-system "Invert left stick" for touch + controller + keyboard via one
// simulateInput mapping, keyboard stick bindings (T/F/G/H, I/J/K/L), the nipplejs 0° (straight right) dead-spot fix, and
// custom button mappings left untouched.
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
await sleep(800);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });

  await step('mapStick: no inversion by default; X swaps 16↔17 only, Y swaps 18↔19 only; right stick / buttons untouched', async () => {
    const r = await page.evaluate(async () => {
      const { mapStick, loadInvert } = await import('./js/stick.js');
      const all = [...Array(26).keys()];
      return { def: loadInvert('n64'), none: all.map((i) => mapStick(i, { x: false, y: false })), x: all.map((i) => mapStick(i, { x: true })), y: all.map((i) => mapStick(i, { y: true })), xy: [16, 17, 18, 19].map((i) => mapStick(i, { x: true, y: true })) };
    });
    const id = [...Array(26).keys()];
    assert(!r.def.x && !r.def.y, 'default must be off'); assert(r.none.join() === id.join(), 'none');
    assert(r.x.join() === id.map((i) => (i === 16 ? 17 : i === 17 ? 16 : i)).join(), 'x ' + r.x); assert(r.y.join() === id.map((i) => (i === 18 ? 19 : i === 19 ? 18 : i)).join(), 'y ' + r.y);
    assert(r.xy.join() === '17,16,19,18', 'xy'); return 'ok';
  });
  await step('wrapSimulateInput flips the axis for every local input and wraps only once', async () => {
    const r = await page.evaluate(async () => {
      const { wrapSimulateInput } = await import('./js/stick.js'); const calls = [];
      const gm = { simulateInput(p, i, v) { calls.push([p, i, v]); } }; let inv = { x: true, y: false };
      const a = wrapSimulateInput(gm, () => inv), b = wrapSimulateInput(gm, () => inv);
      gm.simulateInput(0, 16, 0x7fff); gm.simulateInput(0, 17, 0); gm.simulateInput(0, 18, 5); inv = { x: false, y: true }; gm.simulateInput(0, 18, 5); gm.simulateInput(0, 3, 1);
      return { a, b, calls };
    });
    assert(r.a && !r.b, 'wrap once'); assert(JSON.stringify(r.calls) === '[[0,17,32767],[0,16,0],[0,18,5],[0,19,5],[0,3,1]]', JSON.stringify(r.calls)); return 'ok';
  });
  await step('touch stick: nipplejs 0° (pushed straight right) is nudged into the range EmulatorJS handles; other angles untouched', async () => {
    const r = await page.evaluate(async () => {
      const { fixAngle, patchNipple } = await import('./js/stick.js');
      const w = {}; patchNipple(w); let cb; const got = [];
      w.nipplejs = { create: () => ({ on: (t, f) => { if (t === 'move') cb = f; } }) };
      w.nipplejs.create({}).on('move', (e, info) => got.push(info.angle.degree));
      for (const d of [0, 360, 90, 180, 270, 45]) cb({}, { angle: { degree: d }, distance: 50 });
      return { got, plain: fixAngle({ angle: { degree: 10 } }).angle.degree };
    });
    assert(r.got[0] > 0 && r.got[0] < 1 && r.got[1] > 0 && r.got[1] < 1 && r.got.slice(2).join() === '90,180,270,45' && r.plain === 10, JSON.stringify(r)); return JSON.stringify(r.got);
  });
  await step('Controllers screen: N64 / PlayStation / PSP have "Invert ←→ / ↑↓" toggles; toggling keeps custom button mappings', async () => {
    await page.evaluate(() => localStorage.setItem('rp.pad', JSON.stringify({ map: { 'nintendo': { 0: 'BUTTON_3' } }, kbPreset: 'retro' })));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.click('#btn-settings'); await page.waitForSelector('#btn-controllers', { visible: true }); await page.$eval('#btn-controllers', (e) => e.click());
    await page.waitForSelector('#pad-inv-n64-x', { timeout: 8000 });
    const ids = await page.$$eval('[id^=pad-inv-]', (a) => a.map((e) => e.id));
    for (const s of ['n64', 'psx', 'psp']) assert(ids.includes(`pad-inv-${s}-x`) && ids.includes(`pad-inv-${s}-y`), 'missing ' + s + ' ' + ids);
    await page.$eval('#pad-inv-n64-x', (e) => e.click()); await sleep(200);
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('rp.pad')));
    assert(s.invert && s.invert.n64 && s.invert.n64.x === true && !s.invert.n64.y, JSON.stringify(s)); assert(JSON.stringify(s.map) === '{"nintendo":{"0":"BUTTON_3"}}', 'custom map changed ' + JSON.stringify(s.map));
    const kb = await page.evaluate(() => document.body.textContent.includes('T / F / G / H')); assert(kb, 'keyboard stick key note');
    await page.screenshot({ path: 'tests/out/n64stick-ui.png' }); return ids.join(' ');
  });
  await step('keyboard defaults bind the left stick (H/F/G/T) and right stick (L/J/K/I) in both presets', async () => {
    const r = await page.evaluate(async () => { const { KB_DEFAULTS, buildControls } = await import('./js/pads.js'); const c = buildControls({ ...JSON.parse('{}'), layout: 'nintendo', keyboard: true, kbPreset: 'retro', map: {}, assign: {} }); return { retro: [16, 17, 18, 19, 20, 21, 22, 23].map((i) => KB_DEFAULTS.retro[i]), ejs: [16, 17, 18, 19].map((i) => KB_DEFAULTS.ejs[i]), built: [16, 17, 18, 19].map((i) => c[0][i] && c[0][i].value) }; });
    assert(r.retro.join() === 'h,f,g,t,l,j,k,i' && r.ejs.join() === 'h,f,g,t' && r.built.join() === 'h,f,g,t', JSON.stringify(r)); return JSON.stringify(r.built);
  });
  await page.evaluate(async (b) => { const db = await import('./js/db.js'); await db.putRom({ id: 'k1', file: 'nes-test.nes', title: 'NES Test', system: 'nes', core: 'nestopia', size: b.length, added: 1, lastPlayed: 0, data: new Uint8Array(b).buffer }); }, rom);
  const boot = async () => {
    await page.goto(`${base}player.html?id=k1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 }); await page.tap('.ejs_start_button');
    await page.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 }); await sleep(800);
    await page.evaluate(() => { window.__in = []; const gm = EJS_emulator.gameManager, f = gm.functions.simulateInput; gm.functions.simulateInput = (p, i, v) => { window.__in.push([p, i, v]); return f(p, i, v); }; });
  };
  const keys = async (k) => { await page.evaluate(() => { window.__in = []; }); await page.keyboard.down(k); await sleep(120); await page.keyboard.up(k); await sleep(120); return page.evaluate(() => window.__in.filter((x) => x[1] >= 16 && x[1] <= 19)); };
  await boot();
  await step('in game, default: keyboard H = stick right (16), F = left (17), T = up (19), G = down (18)', async () => {
    const h = await keys('h'), f = await keys('f'), t = await keys('t'), g = await keys('g');
    assert(h[0] && h[0][1] === 16 && h[0][2] > 0 && f[0][1] === 17 && t[0][1] === 19 && g[0][1] === 18, JSON.stringify({ h, f, t, g }));
    assert(await page.evaluate(() => !!(window.nipplejs && window.nipplejs.__rpWrapped)), 'nipplejs not patched'); return 'ok';
  });
  await step('with "Invert ←→" on (this system), H sends left and F sends right; vertical unchanged; live via storage', async () => {
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('rp.pad') || '{}'); s.invert = { nes: { x: true, y: false } }; localStorage.setItem('rp.pad', JSON.stringify(s)); });
    await boot();
    const h = await keys('h'), f = await keys('f'), t = await keys('t'), pad = await page.evaluate(() => { window.__in = []; EJS_emulator.gameManager.simulateInput(0, 16, 0x7fff); EJS_emulator.gameManager.simulateInput(0, 17, 0); return window.__in; });
    assert(h[0][1] === 17 && f[0][1] === 16 && t[0][1] === 19, JSON.stringify({ h, f, t })); assert(JSON.stringify(pad) === '[[0,17,32767],[0,16,0]]', 'controller axis path ' + JSON.stringify(pad));
    return 'ok';
  });
  await step('no page errors', async () => { assert(!errs.length, errs.join(' | ')); return 'ok'; });
} catch (e) { failed++; console.log('FAIL fatal', e.message); }
await browser.close(); srv.kill();
console.log(`\n${total - failed}/${total} passed`); process.exit(failed ? 1 : 0);
