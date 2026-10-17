// Boot matrix: for every system (or KEYS=psx,n64,...), store a generated stub image in the library, launch the player with the
// system's default core (ALT=1: also every alternate core) and record whether the core downloaded, initialised, accepted the file
// and produced frames. Needs network access to cdn.emulatorjs.org. Output: tests/out/systems.json + a table.
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const PORT = Number(process.env.PORT || 18000 + Math.floor(Math.random() * 20000)), base = `http://localhost:${PORT}/`;
mkdirSync('tests/fixtures/systems', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-system-stubs.py', 'tests/fixtures/systems'], { stdio: 'ignore' });
const man = JSON.parse(readFileSync('tests/fixtures/systems/manifest.json', 'utf8'));
const { SYSTEMS } = await import('../www/js/cores.js');
const keys = (process.env.KEYS ? process.env.KEYS.split(',') : Object.keys(SYSTEMS));
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 300000, timeout: 120000,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const results = []; const TIMEOUT = Number(process.env.BOOT_TIMEOUT || 80000);
async function run(key, core) {
  const t0 = Date.now(), m = man[key], rec = { key, core, label: SYSTEMS[key].label, heavy: !!SYSTEMS[key].heavy, status: 'FAIL', detail: '' };
  const page = await browser.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (c) => { if (c.type() === 'error' && !/Failed to load resource|favicon/.test(c.text())) errs.push(c.text()); });
  try {
    await page.goto(base + 'index.html', { waitUntil: 'domcontentloaded' });
    const b64 = readFileSync('tests/fixtures/systems/' + m.file).toString('base64');
    const id = await page.evaluate(async (key, core, file, b64) => {
      const db = await import('./js/db.js'); const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const id = 'sys-' + key + '-' + core;
      await db.putRom({ id, file, title: key + ' stub', system: key, core, size: bin.length, added: Date.now(), lastPlayed: 0, data: bin.buffer });
      await db.deleteState(id).catch(() => {}); return id;
    }, key, core, m.file, b64);
    await page.goto(`${base}player.html?id=${id}`, { waitUntil: 'domcontentloaded' });
    // wait for start button / error
    const deadline = Date.now() + TIMEOUT; let phase = '';
    while (Date.now() < deadline) {
      let st; try {
        st = await page.evaluate(() => { const e = window.EJS_emulator; const sb = document.querySelector('.ejs_start_button'); const s = document.querySelector('#status');
          return { url: location.search, iso: self.crossOriginIsolated, btn: !!sb && sb.offsetParent !== null, started: !!(e && e.started), failed: !!(e && e.failedToStart), text: (e && e.textElem && e.textElem.innerText) || '', err: s && !s.hidden && s.classList.contains('err') ? s.textContent : '', crashed: !!window.__rpCrashed }; });
      } catch (x) { await sleep(500); continue; }          // navigation (iso redirect) in progress
      rec.isolated = st.iso;
      if (st.err) { rec.status = 'FAIL'; rec.detail = st.err; break; }
      if (st.failed) { rec.status = 'REJECTED'; rec.detail = st.text.replace(/\s+/g, ' ').slice(0, 160); break; }
      if (st.btn && !st.started && phase !== 'clicked') { phase = 'clicked'; await page.click('.ejs_start_button').catch(() => {}); }
      if (st.started) {
        await sleep(2500);
        const f = await page.evaluate(() => { try { return window.EJS_emulator.gameManager.getFrameNum(); } catch (e) { return -1; } });
        await sleep(2000);
        const f2 = await page.evaluate(() => { try { return window.EJS_emulator.gameManager.getFrameNum(); } catch (e) { return -1; } });
        const crashed = await page.evaluate(() => !!window.__rpCrashed);
        rec.frames = f2 - f; rec.detail = `frames ${f}→${f2}`;
        rec.status = crashed ? 'CRASH' : f2 > f ? 'BOOT' : 'STALL';
        break;
      }
      await sleep(400);
    }
    if (rec.status === 'FAIL' && !rec.detail) rec.detail = 'timeout waiting for start (' + phase + ')';
    rec.threads = await page.evaluate(() => !!window.EJS_threads).catch(() => null);
    if (process.env.SHOT) await page.screenshot({ path: `tests/out/sys-${key}-${core}.png` }).catch(() => {});
  } catch (e) { rec.detail = e.message.slice(0, 160); }
  rec.errors = errs.slice(0, 2).map((x) => x.slice(0, 140)); rec.ms = Date.now() - t0;
  await page.close().catch(() => {});
  return rec;
}
try {
  for (const k of keys) {
    const cores = process.env.ALT ? SYSTEMS[k].cores : [SYSTEMS[k].cores[0]];
    for (const c of cores) {
      const r = await run(k, c); results.push(r);
      console.log(`${r.status.padEnd(8)} ${k.padEnd(8)} ${c.padEnd(18)} ${String(r.ms / 1000).slice(0, 5).padStart(5)}s  iso=${r.isolated} thr=${r.threads}  ${r.detail}${r.errors.length ? '  [' + r.errors[0] + ']' : ''}`);
      writeFileSync('tests/out/systems.json', JSON.stringify(results, null, 1));
    }
  }
} finally { await browser.close(); srv.kill(); }
if (process.env.WRITE_DOC) {
  mkdirSync('docs', { recursive: true });
  const L = ['# Boot matrix (stub images)', '', `Generated by \`WRITE_DOC=1 ALT=1 node tests/systems.mjs\` on ${new Date().toISOString().slice(0, 10)} with EmulatorJS ${(await import('../www/js/cores.js')).EJS_VERSION}, headless Chrome (SwiftShader WebGL).`,
    'Stub images are tiny generated files (not games). **BOOT** = the core downloaded, initialised, accepted the file and the frame counter advanced; it does not mean a real game was played. ⚠ = heavy system. *iso* = ran cross-origin isolated (threaded core).', '',
    '| System | Core | Result | Frames in 2 s | Isolated | Detail |', '|---|---|---|---|---|---|'];
  for (const r of results) L.push(`| ${r.label}${r.heavy ? ' ⚠' : ''} | \`${r.core}\` | **${r.status}** | ${r.frames ?? ''} | ${r.isolated ? 'iso' : ''} | ${(r.detail + (r.errors && r.errors[0] ? ' — ' + r.errors[0] : '')).replace(/\|/g, '/')} |`);
  writeFileSync('docs/boot-matrix.md', L.join('\n') + '\n');
}
const bad = results.filter((r) => ['FAIL', 'CRASH', 'STALL'].includes(r.status));
console.log(`\n${results.filter((r) => r.status === 'BOOT').length} booted, ${results.filter((r) => r.status === 'REJECTED').length} loaded the core but rejected the stub, ${bad.length} problem(s)`);
process.exit(0);
