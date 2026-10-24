// RetroAchievements: login, hardcore rules in-game, achievement list for the running game (matched by RA's ROM hash).
// The RetroAchievements Web API is replaced by an in-test fake (request interception); EmulatorJS really boots the NES test ROM.
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
mkdirSync('tests/fixtures', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/nes-test.nes']);
const PORT = 18000 + Math.floor(Math.random() * 20000), base = `http://localhost:${PORT}/`;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0;
const step = async (n, f) => { total++; try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const rom = readFileSync('tests/fixtures/nes-test.nes'), HASH = createHash('md5').update(rom.subarray(16)).digest('hex');
const calls = [];
await sleep(800);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 420, height: 860 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.hostname === 'media.retroachievements.org') return req.respond({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
    if (u.hostname !== 'retroachievements.org') return req.continue();
    calls.push(u.pathname + '?' + [...u.searchParams.keys()].join(','));
    const json = (o, status = 200) => req.respond({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (u.searchParams.get('y') !== 'GOODKEY') return json({ message: 'Unauthenticated.' }, 401);
    if (u.pathname === '/API/API_GetUserProfile.php') return json({ User: 'Tester', TotalPoints: 1234, TotalTruePoints: 2000 });
    if (u.pathname === '/API/API_GetGameList.php') { assert(u.searchParams.get('i') === '7'); return json([{ ID: 99, Title: 'Other', Hashes: ['00000000000000000000000000000000'] }, { ID: 4242, Title: 'NES Test Game', Hashes: [HASH.toUpperCase()] }]); }
    if (u.pathname === '/API/API_GetGameInfoAndUserProgress.php') { assert(u.searchParams.get('g') === '4242' && u.searchParams.get('u') === 'Tester');
      return json({ Title: 'NES Test Game', ImageIcon: '/Images/000001.png', Achievements: { 1: { ID: 1, Title: 'First Steps', Description: 'Start the game', Points: 5, BadgeName: '111', DisplayOrder: 1, DateEarnedHardcore: '2026-01-01 10:00:00', DateEarned: '2026-01-01 10:00:00' }, 2: { ID: 2, Title: 'Master', Description: 'Beat it', Points: 25, BadgeName: '222', DisplayOrder: 2 } } }); }
    return json({}, 404);
  });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });

  await step('RetroAchievements ROM hash (NES: MD5 without the iNES header) matches rcheevos rules; MD5 is correct', async () => {
    const r = await page.evaluate(async (b) => { const ra = await import('./js/retroach.js'); const u = new Uint8Array(b); return { h: ra.raHash('nes', u.buffer), e: ra.md5(new Uint8Array()), v64: ra.md5(ra.raBytes('n64', new Uint8Array([0x37, 0x80, 0x40, 0x12]))), z64: ra.md5(new Uint8Array([0x80, 0x37, 0x12, 0x40])) }; }, [...rom]);
    assert(r.h === HASH, `${r.h} vs ${HASH}`); assert(r.e === 'd41d8cd98f00b204e9800998ecf8427e', 'md5 empty'); assert(r.v64 === r.z64, 'n64 byte-swap'); return r.h;
  });
  await step('Settings → 🏆 RetroAchievements: a wrong key is rejected with a clear message', async () => {
    await page.click('#btn-settings'); await page.waitForSelector('#btn-ra', { visible: true }); await page.click('#btn-ra');
    await page.type('#ra-user', 'Tester'); await page.type('#ra-key', 'BADKEY'); await page.click('#ra-login');
    await page.waitForFunction(() => /rejected/.test(document.querySelector('#ra-status').textContent), { timeout: 8000 });
    const st = await page.evaluate(async () => (await import('./js/retroach.js')).loadRA()); assert(!st.key, 'bad key kept'); return page.$eval('#ra-status', (e) => e.textContent);
  });
  await step('correct username + Web API key logs in; hardcore toggle saved; the key is kept out of backups', async () => {
    await page.$eval('#ra-key', (e) => { e.value = ''; }); await page.type('#ra-key', 'GOODKEY'); await page.click('#ra-login');
    await page.waitForFunction(() => /Logged in as Tester/.test(document.querySelector('#ra-status').textContent), { timeout: 8000 });
    await page.click('#ra-hardcore');
    const r = await page.evaluate(async () => { const ra = await import('./js/retroach.js'); const bk = await import('./js/backup.js'); const z = await bk.exportBackup({ includeGames: false }); const txt = await z.text(); return { c: ra.loadRA(), hc: ra.hardcoreOn(), leaked: txt.includes('GOODKEY') }; });
    assert(r.c.user === 'Tester' && r.c.key === 'GOODKEY' && r.c.hardcore && r.hc, JSON.stringify(r)); assert(!r.leaked, 'API key found in backup'); return page.$eval('#ra-status', (e) => e.textContent);
  });
  await step('in-game with hardcore: Load state + Cheats hidden, quick-load blocked, auto-resume ignored', async () => {
    await page.evaluate(async (b) => { const db = await import('./js/db.js'); await db.putRom({ id: 'n1', file: 'nes-test.nes', title: 'NES Test', system: 'nes', core: 'nestopia', size: b.length, added: 1, lastPlayed: 0, data: new Uint8Array(b).buffer }); await db.putState({ id: 'n1', core: 'nestopia', data: new Uint8Array([1, 2, 3]).buffer, time: Date.now() }); }, [...rom]);
    await page.goto(`${base}player.html?id=n1&resume=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 });
    assert(!(await page.evaluate(() => window.EJS_loadStateURL)), 'resume state used in hardcore');
    await page.click('.ejs_start_button'); await page.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 }); await sleep(800);
    await page.click('#menu-btn'); await sleep(300);
    const r = await page.evaluate(() => ({ load: document.getElementById('pm-load').hidden, cheats: document.getElementById('pm-cheats').hidden, save: document.getElementById('pm-save').hidden, hint: document.getElementById('pm-hint').textContent, ach: !document.getElementById('pm-ach').hidden, rw: EJS_emulator.defaultOptions && EJS_emulator.defaultOptions.rewindEnabled }));
    assert(r.load && r.cheats && !r.save && r.ach && /hardcore/.test(r.hint), JSON.stringify(r)); return JSON.stringify(r);
  });
  await step('☰ → 🏆 Achievements lists the set for this exact ROM with unlock status', async () => {
    await page.click('#pm-ach'); await page.waitForSelector('#ra-summary', { timeout: 10000 });
    const r = await page.evaluate(() => ({ sum: document.getElementById('ra-summary').textContent, items: [...document.querySelectorAll('.ra-ach')].map((e) => e.className + ':' + e.querySelector('b').textContent + ':' + e.querySelector('img').getAttribute('src')) }));
    assert(/NES Test Game — 1\/2 unlocked · HARDCORE/.test(r.sum), r.sum);
    assert(r.items.length === 2 && /on:First Steps \(5\):.*111\.png/.test(r.items[0]) && /^ra-ach:Master \(25\):.*222_lock\.png/.test(r.items[1]), r.items.join(' | '));
    await page.screenshot({ path: 'tests/out/ra.png' });
    return r.sum;
  });
  await step('game list is cached (one API_GetGameList call)', async () => {
    await page.click('#pmpanel-back').catch(() => {}); await page.click('#pm-ach'); await page.waitForSelector('#ra-summary', { timeout: 10000 });
    const n = calls.filter((c) => c.startsWith('/API/API_GetGameList')).length; assert(n === 1, 'GetGameList calls ' + n); return calls.length + ' API calls';
  });
  await step('no page errors', async () => { assert(!errs.length, errs.join(' | ')); });
} finally { await browser.close(); srv.kill(); }
console.log(`\n${total - failed}/${total} passed`); process.exit(failed ? 1 : 0);
