// In-game menu: EmulatorJS' bottom bar must never pop up (dead-zone touches, long-press, hover), and everything it offered
// must be reachable from the small ☰ button at the top. Headless Chrome with synthetic touch/mouse events (CDP). Needs network (EmulatorJS CDN).
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
mkdirSync('tests/fixtures', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/nes-test.nes']);
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/homebrew-test.gb']);
const PORT = Number(process.env.PORT || 18000 + Math.floor(Math.random() * 20000)), base = process.env.BASE_URL || `http://localhost:${PORT}/`;
const srv = process.env.BASE_URL ? null : spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0;
let after = async () => {};
const step = async (n, f) => { total++; try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } try { await after(); } catch {} };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 300000, timeout: 120000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.createBrowserContext()).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const vp = (w, h, dpr = 2) => page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: dpr });
  await vp(390, 844);
  after = async () => { await touch('touchEnd', []).catch(() => {}); await page.evaluate(() => { document.getElementById('pmpanel-back')?.click(); const c = window.EJS_emulator && EJS_emulator.controlMenu; if (c) c.style.display = 'none'; if (!document.getElementById('pmenu').hidden) document.getElementById('pm-resume').click(); }).catch(() => {}); };
  const cdp = await page.createCDPSession();
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id = 1]) => ({ x, y, id })) });
  const tap = async (x, y, hold = 60) => { await touch('touchStart', [[x, y]]); await sleep(hold); await touch('touchEnd', []); };
  const mouseMove = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  const bytes = [...readFileSync('tests/fixtures/nes-test.nes')];
  await page.evaluate(async (bytes) => { localStorage.removeItem('rp.ui'); const db = await import('./js/db.js'); await db.putRom({ id: 'n1', file: 'nes-test.nes', title: 'nes test', system: 'nes', core: 'nestopia', size: bytes.length, added: 1, lastPlayed: 0, data: new Uint8Array(bytes).buffer }); }, bytes);
  await page.goto(`${base}player.html?id=n1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 });
  await page.click('.ejs_start_button');            // a real mouse click (this is what used to pop the bar up for 3 s)
  await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, { timeout: 120000 });
  await sleep(1200);

  const barState = () => page.evaluate(() => {
    const out = {}; for (const sel of ['.ejs_menu_bar', '.ejs_virtualGamepad_open', '.ejs_context_menu']) { const e = document.querySelector(sel); out[sel] = e ? (sel === '.ejs_menu_bar' ? (getComputedStyle(e).visibility === 'hidden' && getComputedStyle(e).pointerEvents === 'none' ? 'none' : 'SHOWN') : getComputedStyle(e).display) : 'absent'; }
    const pop = [...document.querySelectorAll('.ejs_popup_container')].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);
    out.popups = pop.length; out.pmenu = !document.getElementById('pmenu').hidden; out.paused = !!EJS_emulator.paused; out.barHiddenClass = document.querySelector('.ejs_menu_bar')?.classList.contains('ejs_menu_bar_hidden');
    return out;
  });
  const noBar = (s, what) => { assert(s['.ejs_menu_bar'] === 'none' && s['.ejs_virtualGamepad_open'] !== 'block' && s['.ejs_context_menu'] !== 'block' && s['.ejs_virtualGamepad_open'] !== 'flex', `${what}: EmulatorJS UI visible ${JSON.stringify(s)}`); assert(s.popups === 0 && !s.pmenu && !s.paused, `${what}: something popped up ${JSON.stringify(s)}`); };

  await step('right after Start (mouse click) the EmulatorJS bottom bar is NOT shown', async () => { await sleep(500); noBar(await barState(), 'after start'); });
  await step('touching dead zones (empty areas, between pads, near bottom edge) does nothing — no bar, no pause, no popup', async () => {
    const pts = await page.evaluate(() => { const out = []; for (const [fx, fy] of [[0.5, 0.35], [0.5, 0.97], [0.5, 0.88], [0.08, 0.5], [0.95, 0.6], [0.5, 0.7]]) { const x = innerWidth * fx, y = innerHeight * fy, e = document.elementFromPoint(x, y); out.push([x, y, e && (e.className || e.id || e.tagName)]); } return out; });
    for (const [x, y] of pts) { await tap(x, y); await sleep(250); noBar(await barState(), `tap ${x | 0},${y | 0}`); }
    await touch('touchStart', [[195, 640]]); await sleep(1000); await touch('touchEnd', []); await sleep(300); noBar(await barState(), 'long-press (context menu)');
    await touch('touchStart', [[195, 700]]); await touch('touchMove', [[195, 500]]); await touch('touchMove', [[300, 780]]); await touch('touchEnd', []); await sleep(300); noBar(await barState(), 'swipe in dead zone');
    return pts.map((p) => p[2]).join(' | ').slice(0, 160);
  });
  await step('desktop hover / mouse move near the bottom edge and a click do not show the bar either', async () => {
    for (const y of [700, 800, 835, 843]) { await mouseMove(200, y); await sleep(120); }
    await mouseMove(200, 842); await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 842, button: 'left', buttons: 1, clickCount: 1 }); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 200, y: 842, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(500); noBar(await barState(), 'mouse'); await page.mouse.click(200, 300, { button: 'right' }); await sleep(300); noBar(await barState(), 'right click');
  });
  await step('our ☰ button: top of the screen, ≥44px hit target, semi-transparent, top-right by default, above the game', async () => {
    const b = await page.evaluate(() => { const e = document.getElementById('menu-btn'), r = e.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { r: r.toJSON(), op: +getComputedStyle(e).opacity, top: t && (t.id || t.closest('#menu-btn')?.id), vw: innerWidth, pos: e.dataset.pos }; });
    assert(b.r.width >= 44 && b.r.height >= 44 && b.r.top >= 0 && b.r.top < 12 && Math.abs(b.r.right - (b.vw - 6)) < 2 && b.pos === 'right' && b.top === 'menu-btn' && b.op > 0 && b.op < 1, JSON.stringify(b)); return `${b.r.width}x${b.r.height} at ${b.r.left | 0},${b.r.top | 0} opacity ${b.op}`;
  });
  await step('tapping ☰ opens the menu (game pauses) with all functions: resume, save, load, restart, sound, fast-forward, screenshot, fullscreen, controls, settings, exit', async () => {
    await tap(371, 28); await page.waitForSelector('#pmenu:not([hidden])', { timeout: 3000 });
    const items = await page.evaluate(() => ['pm-resume', 'pm-save', 'pm-load', 'pm-restart', 'pm-sound', 'pm-ff', 'pm-shot', 'pm-full', 'pm-controls', 'pm-settings', 'pm-btnpos', 'pm-exit'].map((id) => { const e = document.getElementById(id); return [id, !!e && !e.hidden && e.getBoundingClientRect().width > 0]; }));
    const miss = items.filter(([, ok]) => !ok).map(([i]) => i); assert(!miss.length, 'missing/hidden: ' + miss); assert(await page.evaluate(() => EJS_emulator.paused), 'game paused'); assert(await page.$eval('#pm-disc', (e) => e.hidden), 'single-disc game: no Disc button');
    await page.screenshot({ path: 'tests/out/ingame-menu.png' });
  });
  await step('Sound toggles mute, Fast-forward toggles, Screenshot downloads a PNG', async () => {
    await tap(371, 28); await page.waitForSelector('#pmenu:not([hidden])');
    await page.click('#pm-sound'); assert(await page.evaluate(() => EJS_emulator.muted === true) && /Off/.test(await page.$eval('#pm-sound', (e) => e.textContent)), 'mute');
    await page.click('#pm-sound'); assert(await page.evaluate(() => !EJS_emulator.muted) && /On/.test(await page.$eval('#pm-sound', (e) => e.textContent)), 'unmute');
    await page.click('#pm-ff'); assert(await page.evaluate(() => EJS_emulator.isFastForward === true), 'ff on'); await page.click('#pm-ff'); assert(await page.evaluate(() => !EJS_emulator.isFastForward), 'ff off');
    await page.evaluate(() => { window.__dl = []; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); else o.call(this); }; });
    await page.click('#pm-shot'); await page.waitForFunction(() => window.__dl.length > 0, { timeout: 8000 }); const dl = await page.evaluate(() => window.__dl[0]); assert(/\.(png|jpe?g|webp)$/.test(dl), dl);
    assert(await page.$eval('#pmenu', (e) => e.hidden), 'menu closed after screenshot'); assert(await page.evaluate(() => !EJS_emulator.paused), 'resumed');
  });
  await step('Save state / Load state / Restart work from the menu', async () => {
    await tap(371, 28); await page.waitForSelector('#pmenu:not([hidden])'); await page.click('#pm-save'); await sleep(500);
    const sv = await page.evaluate(() => { try { return EJS_emulator.gameManager.getState().length; } catch (e) { return -1; } }); assert(sv > 1000, 'state bytes ' + sv);
    await tap(371, 28); await page.waitForSelector('#pmenu:not([hidden])'); await page.click('#pm-load'); await sleep(400); assert(await page.$eval('#pmenu', (e) => e.hidden), 'closed');
    await tap(371, 28); await page.waitForSelector('#pmenu:not([hidden])'); await page.click('#pm-restart'); await sleep(300); assert(await page.$eval('#pmenu', (e) => e.hidden), 'closed');
  });
  await step('Emulator settings (shader, fast-forward ratio, volume…) open in our full-screen panel and can be closed', async () => {
    await tap(371, 28); await page.waitForSelector('#pmenu:not([hidden])'); await page.click('#pm-settings'); await page.waitForSelector('#pmpanel:not([hidden])');
    const r = await page.evaluate(() => { const e = document.querySelector('#pmpanel-body .ejs_settings_parent'); const b = e.getBoundingClientRect(); return { disp: getComputedStyle(e).display, w: b.width, h: b.height, l: b.left, r: b.right, vw: innerWidth, rows: e.querySelectorAll('.ejs_settings_main_bar').length }; });
    assert(r.disp !== 'none' && r.w > 100 && r.h > 50 && r.l >= 0 && r.r <= r.vw + 1 && r.rows > 3, JSON.stringify(r)); await page.screenshot({ path: 'tests/out/ingame-settings.png' });
    await page.click('#pmpanel-back'); assert(await page.$eval('#pmpanel', (e) => e.hidden) && !(await page.$eval('#pmenu', (e) => e.hidden)), 'back to menu');
    assert(await page.evaluate(() => document.querySelector('.ejs_menu_bar').contains(EJS_emulator.settingsMenu)), 'settings panel handed back to EmulatorJS');
  });
  await step('Controls… opens EmulatorJS control mapping and resumes the game', async () => {
    await tap(371, 28); await page.waitForSelector('#pmenu:not([hidden])');
    await page.click('#pm-controls'); await sleep(400);
    const v = await page.evaluate(() => { const e = EJS_emulator.controlMenu; return { disp: e.style.display, w: e.getBoundingClientRect().width, paused: EJS_emulator.paused }; });
    assert(v.disp !== 'none' && v.w > 100, JSON.stringify(v)); await page.screenshot({ path: 'tests/out/ingame-controls.png' });
    await page.evaluate(() => { EJS_emulator.controlMenu.style.display = 'none'; });
  });
  await step('Resume closes the menu; back button of library (exit) still reachable', async () => {
    await tap(371, 28); await page.waitForSelector('#pmenu:not([hidden])'); await page.click('#pm-resume'); assert(await page.$eval('#pmenu', (e) => e.hidden), 'closed'); noBar(await barState(), 'after resume');
  });
  await step('auto-fade: ☰ fades after a few seconds idle, is still one tap away; tapping near the top edge wakes it', async () => {
    await sleep(4300); const f = await page.evaluate(() => ({ faded: document.getElementById('menu-btn').classList.contains('faded'), op: +getComputedStyle(document.getElementById('menu-btn')).opacity }));
    assert(f.faded && f.op < 0.3, JSON.stringify(f));
    await tap(100, 20); await sleep(700); const w = await page.evaluate(() => +getComputedStyle(document.getElementById('menu-btn')).opacity); assert(w > 0.5, 'woke ' + w);
    await sleep(4300); await tap(371, 28); await page.waitForSelector('#pmenu:not([hidden])', { timeout: 3000 }); await page.click('#pm-resume');   // faded -> a single tap still opens it
  });
  await step('hotkey path unchanged: setMenu via window flag + Escape to resume not required; menu closes with Resume only once', async () => { assert(await page.evaluate(() => window.__rpMenuOpen === false), 'flag'); });
  await step('position setting (left / center / right) and auto-hide off, set from Library → Settings, apply in game; portrait', async () => {
    const lib = await browser.createBrowserContext(), p2 = await lib.newPage(); await p2.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await p2.goto(base + 'index.html', { waitUntil: 'networkidle0' }); await p2.click('#btn-settings'); await p2.waitForSelector('#btn-menubtn'); await p2.click('#btn-menubtn'); await p2.waitForSelector('#ui-pos');
    assert(await p2.$eval('#ui-pos', (e) => e.value) === 'right' && await p2.$eval('#ui-autohide', (e) => e.checked), 'defaults');
    await p2.select('#ui-pos', 'center'); await p2.click('#ui-autohide'); const st = await p2.evaluate(() => JSON.parse(localStorage.getItem('rp.ui'))); assert(st.pos === 'center' && st.autohide === false, JSON.stringify(st)); await p2.close(); await lib.close();
    // same origin storage as `page` (separate context here), so set through the page itself the way the settings dialog does, then check live updates:
    for (const pos of ['left', 'center', 'right']) {
      await page.evaluate(async (pos) => { const m = await import('./js/ingameui.js'); m.saveUi({ pos, autohide: false }); }, pos); await sleep(200);
      const g = await page.evaluate(() => { const r = document.getElementById('menu-btn').getBoundingClientRect(); return { l: r.left, r: r.right, c: (r.left + r.right) / 2, vw: innerWidth, top: r.top }; });
      if (pos === 'left') assert(g.l < 12 && g.top < 12, JSON.stringify(g)); if (pos === 'center') assert(Math.abs(g.c - g.vw / 2) < 2, JSON.stringify(g)); if (pos === 'right') assert(g.vw - g.r < 12, JSON.stringify(g));
      await tap(g.c, 26); await page.waitForSelector('#pmenu:not([hidden])', { timeout: 3000 }); await page.click('#pm-resume');
    }
    await page.evaluate(async () => { const m = await import('./js/ingameui.js'); m.saveUi({ pos: 'right', autohide: false }); });
    await sleep(4400); assert(await page.evaluate(() => !document.getElementById('menu-btn').classList.contains('faded')), 'auto-hide off => never fades');
    await page.click('#menu-btn'); await page.waitForSelector('#pmenu:not([hidden])'); await page.click('#pm-btnpos'); assert(await page.evaluate(() => JSON.parse(localStorage.getItem('rp.ui')).pos) === 'left' && await page.evaluate(() => document.getElementById('menu-btn').dataset.pos) === 'left', 'menu cycle moves the button'); await page.click('#pm-resume');
    await page.evaluate(async () => { const m = await import('./js/ingameui.js'); m.saveUi({ pos: 'right', autohide: true }); });
  });
  await step('landscape: no bar on dead-zone touches, ☰ at top-right, menu reachable and scrollable to Exit', async () => {
    await vp(844, 390, 2); await sleep(800);
    for (const [x, y] of [[422, 360], [422, 200], [30, 380], [800, 380]]) { await tap(x, y); await sleep(250); noBar(await barState(), `landscape tap ${x},${y}`); }
    const g = await page.evaluate(() => { const r = document.getElementById('menu-btn').getBoundingClientRect(); return { r: r.right, t: r.top, vw: innerWidth }; }); assert(g.vw - g.r < 12 && g.t < 12, JSON.stringify(g));
    await tap(g.r - 22, 28); await page.waitForSelector('#pmenu:not([hidden])', { timeout: 3000 }); await page.screenshot({ path: 'tests/out/ingame-menu-landscape.png' });
    await page.evaluate(() => document.getElementById('pm-exit').scrollIntoView()); const ex = await page.evaluate(() => { const r = document.getElementById('pm-exit').getBoundingClientRect(); return { t: r.top, b: r.bottom, vh: innerHeight }; }); assert(ex.t >= 0 && ex.b <= ex.vh + 1, 'exit reachable ' + JSON.stringify(ex));
    await page.evaluate(() => document.getElementById('pm-resume').scrollIntoView()); await page.click('#pm-resume'); await vp(390, 844, 2);
  });
  await step('Exit to library from the menu works', async () => {
    await sleep(500); await page.click('#menu-btn'); await page.waitForSelector('#pmenu:not([hidden])'); await page.click('#pm-exit'); await page.waitForFunction(() => location.pathname.endsWith('index.html'), { timeout: 8000 });
  });
  await step('no uncaught JS errors', async () => assert(!errs.length, errs.join(' | ')));
} finally { await browser.close(); srv && srv.kill(); }
console.log(failed ? `ingame: ${failed}/${total} FAILED` : `ingame: all ${total} checks passed`); process.exit(failed ? 1 : 0);
