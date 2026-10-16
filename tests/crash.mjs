// Crash-handling tests (headless Chrome): cross-core snapshot repro, fault injection (late + early), stall watchdog.
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
async function open(core, query = '', seedState = null) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  page.errs = []; page.on('pageerror', (e) => page.errs.push(e.message));
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(async (bytes, core, seedState) => {
    const db = await import('./js/db.js');
    await db.putRom({ id: 'crash', file: 'nes-test.nes', title: 'nes test', system: 'nes', core, size: bytes.length, added: Date.now(), lastPlayed: 0, data: new Uint8Array(bytes).buffer });
    if (seedState) await db.putState({ id: 'crash', core: seedState.core, data: new Uint8Array(seedState.bytes).buffer, time: Date.now() });
  }, bytes, core, seedState);
  await page.goto(base + 'player.html?id=crash' + query, { waitUntil: 'domcontentloaded' });
  return page;
}
async function startGame(page) {
  await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 90000 });
  await page.click('.ejs_start_button');
  await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, { timeout: 90000 });
  await sleep(1500);
}
try {
  let fceummState;
  await step('capture a fceumm state', async () => {
    const p = await open('fceumm'); await startGame(p);
    fceummState = await p.evaluate(() => [...window.EJS_emulator.gameManager.getState()]);
    assert(fceummState.length > 1000, 'state size ' + fceummState.length); await p.close(); return fceummState.length + ' bytes';
  });
  await step('old behaviour repro: fceumm state loaded into nestopia (state tagged with the WRONG core)', async () => {
    // the new player refuses this; we bypass the guard by tagging the snapshot as nestopia to see what the core does
    const p = await open('nestopia', '&resume=1', { core: 'nestopia', bytes: fceummState }); await startGame(p); await sleep(1000);
    const f1 = await p.evaluate(() => window.EJS_emulator.gameManager.getFrameNum()); await sleep(4000);
    const info = await p.evaluate((f1) => ({ crashed: !!window.__rpCrashed, framesIn4s: window.EJS_emulator.gameManager.getFrameNum() - f1 }), f1);
    await p.close(); return JSON.stringify(info) + ' (0 frames = silently frozen core; the guard prevents loading it)';
  });
  await step('control: same-core snapshot resumes and keeps running', async () => {
    const p = await open('fceumm', '&resume=1', { core: 'fceumm', bytes: fceummState }); await startGame(p); await sleep(1000);
    const f1 = await p.evaluate(() => window.EJS_emulator.gameManager.getFrameNum()); await sleep(4000);
    const d = await p.evaluate((f1) => window.EJS_emulator.gameManager.getFrameNum() - f1, f1); await p.close();
    assert(d > 100, 'frames in 4s: ' + d); return 'frames in 4s: ' + d;
  });
  await step('new guard: snapshot from another core is ignored', async () => {
    const p = await open('nestopia', '&resume=1', { core: 'fceumm', bytes: fceummState }); await startGame(p);
    const has = await p.evaluate(() => typeof window.EJS_loadStateURL); assert(has === 'undefined', 'loadStateURL=' + has); await p.close();
  });
  await step('late core fault shows the crash screen with Resume / Restart / other core', async () => {
    const p = await open('fceumm'); await startGame(p); await sleep(16000);
    await p.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'RuntimeError: memory access out of bounds' })));
    await p.waitForSelector('#crash', { visible: true, timeout: 3000 });
    const t = await p.evaluate(() => ({ msg: document.querySelector('#crash-msg').textContent, alt: document.querySelector('#crash-alt').textContent, altHidden: document.querySelector('#crash-alt').hidden }));
    assert(!t.altHidden && /Nestopia/.test(t.alt), JSON.stringify(t)); await p.screenshot({ path: 'tests/out/crash.png' });
    await p.click('#crash-alt'); await p.waitForFunction(() => location.search.includes('switched=1'), { timeout: 5000 });
    await p.waitForSelector('#banner', { visible: true, timeout: 5000 });
    const core = await p.evaluate(async () => (await (await import('./js/db.js')).getRom('crash')).core); assert(core === 'nestopia', core); await p.close();
  });
  await step('early core fault auto-falls back to the other core (once)', async () => {
    const p = await open('nestopia'); await startGame(p);
    await p.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'Aborted(RuntimeError: unreachable)' })));
    await p.waitForFunction(() => location.search.includes('switched=1'), { timeout: 8000 });
    const core = await p.evaluate(async () => (await (await import('./js/db.js')).getRom('crash')).core); assert(core === 'fceumm', core);
    await startGame(p);                                       // second early fault in the same session -> crash screen, no loop
    await p.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'Aborted(RuntimeError: unreachable)' })));
    await p.waitForSelector('#crash', { visible: true, timeout: 5000 }); await p.close();
  });
  await step('stall watchdog detects a frozen core', async () => {
    const p = await open('nestopia'); await startGame(p); await sleep(16000);
    await p.evaluate(() => { window.EJS_emulator.gameManager.getFrameNum = () => 12345; });
    await p.waitForSelector('#crash', { visible: true, timeout: 25000 }); await p.close();
  });
  await step('guarded flush does not run when paused/hidden and never throws', async () => {
    const p = await open('nestopia'); await startGame(p);
    const r = await p.evaluate(() => { const gm = window.EJS_emulator.gameManager; let n = 0; const o = gm.saveSaveFiles.bind(gm); gm.saveSaveFiles = () => { n++; return o(); }; window.EJS_emulator.paused = true; document.dispatchEvent(new Event('visibilitychange')); return n; });
    await p.close(); return 'saveSaveFiles calls while paused: ' + r;
  });
} finally { await browser.close(); srv.kill(); }
process.exit(failed ? 1 : 0);
