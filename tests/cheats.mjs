// Cheats: manual Game Genie / raw codes + libretro-database browser. GitHub (API + raw) is faked by request interception;
// EmulatorJS really boots the NES test ROM and the codes reach the core through gameManager.setCheat.
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
const rom = readFileSync('tests/fixtures/nes-test.nes'), gh = [];
const CHT = 'cheats = 3\n\ncheat0_desc = "Infinite Lives"\ncheat0_code = "SXIOPO"\ncheat0_enable = false\n\ncheat1_desc = "Always Big"\ncheat1_code = "0754:00+0756:01"\ncheat1_enable = false\n\ncheat2_desc = "Moon Jump"\ncheat2_code = "AAAAAA"\ncheat2_enable = false\n';
await sleep(800);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 420, height: 860 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url()), H = { 'access-control-allow-origin': '*' };
    if (u.hostname === 'api.github.com' && u.pathname.includes('libretro-database')) {
      gh.push(u.pathname);
      if (u.pathname.endsWith('/contents/cht')) return req.respond({ status: 200, contentType: 'application/json', headers: H, body: JSON.stringify([{ name: 'Nintendo - Game Boy', sha: 'gb1', type: 'dir' }, { name: 'Nintendo - Nintendo Entertainment System', sha: 'nes1', type: 'dir' }]) });
      if (u.pathname.endsWith('/git/trees/nes1')) return req.respond({ status: 200, contentType: 'application/json', headers: H, body: JSON.stringify({ tree: ['10-Yard Fight (USA, Europe)', 'Nes Test (USA)', 'Nes Test (USA) (Game Genie)', 'Super Mario Bros. (World)', 'Zelda (USA)'].map((p) => ({ path: p + '.cht', type: 'blob' })) }) });
      return req.respond({ status: 404, headers: H, body: '' });
    }
    if (u.hostname === 'raw.githubusercontent.com' && u.pathname.includes('/cht/')) {
      gh.push(decodeURIComponent(u.pathname));
      if (decodeURIComponent(u.pathname).endsWith('Nintendo - Nintendo Entertainment System/Nes Test (USA).cht')) return req.respond({ status: 200, contentType: 'text/plain', headers: H, body: CHT });
      return req.respond({ status: 404, headers: H, body: '' });
    }
    req.continue();
  });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  await step('.cht parser + title matching rank the right file first', async () => {
    const r = await page.evaluate(async (cht) => { const c = await import('./js/cheats.js'); return { p: c.parseCht(cht), r: c.rankFiles(['Zelda (USA)', 'Super Mario Bros. 3 (USA)', 'Super Mario Bros. (World)', 'Super Mario Bros. (World) (Game Genie)'], { title: 'Super Mario Bros', file: 'Super Mario Bros. (World).nes' }) }; }, CHT);
    assert(r.p.length === 3 && r.p[1].code === '0754:00+0756:01' && r.p[0].desc === 'Infinite Lives', JSON.stringify(r.p));
    assert(r.r[0] === 'Super Mario Bros. (World)' && !r.r.includes('Zelda (USA)'), r.r.join(' | ')); return r.r.slice(0, 2).join(' | ');
  });
  await page.evaluate(async (b) => { const db = await import('./js/db.js'); await db.putRom({ id: 'c1', file: 'Nes Test (USA).nes', title: 'Nes Test', system: 'nes', core: 'nestopia', size: b.length, added: 1, lastPlayed: 0, data: new Uint8Array(b).buffer }); }, [...rom]);
  const boot = async () => {
    await page.goto(`${base}player.html?id=c1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 });
    await page.evaluate(() => { window.__cheat = []; const iv = setInterval(() => { const g = window.EJS_emulator && EJS_emulator.gameManager; if (g && !g.__spy) { g.__spy = 1; const s = g.setCheat.bind(g), r = g.resetCheat.bind(g); g.setCheat = (...a) => { window.__cheat.push(a.join('|')); return s(...a); }; g.resetCheat = () => { window.__cheat.push('reset'); return r(); }; clearInterval(iv); } }, 20); });
    await page.click('.ejs_start_button'); await page.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 }); await sleep(800);
  };
  await boot();
  await step('☰ → 🧪 Cheats opens our panel; a manual Game Genie code is added, saved and sent to the core', async () => {
    await page.click('#menu-btn'); await sleep(300); assert(!(await page.$eval('#pm-cheats', (e) => e.hidden)), 'cheats hidden');
    await page.click('#pm-cheats'); await page.waitForSelector('#cheat-code', { visible: true });
    const ph = await page.$eval('#cheat-code', (e) => e.placeholder); assert(/Game Genie/.test(ph), ph);
    await page.type('#cheat-desc', 'Lives'); await page.type('#cheat-code', 'SXIOPO'); await page.click('#cheat-add'); await sleep(300);
    const r = await page.evaluate(() => ({ calls: window.__cheat, saved: JSON.parse(localStorage.getItem('rp.cheats.c1')) }));
    assert(r.saved.length === 1 && r.saved[0].on && r.saved[0].code === 'SXIOPO', JSON.stringify(r.saved)); assert(r.calls.includes('0|1|SXIOPO'), r.calls.join(',')); return r.calls.join(',');
  });
  await step('📚 database browser: finds this game, lists its cheats, tapping one enables it (renumbered indices)', async () => {
    await page.click('#cheat-browse'); await page.waitForSelector('.cheat-file', { timeout: 10000 });
    const files = await page.$$eval('.cheat-file', (b) => b.map((x) => x.textContent)); assert(files[0] === 'Nes Test (USA)', files.join(' | '));
    await page.click('.cheat-file'); await page.waitForSelector('.cheat-db', { timeout: 10000 });
    const n = await page.$$eval('.cheat-db', (b) => b.length); assert(n === 3, 'cheats ' + n);
    await page.evaluate(() => { window.__cheat = []; }); const bs = await page.$$('.cheat-db'); await bs[1].click(); await sleep(300);
    const r = await page.evaluate(() => ({ calls: window.__cheat, saved: JSON.parse(localStorage.getItem('rp.cheats.c1')) }));
    assert(r.saved.length === 2 && r.calls.join(',') === 'reset,0|1|SXIOPO,1|1|0754:00+0756:01', r.calls.join(','));
    await page.screenshot({ path: 'tests/out/cheats.png' }); return r.calls.join(',');
  });
  await step('toggling a cheat off re-applies only the enabled ones', async () => {
    await page.click('#pmpanel-back'); await page.click('#pm-cheats'); await page.waitForSelector('.cheat-on');
    await page.evaluate(() => { window.__cheat = []; }); await page.click('.cheat-on'); await sleep(300);
    const c = await page.evaluate(() => window.__cheat.join(',')); assert(c === 'reset,0|1|0754:00+0756:01', c); return c;
  });
  await step('enabled cheats are re-applied automatically next time the game starts; the cheat list is cached', async () => {
    await boot(); await sleep(800);
    const c = await page.evaluate(() => window.__cheat.join(',')); assert(c.includes('0|1|0754:00+0756:01') && !c.includes('SXIOPO'), c);
    assert(gh.filter((p) => p.includes('/git/trees/')).length === 1, gh.join(',')); return c;
  });
  await step('game keeps running with cheats (frames advance)', async () => {
    const f1 = await page.evaluate(() => EJS_emulator.gameManager.getFrameNum()); await sleep(1000); const f2 = await page.evaluate(() => EJS_emulator.gameManager.getFrameNum()); assert(f2 > f1, `${f1}->${f2}`); return `${f1}->${f2}`;
  });
  await step('no page errors', async () => { assert(!errs.length, errs.join(' | ')); });
} finally { await browser.close(); srv.kill(); }
console.log(`\n${total - failed}/${total} passed`); process.exit(failed ? 1 : 0);
