// Rewind / fast-forward quick buttons next to ☰, rewind setting, screen filter (shader) picker incl. our LCD grid; hardcore hides rewind.
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
const logs = [];
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => logs.push(m.text()));
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async (b) => { const db = await import('./js/db.js'); localStorage.setItem('rp.perf', JSON.stringify({ mode: 'balanced' })); /* headless SwiftShader makes Auto pick Fast (rewind off); these tests cover the Balanced defaults */ await db.putRom({ id: 't1', file: 'nes-test.nes', title: 'NES Test', system: 'nes', core: 'nestopia', size: b.length, added: 1, lastPlayed: 0, data: new Uint8Array(b).buffer }); }, [...rom]);
  const boot = async () => {
    await page.goto(`${base}player.html?id=t1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 }); await page.tap('.ejs_start_button');
    await page.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 }); await sleep(1200);
  };
  const rect = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; });
  const fsRead = (p) => page.evaluate((p) => { try { return EJS_emulator.Module.FS.readFile(p, { encoding: 'utf8' }); } catch { return null; } }, p);
  const menu = async (id) => { await page.tap('#menu-btn'); await sleep(300); await page.$eval(id, (e) => e.click()); await sleep(400); const t = await page.$eval(id, (e) => e.textContent); await page.tap('#pm-resume'); await sleep(200); return t; };
  const pixels = async (name) => { await page.evaluate(() => { EJS_emulator.pause(); }); await sleep(150); const b = await page.screenshot({ clip: { x: 380, y: 150, width: 60, height: 40 }, path: `tests/out/video-${name}-zoom.png` }); await page.evaluate(() => EJS_emulator.play()); return Buffer.from(b).toString('base64'); };
  // horizontal "texture": share of neighbouring pixels that differ. Flat NES colour bands are ~0; the LCD grid adds periodic dark columns.
  const texture = (b64) => page.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0, t = 0; for (let y = 0; y < c.height; y++) for (let i = 0; i < c.width - 1; i++) { const a = (y * c.width + i) * 4; t++; if (Math.abs(d[a] - d[a + 4]) + Math.abs(d[a + 1] - d[a + 5]) + Math.abs(d[a + 2] - d[a + 6]) > 6) n++; } return n / t; }, b64);
  await boot();
  await step('⏪ / ⏩ quick buttons appear next to ☰ after start; NES has rewind on by default', async () => {
    const r = await page.evaluate(() => { const q = document.getElementById('quick'), m = document.getElementById('menu-btn').getBoundingClientRect(), b = q.getBoundingClientRect(); return { hidden: q.hidden, rew: !document.getElementById('q-rew').hidden, rewOn: EJS_emulator.rewindEnabled, cfg: EJS_emulator.gameManager.getRetroArchCfg(), right: b.right, mleft: m.left, top: Math.abs(b.top - m.top) }; });
    assert(!r.hidden && r.rew && r.rewOn && /rewind_enable = true/.test(r.cfg), JSON.stringify(r)); assert(Math.abs(r.right - r.mleft) < 2 && r.top < 2, 'position ' + JSON.stringify(r));
    await page.screenshot({ path: 'tests/out/video-quick.png' }); return 'ok';
  });
  await step('⏩ toggles fast-forward on and off', async () => {
    await page.tap('#q-ff'); await sleep(200); const on = await page.evaluate(() => [EJS_emulator.isFastForward, document.getElementById('q-ff').classList.contains('on')]);
    await page.tap('#q-ff'); await sleep(200); const off = await page.evaluate(() => [EJS_emulator.isFastForward, document.getElementById('q-ff').classList.contains('on')]);
    assert(on.join() === 'true,true' && off.join() === 'false,false', JSON.stringify({ on, off })); return 'ok';
  });
  await step('holding ⏪ rewinds (toggle_rewind 1 while held, 0 on release) and the game keeps running', async () => {
    await page.evaluate(() => { window.__rw = []; const f = EJS_emulator.gameManager.functions, o = f.toggleRewind; f.toggleRewind = (v) => { window.__rw.push(v); return o(v); }; });
    const b = await rect('#q-rew'); await sleep(1500); await page.mouse.move(b.x, b.y); await page.mouse.down(); await sleep(800);
    const held = await page.evaluate(() => [window.__rw.slice(), document.getElementById('q-rew').classList.contains('on')]); await page.mouse.up(); await sleep(300);
    const after = await page.evaluate(() => [window.__rw.slice(), EJS_emulator.paused]);
    assert(held[0].join() === '1' && held[1] && after[0].join() === '1,0' && !after[1], JSON.stringify({ held, after })); return 'ok';
  });
  let px0;
  await step('☰ → ✨ Screen filter cycles CRT → … → LCD grid; shaders are written and enabled', async () => {
    px0 = await pixels('off');
    const t1 = await menu('#pm-filter'); const crt = await fsRead('/shader/shader.glslp');
    assert(/CRT/.test(t1) && /zfast/.test(crt || ''), t1 + ' ' + crt);
    let t = t1; for (let i = 0; i < 4 && !/LCD/.test(t); i++) t = await menu('#pm-filter');
    const lcd = await fsRead('/shader/shader.glslp'), glsl = await fsRead('/shader/rp_lcd.glsl');
    assert(/LCD grid/.test(t) && /rp_lcd/.test(lcd || '') && /GRID/.test(glsl || ''), t);
    assert((await page.evaluate(() => JSON.parse(localStorage.getItem('rp.shader')).nes)) === 'lcd'); await sleep(1200);
    await page.screenshot({ path: 'tests/out/video-lcd.png' }); return t;
  });
  await step('LCD grid shader compiles and changes the picture', async () => {
    const px1 = await pixels('lcd'); const bad = logs.filter((l) => /shader|glsl/i.test(l) && /fail|error/i.test(l));
    assert(!bad.length, bad.join(' | ')); const t0 = await texture(px0), t1 = await texture(px1); assert(t1 > t0 + 0.1, `no grid visible: ${t0.toFixed(3)} -> ${t1.toFixed(3)}`); return `pixel-edge share ${t0.toFixed(3)} -> ${t1.toFixed(3)}`;
  });
  await step('filter is re-applied on restart; turning rewind off says "after restart" and takes effect on next start', async () => {
    const t = await menu('#pm-rewind'); assert(/Rewind: Off \(after restart\)/.test(t), t);
    await boot(); await sleep(400);
    const r = await page.evaluate(() => ({ rew: EJS_emulator.rewindEnabled, btn: document.getElementById('q-rew').hidden, cfg: /rewind_enable/.test(EJS_emulator.gameManager.getRetroArchCfg()) }));
    const lcd = await fsRead('/shader/shader.glslp'); assert(/rp_lcd/.test(lcd || ''), 'shader not re-applied');
    assert(!r.rew && r.btn && !r.cfg, JSON.stringify(r)); return JSON.stringify(r);
  });
  await step('⏪⏩ Top buttons: Off hides the quick bar (saved)', async () => {
    const t = await menu('#pm-quick'); const h = await page.evaluate(() => [document.getElementById('quick').hidden, localStorage.getItem('rp.quick')]);
    assert(/Off/.test(t) && h[0] && /false/.test(h[1]), JSON.stringify(h)); await menu('#pm-quick'); return 'ok';
  });
  await step('RetroAchievements hardcore: rewind is forced off and its menu item hidden', async () => {
    await page.evaluate(() => { localStorage.setItem('rp.rewind', JSON.stringify({ nes: true })); localStorage.setItem('rp.ra', JSON.stringify({ user: 'u', hardcore: true })); localStorage.setItem('rp.keys', JSON.stringify({ ra: 'k' })); });
    await boot();
    const r = await page.evaluate(() => ({ rew: EJS_emulator.rewindEnabled, btn: document.getElementById('q-rew').hidden, item: document.getElementById('pm-rewind').hidden }));
    await page.evaluate(() => { localStorage.removeItem('rp.ra'); localStorage.removeItem('rp.keys'); });
    assert(!r.rew && r.btn, JSON.stringify(r)); return JSON.stringify(r);
  });
  await step('no page errors', async () => { assert(!errs.length, errs.join(' | ')); });
} finally { await browser.close(); srv.kill(); }
console.log(`\n${total - failed}/${total} passed`); process.exit(failed ? 1 : 0);
