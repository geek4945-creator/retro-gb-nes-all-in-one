// Nintendo DS touchscreen: synthetic touch/mouse input (CDP Input.dispatch*Event) on a DS *test program* that reads the touch panel
// and button registers on the emulated ARM7 and mirrors them into RAM (scripts/make-ds-touch-rom.py), so we observe what the
// emulated DS really receives, for both DS cores. Needs network (EmulatorJS CDN).
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { screenRects, inRect, clampTo, viewportRect, frameSize, resolveLayout, coreOptions, LAYOUTS } from '../www/js/dstouch.js';
mkdirSync('tests/fixtures', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-ds-touch-rom.py', 'tests/fixtures/ds-touch.nds']);
const PORT = Number(process.env.PORT || 18000 + Math.floor(Math.random() * 20000)), base = process.env.BASE_URL || `http://localhost:${PORT}/`;
const srv = process.env.BASE_URL ? null : spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0;
let after = async () => {};
const step = async (n, f) => { total++; try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } try { await after(); } catch {} };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: got ${a}, expected ${b} ±${tol}`);

// ---------------------------------------------------------------- pure geometry (no browser)
await step('geometry: RetroArch viewport maths (portrait is top-aligned, landscape centred) + screen rectangles', () => {
  const v = viewportRect(390, 844, 256, 384); near(v.w, 390, 0.01, 'w'); near(v.h, 585, 0.01, 'h'); assert(v.y === 0, 'portrait top aligned');
  const l = viewportRect(844, 390, 512, 192); near(l.h, 316.5, 0.1, 'landscape h'); near(l.y, 36.7, 0.1, 'landscape centred y');
  const s = screenRects('stacked', 390, 844); near(s.bottom.y, 292.5, 0.01, 'bottom y'); near(s.bottom.h, 292.5, 0.01, 'bottom h'); near(s.top.y, 0, 0.01, 'top y');
  const w = screenRects('sideSwap', 844, 390); near(w.bottom.x, w.vp.x, 0.01, 'swapped side: bottom is left'); assert(!screenRects('bottom', 390, 844).top, 'bottom only has no top');
  assert(frameSize('stacked', [256, 400])[1] === 400 && frameSize('stacked', [512, 192])[0] === 256, 'reported size only used when it matches the layout family');
  assert(resolveLayout('auto', 390, 844) === 'stacked' && resolveLayout('auto', 844, 390) === 'side' && resolveLayout('bottom', 844, 390) === 'bottom', 'auto layout follows orientation');
  assert(coreOptions('desmume2015', { layout: 'side' }, 1, 2).join('|') === 'desmume_pointer_type,touch|desmume_screens_layout,left/right' && coreOptions('melonds', { layout: 'stackedSwap' }, 1, 2)[0][1] === 'Touch' && coreOptions('melonds', { layout: 'stackedSwap' }, 1, 2)[1][1] === 'Bottom/Top', 'core option values');
  const c = clampTo({ x: 10, y: 10, w: 100, h: 50 }, 500, -5, 1.5); assert(c.x === 108.5 && c.y === 11.5 && inRect({ x: 0, y: 0, w: 5, h: 5 }, 4.9, 0) && !inRect({ x: 0, y: 0, w: 5, h: 5 }, 5, 0), 'clamp / hit test');
});

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 300000, timeout: 120000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const bytes = [...readFileSync('tests/fixtures/ds-touch.nds')];

async function suite(core) {
  const T = (n) => `[${core}] ${n}`;
  let cleanup = async () => {};
  const ctx = await browser.createBrowserContext(), page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const vp = (w, h, dpr = 1) => page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: dpr });
  await vp(390, 844, 2);
  after = () => cleanup();
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async (bytes, core) => { const db = await import('./js/db.js'); await db.putRom({ id: 'ds', file: 'ds-touch.nds', title: 'ds touch probe', system: 'nds', core, size: bytes.length, added: Date.now(), lastPlayed: 0, data: new Uint8Array(bytes).buffer }); }, bytes, core);
  await page.goto(`${base}player.html?id=ds`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 });
  await page.click('.ejs_start_button');
  await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started && window.__rpDs, { timeout: 120000 });
  await sleep(2500);
  // locate the probe's RAM block (magic 0xC0FFEE42) in the wasm heap; a running ARM7 keeps its counter increasing
  const found = await page.evaluate(() => { const M = EJS_emulator.Module || EJS_emulator.gameManager.Module; const h = new Uint32Array(M.HEAPU8.buffer); for (let i = 0; i < h.length; i++) if (h[i] === 0xC0FFEE42 && h[i + 4] > 0 && h[i + 4] < 1e9 && h[i + 1] < 2) { window.__ai = i; return true; } return false; });
  const probe = () => page.evaluate(() => { const M = EJS_emulator.Module || EJS_emulator.gameManager.Module; const h = new Uint32Array(M.HEAPU8.buffer), i = window.__ai; return { down: h[i + 1], x: h[i + 2] >> 4, y: h[i + 3] >> 4, cnt: h[i + 4], keys: h[i + 5] & 0x3ff, xy: h[i + 6] & 0xff }; });
  const cdp = await page.createCDPSession();
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id = 1]) => ({ x, y, id })) });
  const mouse = (type, x, y, buttons = 1) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0 });
  const settle = () => sleep(170);
  cleanup = async () => { await touch('touchEnd', []).catch(() => {}); await mouse('mouseReleased', 5, 5, 0).catch(() => {}); };
  const free = (r, fx, fy) => page.evaluate(([r, fx, fy]) => {     // nearest point to (fx,fy) of rect r that is NOT covered by an on-screen button / menu (so it reaches the overlay)
    const ok = (x, y) => { const e = document.elementFromPoint(x, y); return e && e.id === 'ds-touch'; };
    const cx = r.x + r.w * fx, cy = r.y + r.h * fy;
    for (let d = 0; d < 400; d += 6) for (const [dx, dy] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, d], [d, -d], [-d, -d]]) { const x = cx + dx, y = cy + dy; if (x > r.x + 2 && x < r.x + r.w - 2 && y > r.y + 2 && y < r.y + r.h - 2 && ok(x, y)) return [x, y]; }
    return null;
  }, [r, fx, fy]);
  const geo = () => page.evaluate(() => { const c = document.querySelector('canvas.ejs_canvas'), r = c.getBoundingClientRect(); const s = window.__rpDs.screens(); return { cw: c.width, ch: c.height, rect: [r.left, r.top, r.width, r.height], bottom: s.bottom, top: s.top, layout: window.__rpDs.layoutKey, dpr: devicePixelRatio, rep: window.__rpDs.reported() }; });
  const setDs = (o) => page.evaluate(async (o) => { const m = await import('./js/dstouch.js'); m.saveDs({ ...m.loadDs(), ...o }); }, o).then(() => sleep(700));
  const tapAt = async (x, y) => { await touch('touchStart', [[x, y]]); await settle(); const r = await probe(); await touch('touchEnd', []); await settle(); return r; };
  // expected DS pixel for a client point inside the bottom screen
  const expectPx = (b, x, y) => [(x - b.x) / b.w * 256, (y - b.y) / b.h * 192];
  const rel = (b, fx, fy) => [b.x + b.w * fx, b.y + b.h * fy];

  await step(T('ARM7 probe is running (touch panel + key registers observable)'), async () => {
    assert(found, 'probe block not found in RAM'); const a = await probe(); await sleep(300); const b = await probe(); assert(b.cnt > a.cnt, 'ARM7 counter not advancing'); assert(a.down === 0 && a.keys === 0x3ff, JSON.stringify(a));
  });
  await step(T('overlay + absolute touch options are active; controller set up under the on-screen buttons'), async () => {
    const o = await page.evaluate((core) => ({ overlay: !!document.querySelector('#ds-touch'), lock: EJS_emulator.enableMouseLock, below: (() => { const ov = document.querySelector('#ds-touch'), gp = document.querySelector('.ejs_virtualGamepad_parent'); return !!(gp && (ov.compareDocumentPosition(gp) & Node.DOCUMENT_POSITION_FOLLOWING)); })(), opts: EJS_emulator.getSettingValue ? 1 : 0 }), core);
    assert(o.overlay && o.below && o.lock === false, JSON.stringify(o));
  });

  await step(T('BUG REPRODUCTION: without the fix (controller off, core in its default relative-mouse mode) a finger on the bottom screen reaches nothing'), async () => {
    await page.evaluate((core) => { window.__rpDs.stop(); const g = EJS_emulator.gameManager; if (core === 'melonds') g.setVariable('melonds_touch_mode', 'Mouse'); else g.setVariable('desmume_pointer_type', 'mouse'); }, core);
    await sleep(400); const g = await geo(); const [x, y] = rel(g.bottom, 0.5, 0.5);
    const r = await tapAt(x, y); assert(r.down === 0, 'expected no stylus contact in default mode, got ' + JSON.stringify(r));
    // and the raw absolute mode alone (no controller) still loses the stylus when another finger holds a button
    await page.evaluate((core) => { const g = EJS_emulator.gameManager; if (core === 'melonds') g.setVariable('melonds_touch_mode', 'Touch'); else g.setVariable('desmume_pointer_type', 'touch'); }, core); await sleep(300);
    const btn = await page.evaluate(() => { const b = [...document.querySelectorAll('.ejs_virtualGamepad_parent *')].find((e) => e.textContent.trim() === 'A' && e.getBoundingClientRect().width > 10); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await touch('touchStart', [[btn[0], btn[1], 1]]); await sleep(150); await touch('touchStart', [[btn[0], btn[1], 1], [x, y, 2]]); await settle(); const m = await probe();
    await touch('touchEnd', []); await settle();
    assert(m.down === 0, 'raw RetroArch multi-touch unexpectedly worked: ' + JSON.stringify(m));
    // turn the fix back on
    await page.evaluate(async (core) => { const m = await import('./js/dstouch.js'); const { DsTouch } = m; window.__rpDs = new DsTouch(EJS_emulator, core); }, core); await sleep(500);
  });

  await step(T('DIRECT: taps land on the right DS pixel (centre, corners) at DPR 2'), async () => {
    const g = await geo(); const out = [];
    for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.03, 0.5], [0.97, 0.5]]) {
      const [x, y] = await free(g.bottom, fx, fy), [ex, ey] = expectPx(g.bottom, x, y), r = await tapAt(x, y);
      assert(r.down === 1, `no contact at ${fx},${fy}: ${JSON.stringify(r)}`); near(r.x, ex, 3, `x@${fx},${fy}`); near(r.y, ey, 3, `y@${fx},${fy}`); out.push(`${r.x},${r.y}`);
    }
    const after = await probe(); assert(after.down === 0, 'pen must lift after touchEnd'); return `cw=${g.cw}x${g.ch} dpr=${g.dpr} ` + out.join(' ');
  });
  await step(T('DIRECT: hold and slide follows the finger (drag), contact held, lifts at the end'), async () => {
    const g = await geo(), [x0, y0] = rel(g.bottom, 0.15, 0.2), [x1, y1] = rel(g.bottom, 0.85, 0.8), seen = [];
    await touch('touchStart', [[x0, y0]]); await settle();
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8]]); await settle(); const r = await probe(); assert(r.down === 1, 'contact dropped at step ' + i); seen.push(r); }
    await touch('touchEnd', []); await settle();
    for (let i = 1; i < seen.length; i++) assert(seen[i].x >= seen[i - 1].x && seen[i].y >= seen[i - 1].y, 'not monotonic');
    const [ex, ey] = expectPx(g.bottom, x1, y1); near(seen[7].x, ex, 3, 'end x'); near(seen[7].y, ey, 3, 'end y'); assert((await probe()).down === 0);
  });
  await step(T('DIRECT: a touch that STARTS on the top screen is ignored, even after sliding onto the bottom screen; a fresh touch then works'), async () => {
    const g = await geo(); const [tx, ty] = rel(g.top, 0.5, 0.5), [bx, by] = rel(g.bottom, 0.5, 0.5);
    await touch('touchStart', [[tx, ty]]); await settle(); assert((await probe()).down === 0, 'top touch registered');
    await touch('touchMove', [[bx, by]]); await settle(); assert((await probe()).down === 0, 'slide from the top screen registered');
    await touch('touchEnd', []); await settle(); const r = await tapAt(bx, by); assert(r.down === 1, 'fresh touch must work');
    const lp = await page.evaluate(() => { const g = window.__rpDs.screens().bottom; for (let y = g.y + g.h + 20; y < innerHeight - 20; y += 8) for (let x = 150; x < 260; x += 8) { const e = document.elementFromPoint(x, y); if (e && e.id === 'ds-touch') return [x, y]; } return null; }), letter = await tapAt(lp[0], lp[1]); assert(letter.down === 0, 'touch below the screens (letterbox) must be ignored');
  });
  await step(T('DIRECT: dragging past the screen edge keeps the stylus on the edge pixel (clamped), never drops'), async () => {
    const g = await geo(), [x0, y0] = rel(g.bottom, 0.5, 0.5);
    await touch('touchStart', [[x0, y0]]); await settle();
    await touch('touchMove', [[g.bottom.x + g.bottom.w + 80, y0]]); await settle(); const a = await probe(); assert(a.down === 1 && a.x >= 253, 'right edge ' + JSON.stringify(a));
    await touch('touchMove', [[g.bottom.x + 3, g.bottom.y + g.bottom.h + 90]]); await settle(); const b = await probe(); assert(b.down === 1 && b.x <= 6 && b.y >= 188, 'below the bottom edge ' + JSON.stringify(b));
    await touch('touchMove', [[x0, g.bottom.y - 60]]); await settle(); const c = await probe(); assert(c.down === 1 && c.y <= 3, 'drag up over the top screen stays at the bottom screen top edge ' + JSON.stringify(c));
    await touch('touchEnd', []); await settle();
  });

  await step(T('MULTI-TOUCH: thumb holds the on-screen A button while another finger uses the stylus (both reach the DS)'), async () => {
    const g = await geo(); const btn = await page.evaluate(() => { const b = [...document.querySelectorAll('.ejs_virtualGamepad_parent *')].find((e) => e.textContent.trim() === 'A' && e.getBoundingClientRect().width > 10); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const [x, y] = rel(g.bottom, 0.3, 0.6), [ex, ey] = expectPx(g.bottom, x, y);
    await touch('touchStart', [[btn[0], btn[1], 1]]); await settle(); const a = await probe(); assert((a.keys & 1) === 0, 'A button not pressed: ' + a.keys.toString(2));
    await touch('touchStart', [[btn[0], btn[1], 1], [x, y, 2]]); await settle(); const b = await probe();
    assert(b.down === 1 && (b.keys & 1) === 0, 'stylus + A together: ' + JSON.stringify(b)); near(b.x, ex, 3, 'x'); near(b.y, ey, 3, 'y');
    await touch('touchMove', [[btn[0], btn[1], 1], [x + 40, y + 20, 2]]); await settle(); const c = await probe(); assert(c.down === 1 && c.x > b.x && (c.keys & 1) === 0, 'drag while holding A: ' + JSON.stringify(c));
    await touch('touchEnd', [[x + 40, y + 20, 2]]); await settle(); const d = await probe(); assert(d.down === 0 && (d.keys & 1) === 0, 'stylus lifted, A still held: ' + JSON.stringify(d));
    await touch('touchEnd', []); await settle(); const e = await probe(); assert((e.keys & 1) === 1 && e.down === 0, 'all released: ' + JSON.stringify(e));
  });
  await step(T('MULTI-TOUCH: stylus finger first, then a button finger (order does not matter); an extra finger on the screen is ignored'), async () => {
    const g = await geo(); const btn = await page.evaluate(() => { const b = [...document.querySelectorAll('.ejs_virtualGamepad_parent *')].find((e) => e.textContent.trim() === 'B' && e.getBoundingClientRect().width > 10); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const [x, y] = rel(g.bottom, 0.5, 0.5), [x2, y2] = rel(g.bottom, 0.9, 0.9), [ex, ey] = expectPx(g.bottom, x, y);
    await touch('touchStart', [[x, y, 1]]); await settle();
    await touch('touchStart', [[x, y, 1], [btn[0], btn[1], 2]]); await settle(); const a = await probe(); assert(a.down === 1 && (a.keys & 2) === 0, 'B + stylus ' + JSON.stringify(a));
    await touch('touchStart', [[x, y, 1], [btn[0], btn[1], 2], [x2, y2, 3]]); await settle(); const b = await probe(); near(b.x, ex, 3, 'extra finger must not move the stylus'); near(b.y, ey, 3, 'y');
    await touch('touchEnd', []); await settle(); assert((await probe()).down === 0 && ((await probe()).keys & 2) === 2);
  });

  await step(T('LAYOUTS: every layout puts the touch on the bottom screen only (stacked / swapped / side by side / swapped / bottom only), portrait'), async () => {
    const res = [];
    for (const lay of ['stacked', 'stackedSwap', 'side', 'sideSwap', 'bottom']) {
      await setDs({ layout: lay, mode: 'direct' }); await sleep(500);
      const g = await geo(); assert(g.layout === lay, 'layout ' + g.layout + ' != ' + lay);
      for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.7], [0.8, 0.2]]) { const fp = await free(g.bottom, fx, fy); assert(fp, lay + ': no free point'); const [x, y] = fp, [ex, ey] = expectPx(g.bottom, x, y), r = await tapAt(x, y); assert(r.down === 1, `${lay} ${fx},${fy}: ${JSON.stringify(r)} rect=${JSON.stringify(g.bottom)} rep=${g.rep}`); near(r.x, ex, 3, lay + ' x'); near(r.y, ey, 3, lay + ' y'); }
      if (g.top) { const [x, y] = await free(g.top, 0.5, 0.5); assert((await tapAt(x, y)).down === 0, lay + ': top screen must be ignored'); }
      res.push(`${lay}:${g.rep}`);
    }
    return res.join(' ');
  });
  await step(T('ORIENTATION: rotating to landscape switches Auto to side-by-side and the mapping stays correct (also with DPR 3)'), async () => {
    await setDs({ layout: 'auto', mode: 'direct' }); await sleep(300);
    const out = [];
    for (const [w, h, d] of [[844, 390, 2], [390, 844, 3], [844, 390, 1], [390, 844, 1]]) {
      await vp(w, h, d); await sleep(1200); const g = await geo();
      assert(g.layout === (h > w ? 'stacked' : 'side'), `auto layout ${g.layout} at ${w}x${h}`);
      for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.7]]) {
        const [x, y] = await free(g.bottom, fx, fy); let [ex, ey] = expectPx(g.bottom, x, y), r = await tapAt(x, y);
        if (!r.down) { await sleep(300); r = await tapAt(x, y); }
        assert(r.down === 1, `${w}x${h}@${d} ${fx},${fy} ${JSON.stringify(r)} g=${JSON.stringify({ b: g.bottom, c: [g.cw, g.ch], rep: g.rep })}`); near(r.x, ex, 3, `${w}x${h} x`); near(r.y, ey, 3, `${w}x${h} y`);
      }
      if (g.top) { const [x, y] = await free(g.top, 0.5, 0.5); assert((await tapAt(x, y)).down === 0, 'top ignored in ' + w + 'x' + h); }
      out.push(`${w}x${h}@${d}:${g.layout}(canvas ${g.cw}x${g.ch})`);
    }
    return out.join(' ');
  });
  await step(T('LANDSCAPE: on-screen buttons that overlap the screens still win; the stylus works next to them'), async () => {
    await vp(844, 390, 2); await sleep(1200); const g = await geo();
    const btn = await page.evaluate(() => { const b = [...document.querySelectorAll('.ejs_virtualGamepad_parent *')].find((e) => e.textContent.trim() === 'A' && e.getBoundingClientRect().width > 10); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const top = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.closest('.ejs_virtualGamepad_parent') ? 'gamepad' : e.id || e.className); }, btn);
    assert(top === 'gamepad', 'element at the A button is ' + top);
    await touch('touchStart', [[btn[0], btn[1]]]); await settle(); const p = await probe(); await touch('touchEnd', []); await settle();
    assert((p.keys & 1) === 0 && p.down === 0, 'A pressed without touching the stylus: ' + JSON.stringify(p));
    const [x, y] = rel(g.bottom, 0.5, 0.5); assert((await tapAt(x, y)).down === 1);
    await vp(390, 844, 2); await sleep(1000);
  });

  await step(T('TRACKPAD: dragging moves a cursor without touching the screen; tap = tap at the cursor; tap-then-drag and 2nd finger hold the stylus down'), async () => {
    await setDs({ mode: 'trackpad', layout: 'stacked', speed: 1.5 }); await sleep(600);
    const g = await geo(); const c0 = await page.evaluate(() => ({ ...window.__rpDs.cursor })); near(c0.x, g.bottom.x + g.bottom.w / 2, 2, 'cursor starts centred'); near(c0.y, g.bottom.y + g.bottom.h / 2, 2, 'cursor y');
    assert(await page.$eval('#ds-cursor', (e) => getComputedStyle(e).display === 'block'), 'cursor dot visible');
    // 1) drag: cursor moves by finger delta * speed, no contact
    const [sx, sy] = await page.evaluate(() => { const g = window.__rpDs.screens().bottom; for (let y = g.y + g.h + 20; y < innerHeight - 20; y += 8) for (let x = 150; x < 260; x += 8) { const e = document.elementFromPoint(x, y); if (e && e.id === 'ds-touch') return [x, y]; } return null; });      // empty pad area under the screens (not under a button)
    await touch('touchStart', [[sx, sy]]); await settle(); await touch('touchMove', [[sx + 40, sy - 30]]); await settle(); const mid = await probe(); assert(mid.down === 0, 'moving the cursor must not touch the screen'); await touch('touchEnd', []); await settle();
    const c1 = await page.evaluate(() => ({ ...window.__rpDs.cursor })); near(c1.x - c0.x, 60, 2, 'cursor dx = 40*1.5'); near(c1.y - c0.y, -45, 2, 'cursor dy = -30*1.5');
    // 2) tap: pen down at the cursor
    await touch('touchStart', [[sx, sy]]); await sleep(40); await touch('touchEnd', []); await sleep(35); const tap = await probe(); const [ex, ey] = expectPx(g.bottom, c1.x, c1.y);
    assert(tap.down === 1, 'tap must press the stylus ' + JSON.stringify(tap)); near(tap.x, ex, 3, 'tap x'); near(tap.y, ey, 3, 'tap y'); await sleep(250); assert((await probe()).down === 0, 'tap must release');
    // 3) tap then immediately press-and-drag: stylus held down while moving
    await sleep(200); await touch('touchStart', [[sx, sy]]); await sleep(40); await touch('touchEnd', []); await sleep(40);
    await touch('touchStart', [[sx, sy]]); await settle(); const h0 = await probe(); assert(h0.down === 1, 'second press within the drag window holds the stylus ' + JSON.stringify(h0));
    await touch('touchMove', [[sx + 30, sy]]); await settle(); const h1 = await probe(); assert(h1.down === 1 && h1.x > h0.x, 'drag moves the held stylus ' + JSON.stringify([h0, h1])); await touch('touchEnd', []); await settle(); assert((await probe()).down === 0);
    // 4) second finger = pen down while the first finger steers
    await sleep(400); await touch('touchStart', [[sx, sy, 1]]); await settle(); await touch('touchStart', [[sx, sy, 1], [sx + 8, sy + 16, 2]]); await settle(); assert((await probe()).down === 1, 'second finger presses');
    await touch('touchMove', [[sx + 30, sy, 1], [sx + 8, sy + 16, 2]]); await settle(); const k = await probe(); assert(k.down === 1, 'steering while pressing'); await touch('touchEnd', [[sx + 8, sy + 16, 2]]); await settle(); assert((await probe()).down === 0, 'second finger lifted'); await touch('touchEnd', []); await settle();
    // 5) starting on the top screen does nothing
    const [tx, ty] = rel(g.top, 0.5, 0.5), before = await page.evaluate(() => ({ ...window.__rpDs.cursor }));
    await touch('touchStart', [[tx, ty]]); await settle(); await touch('touchMove', [[tx + 50, ty + 50]]); await settle(); await touch('touchEnd', []); await settle();
    const after = await page.evaluate(() => ({ ...window.__rpDs.cursor })); assert(Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1, 'top-screen gesture must not move the cursor');
    // 6) cursor never leaves the bottom screen
    await touch('touchStart', [[sx, sy]]); await settle(); await touch('touchMove', [[sx + 900, sy - 900]]); await settle(); await touch('touchEnd', []); await settle();
    const edge = await page.evaluate(() => ({ ...window.__rpDs.cursor })); assert(edge.x <= g.bottom.x + g.bottom.w && edge.y >= g.bottom.y, 'cursor clamped to the bottom screen: ' + JSON.stringify(edge));
    await setDs({ mode: 'direct' });
  });

  await step(T('DESKTOP MOUSE: click and drag on the bottom screen works directly (no pointer lock), top screen clicks ignored'), async () => {
    await vp(1100, 800, 1); await sleep(1200); await setDs({ layout: 'stacked', mode: 'direct' }); await sleep(500);
    const g = await geo(); const [x, y] = rel(g.bottom, 0.4, 0.6), [ex, ey] = expectPx(g.bottom, x, y);
    await mouse('mouseMoved', x, y, 0); await mouse('mousePressed', x, y); await settle(); const a = await probe(); assert(a.down === 1, 'mouse down ' + JSON.stringify(a)); near(a.x, ex, 3, 'x'); near(a.y, ey, 3, 'y');
    const [x2, y2] = rel(g.bottom, 0.8, 0.3); await mouse('mouseMoved', x2, y2); await settle(); const b = await probe(); assert(b.down === 1 && b.x > a.x && b.y < a.y, 'mouse drag ' + JSON.stringify(b));
    await mouse('mouseReleased', x2, y2, 0); await settle(); assert((await probe()).down === 0, 'mouse up');
    assert(!(await page.evaluate(() => !!document.pointerLockElement)), 'no pointer lock');
    const [tx, ty] = rel(g.top, 0.5, 0.5); await mouse('mousePressed', tx, ty); await settle(); assert((await probe()).down === 0, 'top click ignored'); await mouse('mouseReleased', tx, ty, 0);
    await vp(390, 844, 2); await sleep(1000);
  });

  await step(T('NO BOTTOM BAR: dead-zone touches on DS do nothing (no EmulatorJS bar, no stylus contact); ☰ at the top stays usable and does not steal bottom-screen taps'), async () => {
    await setDs({ mode: 'direct', layout: 'stacked', speed: 1.5 }); await sleep(600);
    const g = await geo(); const dz = await page.evaluate(() => { const o = []; for (let y = 600; y < innerHeight; y += 20) for (let x = 6; x < innerWidth; x += 20) { const e = document.elementFromPoint(x, y); if (e && e.id === 'ds-touch') o.push([x, y]); } return o; });
    const out = dz.filter(([x, y]) => !(g.bottom.x <= x && x <= g.bottom.x + g.bottom.w && g.bottom.y <= y && y <= g.bottom.y + g.bottom.h));
    assert(out.length > 0, 'no dead-zone point found'); const pick = [out[0], out[out.length >> 1], out[out.length - 1]];
    for (const [x, y] of pick) { const r = await tapAt(x, y); assert(r.down === 0, `dead-zone tap ${x},${y} reached the stylus`); }
    const bar = await page.evaluate(() => { const b = document.querySelector('.ejs_menu_bar'); return { vis: getComputedStyle(b).visibility, pe: getComputedStyle(b).pointerEvents, hidden: b.classList.contains('ejs_menu_bar_hidden'), menu: document.getElementById('pmenu').hidden, paused: !!EJS_emulator.paused }; });
    assert(bar.vis === 'hidden' && bar.pe === 'none' && bar.menu && !bar.paused, JSON.stringify(bar));
    const [bx, by] = rel(g.bottom, 0.5, 0.5), r2 = await tapAt(bx, by); assert(r2.down === 1, 'bottom screen tap still works');
    const btn = await page.evaluate(() => { const r = document.getElementById('menu-btn').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const r3 = await tapAt(btn[0], btn[1]); await sleep(300); assert(await page.evaluate(() => !document.getElementById('pmenu').hidden), '☰ opens the menu on DS'); assert(r3.down === 0, '☰ tap must not reach the stylus');
    await page.evaluate(() => document.getElementById('pm-resume').click()); await sleep(200);
  });
  await step(T('PAUSE MENU: DS quick switches change mode/layout live; settings persist; the pause menu stops touch forwarding'), async () => {
    await setDs({ mode: 'direct', layout: 'stacked' });
    await page.click('#menu-btn'); await page.waitForSelector('#pmenu:not([hidden])');
    const labels = await page.$$eval('#pm-dsmode, #pm-dslayout', (b) => b.map((x) => x.textContent)); assert(labels.length === 2 && /Direct/.test(labels[0]) && /Stacked/.test(labels[1]), labels.join('|'));
    await page.click('#pm-dsmode'); await page.click('#pm-dslayout'); await sleep(600);
    const s = await page.evaluate(() => ({ ...JSON.parse(localStorage.getItem('rp.ds')), layoutKey: window.__rpDs.layoutKey, mode: window.__rpDs.s.mode }));
    assert(s.mode === 'trackpad' && s.layout === 'stackedSwap' && s.layoutKey === 'stackedSwap', JSON.stringify(s));
    await page.click('#pm-resume'); await sleep(300); await setDs({ mode: 'direct', layout: 'auto' });
  });
  assert(errs.filter((e) => !/Abort|abort/.test(e)).length === 0, 'page errors: ' + errs.join(' | '));
  await ctx.close();
}

for (const core of ['desmume2015', 'melonds']) { try { await suite(core); } catch (e) { failed++; console.log('FAIL suite', core, e.stack || e.message); } }

// ---- other systems must be untouched: a NES game gets no overlay, no DS code
await step('NES game: no DS overlay, no dstouch.js loaded, default options untouched', async () => {
  execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/nes-test.nes']);
  const page = await (await browser.createBrowserContext()).newPage(); await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  const nes = [...readFileSync('tests/fixtures/nes-test.nes')];
  await page.evaluate(async (b) => { const db = await import('./js/db.js'); await db.putRom({ id: 'n1', file: 'a.nes', title: 'nes', system: 'nes', core: 'nestopia', size: b.length, added: 1, lastPlayed: 0, data: new Uint8Array(b).buffer }); }, nes);
  await page.goto(`${base}player.html?id=n1`); await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 }); await page.click('.ejs_start_button');
  await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, { timeout: 90000 });
  const o = await page.evaluate(() => ({ overlay: !!document.querySelector('#ds-touch'), ds: !!window.__rpDs, mod: performance.getEntriesByType('resource').some((r) => /dstouch\.js/.test(r.name)), lock: window.EJS_defaultOptions.lockMouse, ptype: window.EJS_defaultOptions.desmume_pointer_type, dsBtn: !!document.querySelector('#pm-dsmode') }));
  assert(!o.overlay && !o.ds && !o.mod && o.lock === undefined && o.ptype === undefined && !o.dsBtn, JSON.stringify(o));
  await page.close();
});

await step('library Settings has "Nintendo DS touch & screens" and it stores the choices', async () => {
  const page = await (await browser.createBrowserContext()).newPage(); await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await page.click('#btn-settings'); await page.waitForSelector('#settings[open]'); await page.click('#btn-ds'); await page.waitForSelector('#dstouch[open] #ds-mode');
  await page.select('#ds-mode', 'trackpad'); await page.select('#ds-layout', 'sideSwap'); await page.select('#ds-speed', '2');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('rp.ds'))); assert(s.mode === 'trackpad' && s.layout === 'sideSwap' && s.speed === 2, JSON.stringify(s));
  const txt = await page.$eval('#dstouch', (d) => d.innerText); assert(!/About|Credits/i.test(txt), 'no About/credits'); await page.screenshot({ path: 'tests/out/ds-settings.png' });
  await page.close();
});

await browser.close(); if (srv) srv.kill();
console.log(failed ? `${failed}/${total} FAILED` : `dstouch: all ${total} checks passed`); process.exit(failed ? 1 : 0);
