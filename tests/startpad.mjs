// Start Game: button + hint at the top (safe area); A / Start on a controller or Enter / Space on a keyboard starts the game
// like a tap, and the starting press never reaches the game (gamepad buttons swallowed until released, keys stopped).
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
const PAD = 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)';
async function open(viewport) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); page.errs = []; page.on('pageerror', (e) => page.errs.push(e.message));
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((PAD) => {
    window.__mockPads = [];
    navigator.getGamepads = () => window.__mockPads.slice();
    window.addPad = () => window.__mockPads.push({ id: PAD, index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
    window.setBtn = (b, v) => { window.__mockPads[0].buttons[b] = { pressed: v > 0.5, value: v }; };
  }, PAD);
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async (b) => { const db = await import('./js/db.js'); await db.putRom({ id: 's1', file: 'nes-test.nes', title: 'NES Test', system: 'nes', core: 'nestopia', size: b.length, added: 1, lastPlayed: 0, data: new Uint8Array(b).buffer }); }, rom);
  await page.goto(`${base}player.html?id=s1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 });
  return page;
}
const box = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vis: getComputedStyle(e).display !== 'none' && !e.hidden }; });
try {
  /* ---------- controller ---------- */
  const page = await open({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await step('Start Game button sits at the top of the screen (portrait), well clear of the navigation bar', async () => {
    const b = await box(page, '.ejs_start_button'); assert(b.top >= 8 && b.bottom < 844 * 0.3, JSON.stringify(b)); return `top ${Math.round(b.top)}px, bottom ${Math.round(b.bottom)}px of 844`;
  });
  await step('hint "press A / Start on your controller" is shown at the top', async () => {
    await page.waitForSelector('#start-hint', { visible: true, timeout: 5000 });
    const t = await page.$eval('#start-hint', (e) => e.textContent), b = await box(page, '#start-hint');
    assert(/A \/ Start on your controller/.test(t) && b.top < 844 * 0.35, t + JSON.stringify(b));
    const pe = await page.$eval('#start-hint', (e) => getComputedStyle(e).pointerEvents); assert(pe === 'none', 'hint must not block taps'); return t;
  });
  await page.screenshot({ path: 'tests/out/startpad-button.png' });
  await step('pressing A on a Bluetooth / USB controller starts the game (no touch)', async () => {
    await page.evaluate(() => window.addPad()); await sleep(900);               // pad seen idle first
    await page.evaluate(() => window.setBtn(0, 1));
    await page.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 });
    const r = await page.evaluate(() => ({ by: window.__rpStartedBy, btn: !!document.querySelector('.ejs_start_button'), hint: document.getElementById('start-hint').hidden }));
    assert(r.by === 'pad' && !r.btn && r.hint, JSON.stringify(r)); return JSON.stringify(r);
  });
  await step('the held A press does not reach the game; after release, A works normally', async () => {
    await page.evaluate(() => { window.__in = []; const gm = EJS_emulator.gameManager, f = gm.functions.simulateInput; gm.functions.simulateInput = (p, i, v) => { window.__in.push([p, i, v]); return f(p, i, v); }; });
    await sleep(1500);                                                           // still holding A
    const held = await page.evaluate(() => ({ seen: navigator.getGamepads()[0].buttons[0].pressed, raw: window.__rpRawGamepads()[0].buttons[0].pressed, inputs: window.__in.filter((x) => x[2]) }));
    assert(held.raw && !held.seen && !held.inputs.length, 'leaked: ' + JSON.stringify(held));
    await page.evaluate(() => window.setBtn(0, 0)); await sleep(300);
    await page.evaluate(() => window.setBtn(0, 1)); await sleep(400);
    const again = await page.evaluate(() => ({ seen: navigator.getGamepads()[0].buttons[0].pressed, inputs: window.__in.filter((x) => x[2]) }));
    await page.evaluate(() => window.setBtn(0, 0));
    assert(again.seen && again.inputs.length > 0, 'second press not delivered ' + JSON.stringify(again)); return `held: none; second press -> ${JSON.stringify(again.inputs[0])}`;
  });
  await step('no page errors (controller start)', async () => { assert(!page.errs.length, page.errs.join(' | ')); return 'ok'; });
  await page.browserContext().close();

  /* ---------- keyboard ---------- */
  const kp = await open({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await step('landscape: Start Game button still at the top', async () => { const b = await box(kp, '.ejs_start_button'); assert(b.top >= 8 && b.bottom < 390 * 0.6, JSON.stringify(b)); return `top ${Math.round(b.top)}px of 390`; });
  await step('Enter on a keyboard starts the game; the key never reaches EmulatorJS', async () => {
    await kp.evaluate(() => { window.__keys = []; const p = EJS_emulator.elements.parent; for (const t of ['keydown', 'keyup']) p.addEventListener(t, (e) => window.__keys.push(t + ':' + e.key)); });
    await kp.keyboard.press('Enter');
    await kp.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 });
    await sleep(500);
    const r = await kp.evaluate(() => ({ by: window.__rpStartedBy, keys: window.__keys }));
    assert(r.by === 'key' && !r.keys.length, JSON.stringify(r));
    await kp.keyboard.press('Enter'); await sleep(200);
    const after = await kp.evaluate(() => window.__keys);
    assert(after.join() === 'keydown:Enter,keyup:Enter', 'later Enter presses must reach the game: ' + after.join()); return 'start swallowed, later Enter delivered';
  });
  await step('no page errors (keyboard start)', async () => { assert(!kp.errs.length, kp.errs.join(' | ')); return 'ok'; });
} catch (e) { failed++; console.log('FAIL fatal', e.message); }
await browser.close(); srv.kill();
console.log(`\n${total - failed}/${total} passed`); process.exit(failed ? 1 : 0);
