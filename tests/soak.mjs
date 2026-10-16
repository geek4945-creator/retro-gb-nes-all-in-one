// Soak test: run one ROM for N minutes in headless Chrome and report crashes, frame progress and memory.
// Usage: node tests/soak.mjs <rom-path> <core> [minutes=5]   (needs network for the CDN)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const [romPath, core = 'fceumm', minStr = '5'] = process.argv.slice(2);
const minutes = Number(minStr);
const PORT = 18000 + Math.floor(Math.random() * 20000);
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 300000, timeout: 120000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
const log = []; let exit = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => log.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /abort|unreachable|out of bounds|RuntimeError|crash/i.test(t)) log.push(`CONSOLE[${m.type()}] ${t.slice(0, 300)}`); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle0' });
  // seed library directly with the ROM and the requested core
  const bytes = [...readFileSync(romPath)];
  const name = romPath.split('/').pop();
  await page.evaluate(async (bytes, name, core) => {
    const { putRom } = await import('./js/db.js'); const { systemFor } = await import('./js/cores.js');
    await putRom({ id: 'soak', file: name, title: 'soak', system: systemFor(name), core, size: bytes.length, added: Date.now(), lastPlayed: 0, data: new Uint8Array(bytes).buffer });
  }, bytes, name, core);
  await page.goto(`http://localhost:${PORT}/player.html?id=soak`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 90000 });
  await page.click('.ejs_start_button');
  await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, { timeout: 90000 });
  const t0 = Date.now(); let i = 0;
  while (Date.now() - t0 < minutes * 60000) {
    await sleep(15000); i++;
    if (i % 2 === 0) { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); }   // exercise persist path (state is 'visible' so no-op unless hidden)
    const s = await page.evaluate(() => {
      const e = window.EJS_emulator; let frames = null;
      try { frames = e.gameManager.getFrameNum ? e.gameManager.getFrameNum() : null; } catch (x) {}
      return { started: e.started, paused: e.paused, heapMB: e.Module && e.Module.HEAPU8 ? Math.round(e.Module.HEAPU8.length / 1048576) : null, jsMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, frames, crashed: !!window.__rpCrashed, text: (document.querySelector('#crash') || {}).hidden === false };
    });
    console.log(`t=${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(s));
    if (s.crashed || s.text) { log.push('CRASH SCREEN SHOWN'); break; }
  }
  await page.screenshot({ path: `tests/out/soak-${core}.png` });
} catch (e) { log.push('SOAK ERROR ' + e.message); } finally { await browser.close(); srv.kill(); }
console.log(log.length ? 'ISSUES:\n' + [...new Set(log)].join('\n') : 'NO ISSUES'); process.exit(log.length ? 1 : 0);
