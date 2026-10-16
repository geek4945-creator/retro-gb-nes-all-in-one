// Nintendo DS probe: do the DS cores (desmume2015, melonds) download, initialise and run single-threaded (no COOP/COEP)?
// The ROM is a zero-filled stub with a DS header (NOT a game), so a black screen is expected; we check the core boots and keeps running.
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
mkdirSync('tests/fixtures', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/ds-test.nds']);
const PORT = 18000 + Math.floor(Math.random() * 20000);
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 300000, timeout: 120000, args: ['--no-sandbox'] });
const bytes = [...readFileSync('tests/fixtures/ds-test.nds')]; let failed = 0;
for (const core of ['desmume2015', 'melonds']) {
  try {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle0' });
    await page.evaluate(async (bytes, core) => { const db = await import('./js/db.js'); await db.putRom({ id: 'ds', file: 'ds-test.nds', title: 'ds test', system: 'nds', core, size: bytes.length, added: Date.now(), lastPlayed: 0, data: new Uint8Array(bytes).buffer }); }, bytes, core);
    await page.goto(`http://localhost:${PORT}/player.html?id=ds`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 });
    await page.click('.ejs_start_button');
    await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, { timeout: 120000 });
    await sleep(1500); const f1 = await page.evaluate(() => window.EJS_emulator.gameManager.getFrameNum()); await sleep(4000);
    const info = await page.evaluate((f1) => ({ core: window.EJS_emulator.getCore(), threads: !!window.EJS_threads, crossOriginIsolated, framesIn4s: window.EJS_emulator.gameManager.getFrameNum() - f1, crashed: !!window.__rpCrashed, url: location.search }), f1);
    await page.screenshot({ path: `tests/out/ds-${core}.png` });
    console.log(info.core === core && info.framesIn4s > 20 && !info.crashed ? 'PASS' : 'FAIL', core, JSON.stringify(info), errs.length ? 'errs: ' + errs.join('|') : '');
    if (!(info.framesIn4s > 20)) failed++;
  } catch (e) { failed++; console.log('FAIL', core, e.message); }
}
await browser.close(); srv.kill(); process.exit(failed ? 1 : 0);
